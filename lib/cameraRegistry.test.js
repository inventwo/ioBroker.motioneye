'use strict';

const { expect } = require('chai');
const {
	safeChannelName,
	slugifyId,
	resolveCameras,
	buildWebhookUrl,
	parseWebhookRequest,
} = require('./cameraRegistry');

describe('cameraRegistry', () => {
	it('safeChannelName should replace spaces and strip unsafe characters', () => {
		expect(safeChannelName('Innenhof II')).to.equal('Innenhof_II');
		expect(safeChannelName('  Auffahrt  ')).to.equal('Auffahrt');
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
		expect(cameras[0].channel).to.equal('Auffahrt');
		expect(cameras[0].defaultMode).to.equal('still');
		expect(cameras[1].id).to.equal('auffahrt_2');
		expect(cameras[2].enabled).to.equal(false);
	});

	it('buildWebhookUrl should include namespace and camera id', () => {
		const url = buildWebhookUrl('motioneye.0', '192.168.1.10', 8090, 'auffahrt');
		expect(url).to.equal('http://192.168.1.10:8090/motioneye.0/webhook/auffahrt?value=true');
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
