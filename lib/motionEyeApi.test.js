'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { expect } = require('chai');
const {
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
} = require('./motionEyeApi');

describe('normalizeMotionEyeApiOptions', () => {
	it('should trim host, username, and password', () => {
		expect(
			normalizeMotionEyeApiOptions({
				host: ' 192.168.1.10 ',
				username: ' admin ',
				password: ' secret ',
			}),
		).to.deep.include({
			host: '192.168.1.10',
			username: 'admin',
			password: 'secret',
		});
	});

	it('should default empty username to admin', () => {
		expect(normalizeMotionEyeApiOptions({ host: 'x', username: '   ' }).username).to.equal('admin');
	});
});

describe('motionEyeApi session helpers', () => {
	it('parseSetCookieHeaders should extract cookie values', () => {
		expect(
			parseSetCookieHeaders({
				'set-cookie': ['user=abc123; Path=/; HttpOnly; SameSite=Strict', 'other=x'],
			}),
		).to.deep.equal({ user: 'abc123', other: 'x' });
	});

	it('isAuthFailure should detect unauthorized responses', () => {
		expect(isAuthFailure({ status: 403, body: '' }, null)).to.equal(true);
		expect(isAuthFailure({ status: 200, body: '{"error":"unauthorized"}' }, { error: 'unauthorized' })).to.equal(
			true,
		);
		expect(isAuthFailure({ status: 200, body: '{}' }, {})).to.equal(false);
	});
});

describe('motionEyeApi signature', () => {
	it('quoteParam should encode special characters', () => {
		expect(quoteParam('hello world')).to.equal('hello%20world');
		expect(quoteParam('a!b*c')).to.equal('a!b*c');
	});

	it('motionEyeSignKey should return empty string for empty password', () => {
		expect(motionEyeSignKey('')).to.equal('');
		expect(motionEyeSignKey(null)).to.equal('');
		expect(motionEyeSignKey(undefined)).to.equal('');
	});

	it('motionEyeSignKey should return SHA1 hex of password', () => {
		const expected = crypto.createHash('sha1').update('testpass', 'utf8').digest('hex').toLowerCase();
		expect(motionEyeSignKey('testpass')).to.equal(expected);
	});

	it('computeSignature should be deterministic for GET /config/list without password', () => {
		const path = '/config/list?_username=admin';
		const sig1 = computeSignature('GET', path, '', '');
		const sig2 = computeSignature('GET', path, '', '');
		expect(sig1).to.equal(sig2);
		expect(sig1).to.match(/^[a-f0-9]{40}$/);
	});

	it('computeSignature should differ when password sign key is set', () => {
		const path = '/config/list?_username=admin';
		const signKey = motionEyeSignKey('secret');
		const withoutPassword = computeSignature('GET', path, '', '');
		const withPassword = computeSignature('GET', path, '', signKey);
		expect(withoutPassword).to.not.equal(withPassword);
	});

	it('computeSignature should sort query parameters before signing', () => {
		const path = '/config/list?z=1&_username=admin&a=2';
		const signature = computeSignature('GET', path, '', '');
		const reordered = computeSignature('GET', '/config/list?a=2&_username=admin&z=1', '', '');
		expect(signature).to.equal(reordered);
	});

	it('computeSignature should ignore existing _signature parameter', () => {
		const withSig = computeSignature('GET', '/config/list?_username=admin&_signature=old', '', '');
		const withoutSig = computeSignature('GET', '/config/list?_username=admin', '', '');
		expect(withSig).to.equal(withoutSig);
	});

	it('buildAuthPath should append _username and _signature', () => {
		const authPath = buildAuthPath('/config/list', 'GET', null, 'admin', '');
		expect(authPath).to.match(/^\/config\/list\?_username=admin&_signature=[a-f0-9]{40}$/);
	});

	it('buildAuthPath should use & joiner when path already has query string', () => {
		const authPath = buildAuthPath('/config/list?foo=bar', 'GET', null, 'admin', '');
		expect(authPath).to.include('/config/list?foo=bar&_username=admin&_signature=');
	});
});

