'use strict';

const crypto = require('node:crypto');
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
