const path = require('node:path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

const ADAPTER_NAME = 'motioneye';
const NAMESPACE = `${ADAPTER_NAME}.0`;

async function expectStateObject(harness, objectId) {
	const obj = await harness.objects.getObjectAsync(objectId);
	expect(obj, `missing object ${objectId}`).to.exist;
	expect(obj.type).to.equal('state');
}

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
	defineAdditionalTests({ suite }) {
		suite('MotionEye adapter', getHarness => {
			let harness;
			before(() => {
				harness = getHarness();
			});

			it('should create camera states on start', async function () {
				await harness.changeAdapterConfig(ADAPTER_NAME, {
					native: {
						motionHost: '127.0.0.1',
						webhookHost: '127.0.0.1',
						webhookPort: 18090,
						useMotionEyeConfig: false,
						requestTimeoutMs: 3000,
						cameras: [
							{
								id: 'testcam',
								name: 'TestCam',
								motionEyeId: 1,
								enabled: true,
								defaultMode: 'off',
							},
						],
					},
				});
				await harness.startAdapterAndWait();

				const stateIds = [
					`${NAMESPACE}.TestCam.mode`,
					`${NAMESPACE}.TestCam.webhookUrl`,
					`${NAMESPACE}.TestCam.snapshot`,
					`${NAMESPACE}.TestCam.stream`,
					`${NAMESPACE}.TestCam.streamPulse`,
					`${NAMESPACE}.TestCam.streamUrl`,
					`${NAMESPACE}.info.connection`,
				];

				for (const id of stateIds) {
					await expectStateObject(harness, id);
				}
			}).timeout(40000);
		});
	},
});
