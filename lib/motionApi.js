'use strict';

const http = require('node:http');

/**
 * @typedef {object} MotionApiOptions
 * @property {string} host MotionEye / Motion host
 * @property {number} [motionPort=7999]
 * @property {number} [requestTimeoutMs=45000]
 */

/**
 * Motion HTTP API client (snapshots on motionPort).
 * @param {MotionApiOptions} options
 */
function createMotionApi(options) {
	const host = String(options.host ?? '').trim();
	const motionPort = options.motionPort ?? 7999;
	const requestTimeoutMs = options.requestTimeoutMs ?? 45000;

	/**
	 * @param {string} path
	 * @param {string} [method]
	 * @returns {Promise<{ status: number, body: string }>}
	 */
	function request(path, method = 'GET') {
		return new Promise((resolve, reject) => {
			const req = http.request(
				{
					hostname: host,
					port: motionPort,
					path,
					method,
					timeout: requestTimeoutMs,
				},
				res => {
					let body = '';
					res.setEncoding('utf8');
					res.on('data', chunk => {
						body += chunk;
					});
					res.on('end', () => {
						if ((res.statusCode || 0) >= 400) {
							reject(new Error(`Motion HTTP ${res.statusCode}: ${body.trim() || path}`));
							return;
						}
						resolve({ status: res.statusCode || 0, body: body.trim() });
					});
				},
			);

			req.on('timeout', () => {
				req.destroy();
				reject(new Error(`Timeout after ${requestTimeoutMs} ms: ${path}`));
			});
			req.on('error', reject);
			req.end();
		});
	}

	return {
		/**
		 * @param {number} cameraId MotionEye camera ID
		 */
		takeSnapshot(cameraId) {
			return request(`/${cameraId}/action/snapshot`, 'GET');
		},
	};
}

module.exports = {
	createMotionApi,
};
