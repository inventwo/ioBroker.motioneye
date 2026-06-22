'use strict';

const { expect } = require('chai');
const {
	extractMediaFolderFromMotionEyeConfig,
	mapMotionEyeCamera,
	mergeMotionEyeCameras,
	parseLoadCamerasMessage,
} = require('./cameraDiscovery');

describe('cameraDiscovery', () => {
	it('extractMediaFolderFromMotionEyeConfig should read custom folder names', () => {
		expect(
			extractMediaFolderFromMotionEyeConfig({
				root_directory: '/var/lib/motioneye/Bambu',
			}),
		).to.equal('Bambu');
		expect(
			extractMediaFolderFromMotionEyeConfig({
				root_directory: '/var/lib/motioneye/Camera8',
			}),
		).to.equal('');
	});

	it('mapMotionEyeCamera should build admin row defaults', () => {
		expect(
			mapMotionEyeCamera(
				{
					id: 3,
					name: 'Auffahrt',
					root_directory: '/var/lib/motioneye/Auffahrt',
				},
				'still',
			),
		).to.deep.equal({
			name: 'Auffahrt',
			motionEyeId: 3,
			id: '',
			mediaFolder: 'Auffahrt',
			defaultMode: 'still',
			enabled: true,
		});
	});

	it('parseLoadCamerasMessage should decode camerasPayload from admin jsonData', () => {
		const cameras = [{ name: 'A', motionEyeId: 1 }];
		const payload = parseLoadCamerasMessage({
			motionHost: '192.168.1.1',
			camerasPayload: encodeURIComponent(JSON.stringify(cameras)),
		});

		expect(payload.motionHost).to.equal('192.168.1.1');
		expect(payload.cameras).to.deep.equal(cameras);
	});

	it('mergeMotionEyeCameras should keep existing rows and append missing ids', () => {
		const result = mergeMotionEyeCameras(
			[{ name: 'Carport', motionEyeId: 1, enabled: true, defaultMode: 'off' }],
			[
				{ id: 1, name: 'Carport ME' },
				{ id: 2, name: 'Garten' },
			],
			'sharp',
		);

		expect(result.added).to.equal(1);
		expect(result.cameras).to.have.length(2);
		expect(result.cameras[0].name).to.equal('Carport');
		expect(result.cameras[1]).to.deep.include({
			name: 'Garten',
			motionEyeId: 2,
			defaultMode: 'sharp',
			enabled: true,
		});
	});
});
