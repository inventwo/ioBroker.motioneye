'use strict';

const { expect } = require('chai');
const {
	parseTelegramRecipients,
	resolveCameraNotification,
	expandNotificationText,
	buildPostMessage,
	hasNotificationContent,
	capNotificationIntervalSec,
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
		enabled: true,
		preText: 'Bewegung im {camera} erkannt:',
		sendImage: true,
		postText: 'Die Aufnahme entstand am:',
		includeTimestamp: true,
	},
});

describe('telegramNotifications helpers', () => {
	it('parseTelegramRecipients should skip rows without chatId', () => {
		expect(
			parseTelegramRecipients([
				{ instance: 0, chatId: '123', name: 'Sven' },
				{ instance: 0, chatId: '  ', name: 'Empty' },
			]),
		).to.deep.equal([{ instance: 0, chatId: '123', name: 'Sven' }]);
	});

	it('resolveCameraNotification should default sendImage and includeTimestamp to true', () => {
		expect(resolveCameraNotification({})).to.deep.equal({
			enabled: true,
			preText: '',
			sendImage: true,
			postText: '',
			includeTimestamp: true,
		});
	});

	it('expandNotificationText should replace camera placeholder', () => {
		expect(expandNotificationText(camera, 'Bewegung {camera}', '2026-07-11T04:47:29.623Z')).to.equal(
			'Bewegung Buero',
		);
	});

	it('buildPostMessage should append timestamp after colon without extra space', () => {
		const config = resolveCameraNotification({
			notificationPostText: 'Die Aufnahme entstand am:',
			notificationIncludeTimestamp: true,
		});
		expect(buildPostMessage(camera, config, '2026-07-11T04:47:29.623Z')).to.equal(
			'Die Aufnahme entstand am:2026-07-11T04:47:29.623Z',
		);
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
});
