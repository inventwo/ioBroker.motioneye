'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { apiPathLabel } = require('./diagLog');

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

/** MotionEye 0.44+ session cookie name (see motioneye/handlers/login.py). */
const SESSION_COOKIE_NAME = 'user';

/**
 * @param {import('node:http').IncomingHttpHeaders | undefined} headers
 * @returns {Record<string, string>}
 */
function parseSetCookieHeaders(headers) {
	/** @type {Record<string, string>} */
	const cookies = {};
	if (!headers?.['set-cookie']) {
		return cookies;
	}

	const lines = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']];
	for (const line of lines) {
		const segment = String(line).split(';')[0];
		const eq = segment.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const name = segment.slice(0, eq).trim();
		const value = segment.slice(eq + 1).trim();
		if (name) {
			cookies[name] = value;
		}
	}

	return cookies;
}

/**
 * @param {string} body
 * @returns {unknown}
 */
function parseResponseBody(body) {
	if (!body) {
		return null;
	}

	try {
		return JSON.parse(body);
	} catch {
		return body;
	}
}

/**
 * @param {{ status: number, body: string }} result
 * @param {unknown} data
 * @returns {boolean}
 */
function isAuthFailure(result, data) {
	if (result.status === 401 || result.status === 403) {
		return true;
	}

	if (data && typeof data === 'object' && data !== null && 'error' in data) {
		const err = String(/** @type {{ error: unknown }} */ (data).error).toLowerCase();
		if (
			err.includes('unauthorized') ||
			err.includes('not authenticated') ||
			err.includes('invalid credentials') ||
			err.includes('authentication')
		) {
			return true;
		}
	}

	return /unauthorized/i.test(result.body);
}

/**
 * @param {{ status: number, body: string }} result
 * @param {unknown} data
 * @param {string} method
 * @param {string} pathLabel
 * @param {(message: string) => void} [verboseLog]
 * @returns {never}
 */
