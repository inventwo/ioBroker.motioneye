'use strict';

const http = require('node:http');
const { parseWebhookRequest } = require('./cameraRegistry');

/**
 * @typedef {object} WebhookServerOptions
 * @property {number} port
 * @property {string} [bind='0.0.0.0']
 * @property {string} namespace Adapter namespace (e.g. motioneye.0)
 * @property {(cameraId: string, value: boolean) => void|Promise<void>} onMotion
 * @property {(level: string, message: string) => void} [log]
 */

/**
 * @param {WebhookServerOptions} options
 */
function createWebhookServer(options) {
	const port = options.port;
	const bind = options.bind || '0.0.0.0';
	const namespace = options.namespace;
	const onMotion = options.onMotion;
	const log = options.log || (() => {});

	/** @type {import('node:http').Server | undefined} */
	let server;

	const httpServer = http.createServer((req, res) => {
		const method = req.method || 'GET';
		if (method !== 'GET' && method !== 'POST' && method !== 'HEAD') {
			res.writeHead(405);
			res.end();
			return;
		}

		const path = req.url || '/';
		const parsed = parseWebhookRequest(path, namespace);
		if (!parsed) {
			res.writeHead(404);
			res.end();
			return;
		}

		Promise.resolve(onMotion(parsed.cameraId, parsed.value))
			.then(() => {
				res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
				res.end('OK');
			})
			.catch(error => {
				log('error', `Webhook handler error for ${parsed.cameraId}: ${error.message}`);
				res.writeHead(500);
				res.end('Error');
			});
	});

	return {
		/**
		 * @returns {Promise<void>}
		 */
		start() {
			return new Promise((resolve, reject) => {
				if (server) {
					resolve();
					return;
				}

				server = httpServer;
				server.on('error', reject);
				server.listen(port, bind, () => {
					log('info', `Webhook server listening on ${bind}:${port}`);
					resolve();
				});
			});
		},

		/**
		 * @returns {Promise<void>}
		 */
		stop() {
			return new Promise(resolve => {
				if (!server) {
					resolve();
					return;
				}

				server.close(() => {
					server = undefined;
					resolve();
				});
			});
		},
	};
}

module.exports = {
	createWebhookServer,
	parseWebhookRequest,
};
