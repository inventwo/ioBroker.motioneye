'use strict';

const { expect } = require('chai');
const {
	buildSnapshotStoragePath,
	buildSnapshotWebPath,
	buildSnapshotHtml,
	isJpegBuffer,
	isSnapshotCacheEnabledForCamera,
	shouldRefreshSnapshotOnMotion,
	capSnapshotDelayMs,
} = require('./snapshotCache');

describe('snapshotCache helpers', () => {
	it('buildSnapshotStoragePath should return snapshots/<channel>/lastsnap.jpg', () => {
		expect(buildSnapshotStoragePath('auffahrt')).to.equal('snapshots/auffahrt/lastsnap.jpg');
	});

	it('buildSnapshotWebPath should prefix namespace', () => {
		expect(buildSnapshotWebPath('motioneye.0', 'garten')).to.equal(
			'/motioneye.0/snapshots/garten/lastsnap.jpg',
		);
	});

	it('buildSnapshotHtml should embed url with optional cache buster', () => {
		const html = buildSnapshotHtml('http://192.168.1.10:8082/motioneye.0/snapshots/garten/lastsnap.jpg', 123);
		expect(html).to.include('http://192.168.1.10:8082/motioneye.0/snapshots/garten/lastsnap.jpg?t=123');
		expect(html).to.include('<img');
	});

	it('isJpegBuffer should detect JPEG magic bytes', () => {
		expect(isJpegBuffer(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).to.equal(true);
		expect(isJpegBuffer(Buffer.from('not a jpeg'))).to.equal(false);
	});

	it('isSnapshotCacheEnabledForCamera should respect global and per-camera flags', () => {
		const camera = /** @type {import('./cameraRegistry').ResolvedCamera} */ ({
			id: 'auffahrt',
			name: 'Auffahrt',
			channel: 'auffahrt',
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
		});

		expect(isSnapshotCacheEnabledForCamera(camera, { snapshotCacheEnabled: true })).to.equal(true);
		expect(isSnapshotCacheEnabledForCamera(camera, { snapshotCacheEnabled: false })).to.equal(false);
		expect(
			isSnapshotCacheEnabledForCamera({ ...camera, snapshotCacheEnabled: false }, { snapshotCacheEnabled: true }),
		).to.equal(false);
	});

	it('shouldRefreshSnapshotOnMotion should require cache enabled and global motion flag', () => {
		const camera = /** @type {import('./cameraRegistry').ResolvedCamera} */ ({
			id: 'auffahrt',
			name: 'Auffahrt',
			channel: 'auffahrt',
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
		});

		expect(shouldRefreshSnapshotOnMotion(camera, { snapshotCacheEnabled: true, snapshotCacheOnMotion: true })).to
			.equal(true);
		expect(shouldRefreshSnapshotOnMotion(camera, { snapshotCacheEnabled: true, snapshotCacheOnMotion: false })).to
			.equal(false);
	});

	it('capSnapshotDelayMs should clamp and default invalid values', () => {
		expect(capSnapshotDelayMs(undefined)).to.equal(800);
		expect(capSnapshotDelayMs(10000, { min: 0, max: 5000, default: 800 })).to.equal(5000);
		expect(capSnapshotDelayMs(-5, { min: 0, max: 5000, default: 800 })).to.equal(0);
	});
});