function throwApiError(result, data, method, pathLabel, verboseLog) {
	const message =
		(data &&
			typeof data === 'object' &&
			data !== null &&
			'error' in data &&
			/** @type {{ error: unknown }} */ (data).error) ||
		result.body ||
		`HTTP ${result.status}`;
	if (verboseLog) {
		verboseLog(`${method} ${pathLabel} → HTTP ${result.status}: ${String(message)}`);
	}
	throw new Error(String(message));
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
 * @property {(message: string) => void} [verboseLog]
 */

/**
 * @typedef {object} MotionEyeApiResult
 * @property {number} status
 * @property {unknown} data
 * @property {string} body
 * @property {import('node:http').IncomingHttpHeaders} [headers]
 */

/**
 * Trim host/user/password from admin config (copy-paste whitespace).
 *
 * @param {MotionEyeApiOptions} options
 * @returns {Required<Pick<MotionEyeApiOptions, 'host' | 'motionEyePort' | 'username' | 'password' | 'requestTimeoutMs' | 'listCacheMs'>> & Pick<MotionEyeApiOptions, 'verboseLog'>}
 */
function normalizeMotionEyeApiOptions(options) {
	return {
		host: String(options?.host ?? '').trim(),
		motionEyePort: Number(options?.motionEyePort) || 8765,
		username: String(options?.username || 'admin').trim() || 'admin',
		password: String(options?.password ?? '').trim(),
		requestTimeoutMs: options?.requestTimeoutMs ?? 45000,
		listCacheMs: options?.listCacheMs ?? LIST_CACHE_MS,
		verboseLog: options?.verboseLog,
	};
}

/**
 * Create a MotionEye Config API client.
 * @param {MotionEyeApiOptions} options
 */
function createMotionEyeApi(options) {
	const normalized = normalizeMotionEyeApiOptions(options);
	const host = normalized.host;
	const motionEyePort = normalized.motionEyePort;
	const username = normalized.username;
	const password = normalized.password;
	const requestTimeoutMs = normalized.requestTimeoutMs;
	const listCacheMs = normalized.listCacheMs;
	const verboseLog = normalized.verboseLog;
	const signKey = motionEyeSignKey(password);

	let listCache = null;
	let lastMotionEyeVersion = '';
	/** @type {'signature' | 'session' | null} */
	let authMode = null;
	let sessionCookie = '';
	/**
	 * Serializes saveCameraConfig's read-modify-write per camera. Without this, two
	 * near-simultaneous state changes (e.g. leftText and rightText set together) can
	 * both read the same pre-change config and each write back only their own field,
	 * silently dropping whichever change is written first ("lost update").
	 * @type {Map<number, Promise<unknown>>}
	 */
	const cameraConfigQueues = new Map();

	/**
	 * @param {string} path
	 * @param {string} [method]
	 * @param {string|null} [body]
	 * @param {Record<string, string>} [extraHeaders]
	 * @param {boolean} [binary]
	 * @returns {Promise<{ status: number, body: string | Buffer, headers: import('node:http').IncomingHttpHeaders }>}
	 */
	function httpRequest(path, method = 'GET', body = null, extraHeaders = {}, binary = false) {
		return new Promise((resolve, reject) => {
			/** @type {Record<string, string | number>} */
			const headers = { ...extraHeaders };

			if (body) {
				if (!headers['Content-Type']) {
					headers['Content-Type'] = 'application/json';
				}
				headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
			}

			const requestOptions = {
				hostname: host,
				port: motionEyePort,
				path,
				method,
				timeout: requestTimeoutMs,
				headers,
			};

			const req = http.request(requestOptions, res => {
				if (binary) {
					/** @type {Buffer[]} */
					const chunks = [];
					res.on('data', chunk => {
						chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					});
					res.on('end', () => {
						resolve({
							status: res.statusCode || 0,
							body: Buffer.concat(chunks),
							headers: res.headers,
						});
					});
					return;
				}

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
	 * Obtain session cookie via POST /login (MotionEye 0.44+).
	 * @returns {Promise<void>}
	 */
	async function loginSession() {
		/** @type {Error | null} */
		let lastError = null;

		/**
		 * @param {string} body
		 * @param {string} contentType
		 * @returns {Promise<void>}
		 */
		async function tryLogin(body, contentType) {
			const result = await httpRequest('/login', 'POST', body, { 'Content-Type': contentType });
			const data = parseResponseBody(result.body);

			if (result.status >= 400 || isAuthFailure(result, data)) {
				const message =
					(data && typeof data === 'object' && data !== null && 'error' in data && data.error) ||
					result.body ||
					`HTTP ${result.status}`;
				throw new Error(String(message));
			}

			const cookies = parseSetCookieHeaders(result.headers);
			if (!cookies[SESSION_COOKIE_NAME]) {
				throw new Error('login: no session cookie received');
			}

			sessionCookie = cookies[SESSION_COOKIE_NAME];
			authMode = 'session';
			if (verboseLog) {
				verboseLog('POST /login → session established');
			}
		}

		try {
			await tryLogin(JSON.stringify({ username, password }), 'application/json');
			return;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
		}

		try {
			const formBody = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
			await tryLogin(formBody, 'application/x-www-form-urlencoded');
			return;
		} catch (err) {
			const formError = err instanceof Error ? err : new Error(String(err));
			throw lastError || formError;
		}
	}

	/**
	 * @param {string} path
	 * @param {string} [method]
	 * @param {string|null} [body]
	 * @returns {Promise<{ status: number, body: string, headers: import('node:http').IncomingHttpHeaders }>}
	 */
	async function requestApi(path, method = 'GET', body = null) {
		const pathLabel = apiPathLabel(path);

		async function runWithSignature() {
			const authPath = buildAuthPath(path, method, body, username, signKey);
			return httpRequest(authPath, method, body);
		}

		async function runWithSession() {
			if (!sessionCookie) {
				await loginSession();
			}
			return httpRequest(path, method, body, {
				Cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}`,
			});
		}

		if (authMode === 'signature') {
			const result = await runWithSignature();
			const data = parseResponseBody(result.body);
			if (isAuthFailure(result, data)) {
				throwApiError(result, data, method, pathLabel, verboseLog);
			}
			if (verboseLog) {
				verboseLog(`${method} ${pathLabel} → HTTP ${result.status}`);
			}
			return result;
		}

		if (authMode === 'session') {
			let result = await runWithSession();
			let data = parseResponseBody(result.body);
			if (isAuthFailure(result, data)) {
				sessionCookie = '';
				await loginSession();
				result = await runWithSession();
				data = parseResponseBody(result.body);
			}
			if (isAuthFailure(result, data)) {
				throwApiError(result, data, method, pathLabel, verboseLog);
			}
			if (verboseLog) {
				verboseLog(`${method} ${pathLabel} → HTTP ${result.status}`);
			}
			return result;
		}

		// Unknown auth mode: signature first (0.43.x), then session (0.44+).
		let result = await runWithSignature();
		let data = parseResponseBody(result.body);
		if (!isAuthFailure(result, data)) {
			authMode = 'signature';
			if (verboseLog) {
				verboseLog(`${method} ${pathLabel} → HTTP ${result.status}`);
			}
			return result;
		}

		if (verboseLog) {
			const hint =
				data && typeof data === 'object' && data !== null && 'error' in data
					? String(data.error)
					: 'unauthorized';
			verboseLog(`${method} ${pathLabel} → HTTP ${result.status}: ${hint}, trying POST /login`);
		}

		try {
			await loginSession();
		} catch (loginErr) {
			if (verboseLog) {
				const loginMessage = loginErr instanceof Error ? loginErr.message : String(loginErr);
				verboseLog(`POST /login failed: ${loginMessage}`);
			}
			const loginMessage = loginErr instanceof Error ? loginErr.message : String(loginErr);
			if (loginMessage && loginMessage !== 'unauthorized') {
				throw new Error(loginMessage);
			}
			throwApiError(result, data, method, pathLabel, verboseLog);
		}

		result = await runWithSession();
		data = parseResponseBody(result.body);
		if (isAuthFailure(result, data)) {
			throwApiError(result, data, method, pathLabel, verboseLog);
		}
		if (verboseLog) {
			verboseLog(`${method} ${pathLabel} → HTTP ${result.status}`);
		}
		return result;
	}

	/**
	 * Authenticated binary GET (JPEG download from /picture/...).
	 *
	 * @param {string} path
	 * @param {string} [method]
	 * @returns {Promise<{ status: number, body: Buffer, headers: import('node:http').IncomingHttpHeaders }>}
	 */
	async function requestApiBinary(path, method = 'GET') {
		const pathLabel = apiPathLabel(path);

		async function runWithSignature() {
			const authPath = buildAuthPath(path, method, null, username, signKey);
			const result = await httpRequest(authPath, method, null, {}, true);
			return /** @type {{ status: number, body: Buffer, headers: import('node:http').IncomingHttpHeaders }} */ (
				result
			);
		}

		async function runWithSession() {
			if (!sessionCookie) {
				await loginSession();
			}
			const result = await httpRequest(
				path,
				method,
				null,
				{ Cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}` },
				true,
			);
			return /** @type {{ status: number, body: Buffer, headers: import('node:http').IncomingHttpHeaders }} */ (
				result
			);
		}

		/** @param {{ status: number, body: Buffer }} result */
		function assertBinaryOk(result) {
			const bodyStr = result.body.toString('utf8');
			const data = parseResponseBody(bodyStr);
			if (isAuthFailure({ status: result.status, body: bodyStr }, data)) {
				throwApiError({ status: result.status, body: bodyStr }, data, method, pathLabel, verboseLog);
			}
			if (result.status >= 400) {
				throwApiError({ status: result.status, body: bodyStr }, data, method, pathLabel, verboseLog);
			}
		}

		if (authMode === 'signature') {
			const result = await runWithSignature();
			assertBinaryOk(result);
			if (verboseLog) {
				verboseLog(`${method} ${pathLabel} → HTTP ${result.status} (${result.body.length} bytes)`);
			}
			return result;
		}

		if (authMode === 'session') {
			let result = await runWithSession();
			let bodyStr = result.body.toString('utf8');
			let data = parseResponseBody(bodyStr);
			if (isAuthFailure({ status: result.status, body: bodyStr }, data)) {
				sessionCookie = '';
				await loginSession();
				result = await runWithSession();
				bodyStr = result.body.toString('utf8');
				data = parseResponseBody(bodyStr);
			}
			assertBinaryOk(result);
			if (verboseLog) {
				verboseLog(`${method} ${pathLabel} → HTTP ${result.status} (${result.body.length} bytes)`);
			}
			return result;
		}

		let result = await runWithSignature();
		let bodyStr = result.body.toString('utf8');
		let data = parseResponseBody(bodyStr);
		if (!isAuthFailure({ status: result.status, body: bodyStr }, data)) {
			authMode = 'signature';
			if (verboseLog) {
				verboseLog(`${method} ${pathLabel} → HTTP ${result.status} (${result.body.length} bytes)`);
			}
			return result;
		}

		await loginSession();
		result = await runWithSession();
		bodyStr = result.body.toString('utf8');
		data = parseResponseBody(bodyStr);
		if (isAuthFailure({ status: result.status, body: bodyStr }, data)) {
			throwApiError({ status: result.status, body: bodyStr }, data, method, pathLabel, verboseLog);
		}
		authMode = 'session';
		if (verboseLog) {
			verboseLog(`${method} ${pathLabel} → HTTP ${result.status} (${result.body.length} bytes)`);
		}
		return result;
	}

	/**
	 * @param {Buffer} body
	 * @returns {boolean}
	 */
	function isJpegBuffer(body) {
		return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
	}

	/**
	 * Download the latest saved snapshot JPEG from MotionEye (lastsnap.jpg symlink).
	 * Falls back to the current live frame when lastsnap is not available yet.
	 *
	 * @param {number} cameraId
	 * @returns {Promise<Buffer>}
	 */
	async function downloadPicture(cameraId) {
		const candidates = [`/picture/${cameraId}/download/lastsnap.jpg`, `/picture/${cameraId}/current/`];

		/** @type {Error | null} */
		let lastError = null;
		for (const path of candidates) {
			try {
				const result = await requestApiBinary(path, 'GET');
				if (isJpegBuffer(result.body)) {
					return result.body;
				}
				lastError = new Error(`GET ${path}: response is not a JPEG (${result.body.length} bytes)`);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
			}
		}

		throw lastError || new Error(`Could not download snapshot for camera ${cameraId}`);
	}

	/**
	 * @param {string} path
	 * @param {string} [method]
	 * @param {Record<string, unknown>|null} [bodyObj]
	 * @returns {Promise<MotionEyeApiResult>}
	 */
	async function call(path, method = 'GET', bodyObj = null) {
		const body = bodyObj ? JSON.stringify(bodyObj) : null;
		const result = await requestApi(path, method, body);
		const data = parseResponseBody(result.body);

		if (
			result.status >= 400 ||
			(data && typeof data === 'object' && data !== null && 'error' in data && data.error)
		) {
			throwApiError(result, data, method, apiPathLabel(path), verboseLog);
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
	async function saveCameraConfigNow(cameraId, patch) {
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
	 * Read-modify-write a camera's config, serialized per camera (see cameraConfigQueues).
	 *
	 * @param {number} cameraId
	 * @param {Record<string, unknown>} patch
	 * @returns {Promise<{ changed: boolean, data: unknown }>}
	 */
	function saveCameraConfig(cameraId, patch) {
		const run = () => saveCameraConfigNow(cameraId, patch);
		const previous = cameraConfigQueues.get(cameraId) || Promise.resolve();
		const next = previous.then(run, run);
		cameraConfigQueues.set(
			cameraId,
			next.catch(() => {}),
		);
		return next;
	}

	/**
	 * List a camera's stored media files (snapshots or video clips). Requires MotionEye
	 * to recursively scan the media directory and `stat()` every file server-side — can
	 * be slow for cameras with many stored files, subject to MotionEye's own
	 * `list_media_timeout` (motioneye.conf). Not meant to be called on every status poll.
	 *
	 * @param {number} cameraId
	 * @param {'picture'|'movie'} mediaType
	 * @returns {Promise<Record<string, unknown>[]>}
	 */
	async function listMedia(cameraId, mediaType) {
		const result = await call(`/${mediaType}/${cameraId}/list/`, 'GET');
		const data = result.data;

		if (data && typeof data === 'object' && Array.isArray(/** @type {{ mediaList: unknown }} */ (data).mediaList)) {
			return /** @type {Record<string, unknown>[]} */ (/** @type {{ mediaList: unknown }} */ (data).mediaList);
		}
		if (Array.isArray(data)) {
			// Remote-camera (MotionEye-to-MotionEye) response shape — not expected for local cameras.
			return /** @type {Record<string, unknown>[]} */ (data);
		}

		throw new Error(`${mediaType} list: unexpected response`);
	}

	/**
	 * @param {number} cameraId
	 * @returns {Promise<Record<string, unknown>[]>}
	 */
	async function listPictures(cameraId) {
		return listMedia(cameraId, 'picture');
	}

	/**
	 * @param {number} cameraId
	 * @returns {Promise<Record<string, unknown>[]>}
	 */
	async function listMovies(cameraId) {
		return listMedia(cameraId, 'movie');
	}

	/**
	 * Trigger a snapshot via MotionEye's own action endpoint (authenticated, same
	 * port as everything else). This is the modern replacement for hitting Motion's
	 * raw webcontrol port directly, which requires an extra exposed port and relies
	 * on Motion's internal thread numbering matching MotionEye's camera id.
	 *
	 * @param {number} cameraId
	 * @returns {Promise<Record<string, unknown>>}
	 */
	async function takeSnapshot(cameraId) {
		const result = await call(`/action/${cameraId}/snapshot/`, 'POST');
		return /** @type {Record<string, unknown>} */ (result.data || {});
	}

	/**
	 * @returns {Promise<{ motionEyeVersion: string, motionVersion: string, hostname: string, osVersion: string }>}
	 */
	async function getServerVersions() {
		const result = await requestApi('/version', 'GET');
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
		listMedia,
		listPictures,
		listMovies,
		takeSnapshot,
		downloadPicture,
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
	SESSION_COOKIE_NAME,
	quoteParam,
	computeSignature,
	motionEyeSignKey,
	buildAuthPath,
	parseMotionEyeServerHeader,
	parseVersionPage,
	parseSetCookieHeaders,
	isAuthFailure,
	normalizeMotionEyeApiOptions,
	createMotionEyeApi,
	LIST_CACHE_MS,
};
