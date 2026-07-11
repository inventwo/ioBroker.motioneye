'use strict';

const { expect } = require('chai');
const {
	parseTelegramRecipients,
	parseNotificationRecipientFilter,
	filterRecipientsForCamera,
	resolveCameraNotification,
	expandNotificationText,
	buildPostMessage,
	hasNotificationContent,
	capNotificationIntervalSec,
	isTelegramNotificationsEnabled,
	needsSnapshotImageForNotification,
	formatNotificationTimestamp,
} = require('./telegramNotifications');

const camera = /** @type {import('./cameraRegistry').ResolvedCamera} */ ({
	id: 'buero',
	name: 'Buero',
	channel: 'buero',
	motionEyeId: 1,
	enabled: true,
	defaultMode: 'off',
	mediaFolder: '',
	overlayConfig: {
		enabled: '',
		leftText: '',
		rightText: '',
		customLeftText: '',
		customRightText: '',
		textScale: 0,
	},
	storageAutoRefresh: true,
	snapshotCacheEnabled: true,
	notification: {
		onMotion: true,
		onSnapshot: true,
		preText: 'Bewegung im {camera} erkannt:',
		sendImage: true,
		postText: 'Die Aufnahme entstand am:',
		includeTimestamp: true,
		recipientFilter: [],
	},
});

describe('telegramNotifications helpers', () => {
	it('parseTelegramRecipients should skip rows without chatId and honor enabled flag', () => {
		expect(
			parseTelegramRecipients([
				{ instance: 0, chatId: '123', name: 'Sven', enabled: true },
				{ instance: 0, chatId: '456', name: 'Nicole', enabled: false },
				{ instance: 0, chatId: '  ', name: 'Empty' },
			]),
		).to.deep.equal([
			{ instance: 0, chatId: '123', name: 'Sven', enabled: true },
			{ instance: 0, chatId: '456', name: 'Nicole', enabled: false },
		]);
	});

	it('filterRecipientsForCamera should match names or chat IDs and default to all enabled', () => {
		const recipients = parseTelegramRecipients([
			{ chatId: '586554416', name: 'Sven' },
			{ chatId: '765084646', name: 'Nicole', enabled: false },
			{ chatId: '999', name: 'Guest' },
		]);

		expect(filterRecipientsForCamera(recipients, [])).to.have.length(2);
		expect(filterRecipientsForCamera(recipients, ['Nicole']).map(r => r.chatId)).to.deep.equal([]);
		expect(filterRecipientsForCamera(recipients, ['Sven', '999']).map(r => r.name)).to.deep.equal(['Sven', 'Guest']);
		expect(filterRecipientsForCamera(recipients, ['586554416'])[0].name).to.equal('Sven');
	});

	it('resolveCameraNotification should parse recipient filter from camera row', () => {
		expect(resolveCameraNotification({ notificationRecipients: 'Sven, Nicole' }).recipientFilter).to.deep.equal([
			'Sven',
			'Nicole',
		]);
		expect(resolveCameraNotification({ notificationRecipients: 'alle' }).recipientFilter).to.deep.equal([]);
		expect(resolveCameraNotification({}).recipientFilter).to.deep.equal([]);
	});

	it('resolveCameraNotification should default onMotion and onSnapshot to true', () => {
		expect(resolveCameraNotification({})).to.deep.equal({
			onMotion: true,
			onSnapshot: true,
			preText: '',
			sendImage: true,
			postText: '',
			includeTimestamp: true,
			recipientFilter: [],
		});
		expect(resolveCameraNotification({ notificationSendImage: 'false' })).to.include({ sendImage: false });
		expect(resolveCameraNotification({ notificationIncludeTimestamp: 'false' })).to.include({
			includeTimestamp: false,
		});
		expect(resolveCameraNotification({ notificationOnMotion: 'false' })).to.include({ onMotion: false, onSnapshot: true });
		expect(resolveCameraNotification({ notificationOnSnapshot: 'false' })).to.include({
			onMotion: true,
			onSnapshot: false,
		});
		expect(resolveCameraNotification({ notificationEnabled: 'false' })).to.deep.include({
			onMotion: false,
			onSnapshot: false,
		});
		expect(resolveCameraNotification({ notificationEnabled: 'false', notificationOnSnapshot: '' })).to.include({
			onSnapshot: false,
		});
		expect(
			resolveCameraNotification({ notificationEnabled: 'false', notificationOnSnapshot: 'true' }),
		).to.include({ onSnapshot: true });
		expect(resolveCameraNotification({ notificationImageExcluded: true })).to.include({ sendImage: false });
		expect(resolveCameraNotification({ notificationExcluded: true })).to.deep.include({
			onMotion: false,
			onSnapshot: false,
		});
	});

	it('expandNotificationText should replace camera placeholder', () => {
		expect(expandNotificationText(camera, 'Bewegung {camera}', '2026-07-11T04:47:29.623Z')).to.equal(
			'Bewegung Buero',
		);
	});

	it('buildPostMessage should append local timestamp after colon without extra space', () => {
		const config = resolveCameraNotification({
			notificationPostText: 'Die Aufnahme entstand am:',
		});
		const iso = '2026-07-11T09:05:26.759Z';
		expect(buildPostMessage(camera, config, iso)).to.equal(
			`Die Aufnahme entstand am:${formatNotificationTimestamp(iso)}`,
		);
	});

	it('formatNotificationTimestamp should render local YYYY-MM-DD HH:mm:ss', () => {
		const formatted = formatNotificationTimestamp('2026-07-11T09:05:26.759Z');
		expect(formatted).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(formatted).to.not.include('Z');
	});

	it('hasNotificationContent should detect pre text, image, and post text', () => {
		expect(hasNotificationContent({ preText: 'Hi', sendImage: false, postText: '', includeTimestamp: false }, '')).to
			.equal(true);
		expect(
			hasNotificationContent({ preText: '', sendImage: true, postText: '', includeTimestamp: false }, '/tmp/x.jpg'),
		).to.equal(true);
		expect(
			hasNotificationContent({ preText: '', sendImage: false, postText: '', includeTimestamp: true }, ''),
		).to.equal(true);
	});

	it('capNotificationIntervalSec should clamp invalid values', () => {
		expect(capNotificationIntervalSec(undefined)).to.equal(30);
		expect(capNotificationIntervalSec(9999)).to.equal(3600);
	});

	it('isTelegramNotificationsEnabled should read the global master switch', () => {
		expect(isTelegramNotificationsEnabled({ telegramNotificationsEnabled: true })).to.equal(true);
		expect(isTelegramNotificationsEnabled({ telegramNotificationsEnabled: false })).to.equal(false);
	});

	it('needsSnapshotImageForNotification should require onSnapshot and sendImage', () => {
		expect(needsSnapshotImageForNotification({ onSnapshot: true, sendImage: true })).to.equal(true);
		expect(needsSnapshotImageForNotification({ onSnapshot: false, sendImage: true })).to.equal(false);
		expect(needsSnapshotImageForNotification({ onSnapshot: true, sendImage: false })).to.equal(false);
	});
});
