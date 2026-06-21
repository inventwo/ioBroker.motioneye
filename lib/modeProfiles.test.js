'use strict';

const { expect } = require('chai');
const { normalizeMode, inferModeFromConfig, buildModePatch } = require('./modeProfiles');

describe('modeProfiles', () => {
	it('normalizeMode should accept aliases', () => {
		expect(normalizeMode('scharf')).to.equal('sharp');
		expect(normalizeMode('aus')).to.equal('off');
		expect(normalizeMode('trigger')).to.equal('still');
		expect(normalizeMode('unknown')).to.equal(null);
	});

	it('inferModeFromConfig should derive mode from MotionEye flags', () => {
		expect(inferModeFromConfig({ motion_detection: false, movies: false })).to.equal('off');
		expect(inferModeFromConfig({ motion_detection: true, movies: false })).to.equal('still');
		expect(inferModeFromConfig({ motion_detection: true, movies: true })).to.equal('sharp');
	});

	it('buildModePatch should include webhook URL for still and sharp', () => {
		const still = buildModePatch('still', 'http://iobroker:8090/motioneye.0/webhook/cam?value=true');
		expect(still.motion_detection).to.equal(true);
		expect(still.movies).to.equal(false);
		expect(still.web_hook_notifications_url).to.include('webhook/cam');

		const sharp = buildModePatch('sharp', 'http://iobroker/webhook');
		expect(sharp.movie_format).to.equal('mp4');
		expect(sharp.recording_mode).to.equal('motion-triggered');
	});

	it('buildModePatch off should disable webhook', () => {
		const off = buildModePatch('off');
		expect(off.web_hook_notifications_enabled).to.equal(false);
		expect(off).to.not.have.property('web_hook_notifications_url');
	});
});
