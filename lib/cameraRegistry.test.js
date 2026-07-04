'use strict';

const { expect } = require('chai');
const {
	safeChannelName,
	legacySafeChannelName,
	slugifyId,
	resolveOverlayConfig,
	resolveCameras,
	resolveLegacyCameras,
	buildWebhookUrl,
	parseWebhookRequest,
} = require('./cameraRegistry');

describe('cameraRegistry', () => {
	it('safeChannelName should replace spaces, strip unsafe characters, and lowercase', () => {
		expect(safeChannelName('Innenhof II')).to.equal('innenhof_ii');
		expect(safeChannelName('  Auffahrt  ')).to.equal('auffahrt');
		expect(safeChannelName('eCar')).to.equal('ecar');
	});

	it('slugifyId should produce lowercase stable ids', () => {
		expect(slugifyId('Innenhof II')).to.equal('innenhof_ii');
	});

	it('resolveCameras should skip invalid entries and deduplicate ids', () => {
		const cameras = resolveCameras(
			[
				{ name: 'Auffahrt', motionEyeId: 1 },
				{ name: 'Auffahrt', motionEyeId: 2, id: 'auffahrt' },
				{ name: '', motionEyeId: 3 },
				{ name: 'Carport', motionEyeId: 2, enabled: false },
			],
			'still',
		);

		expect(cameras).to.have.length(3);
		expect(cameras[0].channel).to.equal('auffahrt');
		expect(cameras[0].defaultMode).to.equal('still');
		expect(cameras[1].id).to.equal('auffahrt_2');
		expect(cameras[2].enabled).to.equal(false);
	});

	it('resolveLegacyCameras should keep pre-lowercase channel ids for migration', () => {
		const legacy = resolveLegacyCameras([{ name: 'Innenhof II', motionEyeId: 4 }]);
		expect(legacy[0].channel).to.equal('Innenhof_II');
		const current = resolveCameras([{ name: 'Innenhof II', motionEyeId: 4 }]);
		expect(current[0].channel).to.equal('innenhof_ii');
	});

	it('buildWebhookUrl should include namespace and camera id', () => {
		const url = buildWebhookUrl('motioneye.0', '192.168.1.10', 8090, 'auffahrt');
		expect(url).to.equal('http://192.168.1.10:8090/motioneye.0/webhook/auffahrt?value=true');
	});

	it('resolveOverlayConfig should treat empty/missing fields as "leave unchanged" sentinels', () => {
		expect(resolveOverlayConfig({})).to.deep.equal({
			enabled: '',
			leftText: '',
			rightText: '',
			customLeftText: '',
			customRightText: '',
			textScale: 0,
		});
	});

	it('resolveOverlayConfig should pass through filled-in values', () => {
		expect(
			resolveOverlayConfig({
				overlayEnabled: 'true',
				leftText: 'custom-text',
				rightText: 'timestamp',
				customLeftText: 'Büro',
				customRightText: '',
				textScale: 3,
			}),
		).to.deep.equal({
			enabled: 'true',
			leftText: 'custom-text',
			rightText: 'timestamp',
			customLeftText: 'Büro',
			customRightText: '',
			textScale: 3,
		});
	});

	it('resolveOverlayConfig should ignore invalid overlayEnabled and out-of-range textScale', () => {
		expect(resolveOverlayConfig({ overlayEnabled: 'maybe', textScale: -1 }).enabled).to.equal('');
		expect(resolveOverlayConfig({ textScale: -1 }).textScale).to.equal(0);
		expect(resolveOverlayConfig({ textScale: 0 }).textScale).to.equal(0);
	});

	it('resolveCameras should attach overlayConfig to each resolved camera', () => {
		const cameras = resolveCameras([
			{ name: 'Auffahrt', motionEyeId: 1, leftText: 'disabled', textScale: 5 },
		]);
		expect(cameras[0].overlayConfig).to.deep.equal({
			enabled: '',
			leftText: 'disabled',
			rightText: '',
			customLeftText: '',
			customRightText: '',
			textScale: 5,
		});
	});

	it('resolveCameras should default storageAutoRefresh to true and honor explicit false', () => {
		const cameras = resolveCameras([
			{ name: 'Auffahrt', motionEyeId: 1 },
			{ name: 'Carport', motionEyeId: 2, storageAutoRefresh: false },
		]);
		expect(cameras[0].storageAutoRefresh).to.equal(true);
		expect(cameras[1].storageAutoRefresh).to.equal(false);
	});

	it('parseWebhookRequest should parse value query parameter', () => {
		expect(parseWebhookRequest('/motioneye.0/webhook/auffahrt?value=true', 'motioneye.0')).to.deep.equal({
			cameraId: 'auffahrt',
			value: true,
		});
		expect(parseWebhookRequest('/motioneye.0/webhook/carport?value=false', 'motioneye.0')).to.deep.equal({
			cameraId: 'carport',
			value: false,
		});
		expect(parseWebhookRequest('/other/path', 'motioneye.0')).to.equal(null);
	});
});
