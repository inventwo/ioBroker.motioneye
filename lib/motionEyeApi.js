'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const SIGNATURE_REGEX = new RegExp('[^a-zA-Z0-9/?_.=&{}\\[\\]":, -]', 'g');

/** Default cache TTL for camera list (ms). */
const LIST_CACHE_MS = 15000;

/**
 * @param {string | string[] | undefined} serverHeader
 * @returns {string}
 */
function parseMotionEyeServerHeader(serverHeader) {
	if (!serverHeader) {
		return '';
	}

	const header = Array.isArray(serverHeader) ? serverHeader[0] : serverHeader;
	const match = String(header).match(/^motionEye\/(.+)$/i);
	return match ? match[1].trim() : '';
}

/**
 * Parse MotionEye /version HTML body.
 *
 * @param {string} html
 * @returns {{ motionEyeVersion: string, motionVersion: string, hostname: string, osVersion: string }}
 */
function parseVersionPage(html) {
	const result = {
		motionEyeVersion: '',
		motionVersion: '',
		hostname: '',
		osVersion: '',
	};

	if (!html) {
		return result;
	}

	const patterns = {
		motionEyeVersion: /version\s*=\s*"([^"]*)"/,
		motionVersion: /motion_version\s*=\s*"([^"]*)"/,
		hostname: /hostname\s*=\s*"([^"]*)"/,
		osVersion: /os_version\s*=\s*"([^"]*)"/,
	};

	for (const [key, pattern] of Object.entries(patterns)) {
		const match = html.match(pattern);
		if (match) {
			result[key] = match[1];
		}
	}

	return result;
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteParam(value) {
	return encodeURIComponent(value).replace(/[!'()*~]/g, c => c);
}

/**
 * Compute MotionEye API signature (SHA1).
 *
 * @param {string} method
 * @param {string} requestPath
 * @param {string} body
 * @param {string} password Sign key (empty string when no password)
 * @returns {string}
 */
function computeSignature(method, requestPath, body, password) {
	const qIndex = requestPath.indexOf('?');
	const pathname = qIndex >= 0 ? requestPath.slice(0, qIndex) : requestPath;
	const queryString = qIndex >= 0 ? requestPath.slice(qIndex + 1) : '';
	const params = [];

	if (queryString) {
		for (const part of queryString.split('&')) {
			if (!part) {
				continue;
			}
			const eq = part.indexOf('=');
			const name = eq >= 0 ? decodeURIComponent(part.slice(0, eq)) : decodeURIComponent(part);
			const value = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : '';
			if (name !== '_signature') {
				params.push([name, value]);
			}
		}
	}

	params.sort((a, b) => a[0].localeCompare(b[0]));
	const query = params.map(([name, value]) => `${name}=${quoteParam(value)}`).join('&');
	let path = pathname + (query ? `?${query}` : '');
	path = path.replace(SIGNATURE_REGEX, '-');

	const key = String(password).replace(SIGNATURE_REGEX, '-');
	let bodyStr = body || '';
	if (bodyStr.startsWith('---')) {
		bodyStr = '';
	} else if (bodyStr) {
		bodyStr = bodyStr.replace(SIGNATURE_REGEX, '-');
	}

	const signing = `${method}:${path}:${bodyStr}:${key}`;
	return crypto.createHash('sha1').update(signing, 'utf8').digest('hex').toLowerCase();
}

/**
 * @param {string} password Plain-text MotionEye password
 * @returns {string} Sign key (empty when password is empty)
 */
function motionEyeSignKey(password) {
	if (!password) {
		return '';
	}

	return crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toLowerCase();
}

/**
 * @param {string} path
 * @param {string} method
 * @param {string|null|undefined} body
 * @param {string} username
 * @param {string} signKey
 * @returns {string}
 */
function buildAuthPath(path, method, body, username, signKey) {
	const joiner = path.includes('?') ? '&' : '?';
	const unsignedPath = `${path}${joiner}_username=${quoteParam(username)}`;
	const signature = computeSignature(method, unsignedPath, body || '', signKey);
	return `${unsignedPath}&_signature=${signature}`;
}

/**
 * @typedef {object} MotionEyeApiOptions
 * @property {string} host MotionEye host
 * @property {number} [motionEyePort=8765]
 * @property {string} [username='admin']
 * @property {string} [password='']
 * @property {number} [requestTimeoutMs=45000]
 * @property {number} [listCacheMs=15000]
 */

/**
 * @typedef {object} MotionEyeApiResult
 * @property {number} status
 * @property {unknown} data
 * @property {string} body
 * @property {import('node:http').IncomingHttpHeaders} [headers]
 */

/**
 * Create a MotionEye Config API client.
 * @param {MotionEyeApiOptions} options
 */
function createMotionEyeApi(options) {
	const host = options.host;
	const motionEyePort = options.motionEyePort ?? 8765;
	const username = options.username || 'admin';
	const password = options.password || '';
	const requestTimeoutMs = options.requestTimeoutMs ?? 45000;
	const listCacheMs = options.listCacheMs ?? LIST_CACHE_MS;
	const signKey = motionEyeSignKey(password);

	let listCache = null;
	let lastMotionEyeVersion = '';

	/**
	 * @param {string} path
	 * @param {string} [method]
	 * @param {string|null} [body]
	 * @returns {Promise<{ status: number, body: string, headers: import('node:http').IncomingHttpHeaders }>}
	 */
	function httpRequest(path, method = 'GET', body = null) {
		return new Promise((resolve, reject) => {
			const requestOptions = {
				hostname: host,
				port: motionEyePort,
				path,
				method,
				timeout: requestTimeoutMs,
				headers: {},
			};

			if (body) {
				requestOptions.headers = {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body, 'utf8'),
				};
			}

			const req = http.request(requestOptions, res => {
				let responseBody = '';
				res.setEncoding('utf8');
				res.on('data', chunk => {
					responseBody += chunk;
				});
				res.on('end', () => {
					resolve({
						status: res.statusCode || 0,
						body: responseBody.trim(),
						headers: res.headers,
					});
				});
			});

			req.on('timeout', () => {
				req.destroy();
				reject(new Error(`Timeout after ${requestTimeoutMs} ms: ${path}`));
			});
			req.on('error', reject);

			if (body) {
				req.write(body);
			}
			req.end();
		});
	}

	/**
	 * @param {string} path
	 * @param {string} [method]
	 * @param {Record<string, unknown>|null} [bodyObj]
	 * @returns {Promise<MotionEyeApiResult>}
	 */
	async function call(path, method = 'GET', bodyObj = null) {
		const body = bodyObj ? JSON.stringify(bodyObj) : null;
		const authPath = buildAuthPath(path, method, body, username, signKey);
		const result = await httpRequest(authPath, method, body);

		let data = null;
		if (result.body) {
			try {
				data = JSON.parse(result.body);
			} catch {
				data = result.body;
			}
		}

		if (
			result.status >= 400 ||
			(data && typeof data === 'object' && data !== null && 'error' in data && data.error)
		) {
			const message =
				(data && typeof data === 'object' && data !== null && 'error' in data && data.error) ||
				result.body ||
				`HTTP ${result.status}`;
			throw new Error(String(message));
		}

		return { status: result.status, data, body: result.body, headers: result.headers };
	}

	/**
	 * @returns {Promise<Record<string, unknown>[]>}
	 */
	async function getCameraList() {
		const now = Date.now();
		if (listCache && listCache.expires > now) {
			return listCache.data;
		}

		const result = await call('/config/list', 'GET');
		lastMotionEyeVersion = parseMotionEyeServerHeader(result.headers?.server);

		if (!result.data || typeof result.data !== 'object' || result.data === null || !('cameras' in result.data)) {
			throw new Error('config/list: no cameras found');
		}

		const cameras = /** @type {Record<string, unknown>[]} */ (result.data.cameras);
		listCache = { data: cameras, expires: now + listCacheMs };
		return cameras;
	}

	/**
	 * @param {number} cameraId
	 * @returns {Promise<Record<string, unknown>>}
	 */
	async function getCameraConfig(cameraId) {
		const cameras = await getCameraList();
		const camera = cameras.find(entry => entry.id === cameraId);
		if (!camera) {
			throw new Error(`Camera ID ${cameraId} not found in MotionEye`);
		}
		return camera;
	}

	/**
	 * @param {number} cameraId
	 * @param {Record<string, unknown>} patch
	 * @returns {Promise<{ changed: boolean, data: unknown }>}
	 */
	async function saveCameraConfig(cameraId, patch) {
		const uiConfig = await getCameraConfig(cameraId);
		let changed = false;

		for (const [key, value] of Object.entries(patch)) {
			if (uiConfig[key] !== value) {
				uiConfig[key] = value;
				changed = true;
			}
		}

		if (!changed) {
			return { changed: false, data: null };
		}

		listCache = null;
		const result = await call(`/config/${cameraId}/set/`, 'POST', uiConfig);
		return { changed: true, data: result.data };
	}

	/**
	 * @returns {Promise<{ motionEyeVersion: string, motionVersion: string, hostname: string, osVersion: string }>}
	 */
	async function getServerVersions() {
		const authPath = buildAuthPath('/version', 'GET', null, username, signKey);
		const result = await httpRequest(authPath, 'GET');
		const fromPage = parseVersionPage(result.body);
		const fromHeader = parseMotionEyeServerHeader(result.headers?.server);

		return {
			motionEyeVersion: fromPage.motionEyeVersion || fromHeader || lastMotionEyeVersion,
			motionVersion: fromPage.motionVersion,
			hostname: fromPage.hostname,
			osVersion: fromPage.osVersion,
		};
	}

	return {
		call,
		getCameraList,
		getCameraConfig,
		saveCameraConfig,
		getServerVersions,
		getLastMotionEyeVersion() {
			return lastMotionEyeVersion;
		},
		invalidateCache() {
			listCache = null;
		},
	};
}

module.exports = {
	SIGNATURE_REGEX,
	quoteParam,
	computeSignature,
	motionEyeSignKey,
	buildAuthPath,
	parseMotionEyeServerHeader,
	parseVersionPage,
	createMotionEyeApi,
	LIST_CACHE_MS,
};
