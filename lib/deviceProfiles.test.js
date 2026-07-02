'use strict';

const { expect } = require('chai');
const {
	normalizeResolution,
	parseAvailableResolutions,
	normalizeFramerate,
	buildFrameratePatch,
	buildResolutionPatch,
	normalizeRotation,
	buildRotationPatch,
	normalizeBoolean,
	buildAutoBrightnessPatch,
} = require('./deviceProfiles');

describe('deviceProfiles', () => {
	it('normalizeResolution should canonicalize valid values and reject junk', () => {
		expect(normalizeResolution('640x480')).to.equal('640x480');
		expect(normalizeResolution(' 1280 X 720 ')).to.equal('1280x720');
		expect(normalizeResolution('foo')).to.equal('');
		expect(normalizeResolution(null)).to.equal('');
	});

	it('parseAvailableResolutions should dedupe and normalize the list', () => {
		expect(
			parseAvailableResolutions({ available_resolutions: ['640x480', '640x480', '1280X720', 'bad'] }),
		).to.deep.equal(['640x480', '1280x720']);
		expect(parseAvailableResolutions({})).to.deep.equal([]);
		expect(parseAvailableResolutions(null)).to.deep.equal([]);
	});

	it('normalizeFramerate should round and cap to bounds', () => {
		expect(normalizeFramerate('12')).to.equal(12);
		expect(normalizeFramerate(12.6)).to.equal(13);
		expect(normalizeFramerate(0)).to.equal(1);
		expect(normalizeFramerate(999)).to.equal(30);
		expect(normalizeFramerate('abc')).to.equal(null);
	});

	it('buildFrameratePatch should return a patch or an error', () => {
		expect(buildFrameratePatch(15)).to.deep.equal({ patch: { framerate: 15 }, value: 15, error: null });
		const bad = buildFrameratePatch('abc');
		expect(bad.patch).to.equal(null);
		expect(bad.error).to.be.a('string');
	});

	it('buildResolutionPatch should accept supported values', () => {
		expect(buildResolutionPatch('640x480', ['640x480', '1280x720'])).to.deep.equal({
			patch: { resolution: '640x480' },
			value: '640x480',
			error: null,
		});
	});

	it('buildResolutionPatch should reject unsupported values with an error', () => {
		const result = buildResolutionPatch('9999x9999', ['640x480']);
		expect(result.patch).to.equal(null);
		expect(result.error).to.include('not supported');
	});

	it('buildResolutionPatch should reject malformed values', () => {
		const result = buildResolutionPatch('nope');
		expect(result.patch).to.equal(null);
		expect(result.error).to.include('invalid resolution');
	});

	it('buildResolutionPatch should skip validation when no list is provided', () => {
		expect(buildResolutionPatch('800x600', [])).to.deep.equal({
			patch: { resolution: '800x600' },
			value: '800x600',
			error: null,
		});
	});

	it('normalizeRotation should accept only 0/90/180/270', () => {
		expect(normalizeRotation(0)).to.equal(0);
		expect(normalizeRotation('180')).to.equal(180);
		expect(normalizeRotation(45)).to.equal(null);
		expect(normalizeRotation('abc')).to.equal(null);
	});

	it('buildRotationPatch should return a patch or an error', () => {
		expect(buildRotationPatch(90)).to.deep.equal({ patch: { rotation: 90 }, value: 90, error: null });
		const bad = buildRotationPatch(33);
		expect(bad.patch).to.equal(null);
		expect(bad.error).to.include('invalid rotation');
	});

	it('normalizeBoolean should coerce common truthy/falsey strings', () => {
		expect(normalizeBoolean(true)).to.equal(true);
		expect(normalizeBoolean('true')).to.equal(true);
		expect(normalizeBoolean('on')).to.equal(true);
		expect(normalizeBoolean('1')).to.equal(true);
		expect(normalizeBoolean(false)).to.equal(false);
		expect(normalizeBoolean('off')).to.equal(false);
		expect(normalizeBoolean('0')).to.equal(false);
	});

	it('buildAutoBrightnessPatch should map to the auto_brightness key', () => {
		expect(buildAutoBrightnessPatch(true)).to.deep.equal({
			patch: { auto_brightness: true },
			value: true,
			error: null,
		});
		expect(buildAutoBrightnessPatch('off')).to.deep.equal({
			patch: { auto_brightness: false },
			value: false,
			error: null,
		});
	});
});
