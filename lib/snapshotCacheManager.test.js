'use strict';

const { expect } = require('chai');
const { createSnapshotCacheManager } = require('./snapshotCacheManager');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const camera = /** @type {import('./cameraRegistry').ResolvedCamera} */ ({
	id: 'carport',
	name: 'Carport',
	channel: 'carport',
	motionEyeId: 2,
	enabled: true,
	defaultMode: 'still',
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
		preText: '',
		sendImage: true,
		postText: '',
		includeTimestamp: true,
		recipientFilter: [],
	},
});

describe('snapshotCacheManager', () => {
	it('refreshForNotification should trigger MotionEye snapshot before download', async () => {
		/** @type {string[]} */
		const calls = [];
		let delayed = false;

		const manager = createSnapshotCacheManager({
			namespace: 'motioneye.0',
			getConfig: () => ({ snapshotCacheDelayMs: 0, snapshotCacheEnabled: false }),
			getMotionEyeApi: () => ({
				takeSnapshot: async id => {
					calls.push(`takeSnapshot:${id}`);
					return {};
				},
				downloadPicture: async id => {
					calls.push(`downloadPicture:${id}`);
					return jpeg;
				},
			}),
			writeFile: async () => {
				calls.push('writeFile');
			},
			setState: async () => {},
			getState: async () => null,
			resolveLocalHost: async () => '127.0.0.1',
			resolveWebAdapter: async () => ({ port: 8082, secure: false }),
			getDataDir: () => '/opt/iobroker/iobroker-data',
			verboseLog: () => {},
			log: () => {},
			delayFn: async () => {
				delayed = true;
			},
			isUnloading: () => false,
		});

		await manager.init();
		await manager.refreshForNotification(camera);

		expect(calls).to.deep.equal(['takeSnapshot:2', 'downloadPicture:2', 'writeFile']);
		expect(delayed).to.equal(false);
	});
});