describe('motionEyeApi saveCameraConfig concurrency', () => {
	/**
	 * Minimal MotionEye stub: serves /config/list from an in-memory camera object and
	 * applies whatever full config is POSTed to /config/<id>/set/ (mirrors the real
	 * server, which replaces the stored config with the posted ui dict).
	 */
	function startFakeMotionEye(camera) {
		let current = { ...camera };
		const server = http.createServer((req, res) => {
			const chunks = [];
			req.on('data', chunk => chunks.push(chunk));
			req.on('end', () => {
				if (req.method === 'GET' && req.url.startsWith('/config/list')) {
					// Small delay to widen the window for concurrent reads to overlap.
					setTimeout(() => {
						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ cameras: [current] }));
					}, 15);
					return;
				}
				if (req.method === 'POST' && req.url.startsWith(`/config/${camera.id}/set/`)) {
					current = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end('{}');
					return;
				}
				res.writeHead(404);
				res.end();
			});
		});

		return new Promise(resolve => {
			server.listen(0, '127.0.0.1', () => resolve({ server, getCurrent: () => current }));
		});
	}

	it('should not lose an update when two patches are saved concurrently for the same camera', async () => {
		const { server, getCurrent } = await startFakeMotionEye({
			id: 1,
			name: 'Auffahrt',
			left_text: 'camera-name',
			right_text: 'timestamp',
		});

		try {
			const api = createMotionEyeApi({
				host: '127.0.0.1',
				motionEyePort: server.address().port,
				username: 'admin',
				password: '',
				requestTimeoutMs: 5000,
			});

			await Promise.all([
				api.saveCameraConfig(1, { left_text: 'custom-text' }),
				api.saveCameraConfig(1, { right_text: 'disabled' }),
			]);

			expect(getCurrent().left_text).to.equal('custom-text');
			expect(getCurrent().right_text).to.equal('disabled');
		} finally {
			server.close();
		}
	});
});

describe('motionEyeApi listMedia', () => {
	/** Minimal MotionEye stub serving /picture/<id>/list/ and /movie/<id>/list/. */
	function startFakeMediaServer({ pictures, movies, moviesError }) {
		const server = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			if (req.url.startsWith('/picture/1/list/')) {
				res.end(JSON.stringify({ mediaList: pictures, cameraName: 'Cam 1' }));
			} else if (req.url.startsWith('/movie/1/list/')) {
				if (moviesError) {
					res.end(JSON.stringify({ error: moviesError }));
				} else {
					res.end(JSON.stringify({ mediaList: movies, cameraName: 'Cam 1' }));
				}
			} else {
				res.writeHead(404);
				res.end();
			}
		});

		return new Promise(resolve => {
			server.listen(0, '127.0.0.1', () => resolve(server));
		});
	}

	it('listPictures/listMovies should return the mediaList array', async () => {
		const pictures = [{ path: '/a.jpg', sizeStr: '1.0 MB' }];
		const movies = [{ path: '/b.avi', sizeStr: '2.0 MB' }];
		const server = await startFakeMediaServer({ pictures, movies });

		try {
			const api = createMotionEyeApi({
				host: '127.0.0.1',
				motionEyePort: server.address().port,
				username: 'admin',
				password: '',
				requestTimeoutMs: 5000,
			});

			expect(await api.listPictures(1)).to.deep.equal(pictures);
			expect(await api.listMovies(1)).to.deep.equal(movies);
		} finally {
			server.close();
		}
	});

	it('listMedia should throw when MotionEye reports an error', async () => {
		const server = await startFakeMediaServer({ pictures: [], movies: [], moviesError: 'Failed to get movies list.' });

		try {
			const api = createMotionEyeApi({
				host: '127.0.0.1',
				motionEyePort: server.address().port,
				username: 'admin',
				password: '',
				requestTimeoutMs: 5000,
			});

			let caught = null;
			try {
				await api.listMovies(1);
			} catch (error) {
				caught = error;
			}
			expect(caught).to.be.an('error');
			expect(caught.message).to.equal('Failed to get movies list.');
		} finally {
			server.close();
		}
	});
});

describe('motionEyeApi version parsing', () => {
	it('parseMotionEyeServerHeader should extract version from Server header', () => {
		expect(parseMotionEyeServerHeader('motionEye/0.44.0')).to.equal('0.44.0');
		expect(parseMotionEyeServerHeader('MotionEye/1.2.3')).to.equal('1.2.3');
		expect(parseMotionEyeServerHeader('nginx')).to.equal('');
		expect(parseMotionEyeServerHeader('')).to.equal('');
	});

	it('parseVersionPage should parse MotionEye /version HTML body', () => {
		const html = [
			'hostname = "motioneye-pi"',
			'version = "0.44.0"',
			'motion_version = "4.5.1"',
			'os_version = "Raspbian GNU/Linux 12"',
		].join('\n');

		expect(parseVersionPage(html)).to.deep.equal({
			motionEyeVersion: '0.44.0',
			motionVersion: '4.5.1',
			hostname: 'motioneye-pi',
			osVersion: 'Raspbian GNU/Linux 12',
		});
	});
});
