const path = require('node:path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');
// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
	defineAdditionalTests({ suite }) {
		suite('MotionEye adapter', (getHarness) => {
			let harness;
			before(() => {
				harness = getHarness();
			});

			it('should create camera states on start', function () {
				return new Promise(async (resolve, reject) => {
					try {
						await harness.changeAdapterConfigAsync({
							native: {
								motionHost: '127.0.0.1',
								webhookHost: '127.0.0.1',
								webhookPort: 18090,
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
						const ids = await harness.states.getStateIDsAsync();
						expect(ids).to.include('motioneye.0.TestCam.mode');
						expect(ids).to.include('motioneye.0.TestCam.webhookUrl');
						expect(ids).to.include('motioneye.0.info.connection');
						resolve();
					} catch (error) {
						reject(error);
					}
				});
			}).timeout(40000);
		});
	},
});
