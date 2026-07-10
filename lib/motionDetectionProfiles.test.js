'use strict';

const { expect } = require('chai');
const {
	normalizeFrameChangeThreshold,
	normalizeNoiseLevel,
	normalizeDespeckleFilter,
	buildMotionDetectionPatch,
	buildFrameChangeThresholdPatch,
	buildAutoThresholdTuningPatch,
	buildAutoNoiseDetectPatch,
	buildNoiseLevelPatch,
	buildEventGapPatch,
	buildMinimumMotionFramesPatch,
	buildLightSwitchDetectPatch,
	buildDespeckleFilterPatch,
	buildPreCapturePatch,
	buildPostCapturePatch,
} = require('./motionDetectionProfiles');

describe('motionDetectionProfiles', () => {
	it('normalizeFrameChangeThreshold should round to one decimal and clamp 0-20', () => {
		expect(normalizeFrameChangeThreshold(1.24)).to.equal(1.2);
		expect(normalizeFrameChangeThreshold('7.05')).to.equal(7.1);
		expect(normalizeFrameChangeThreshold(-1)).to.equal(0);
		expect(normalizeFrameChangeThreshold(99)).to.equal(20);
		expect(normalizeFrameChangeThreshold('abc')).to.equal(null);
	});

	it('normalizeNoiseLevel should round and clamp 0-255', () => {
		expect(normalizeNoiseLevel(32)).to.equal(32);
		expect(normalizeNoiseLevel(2.6)).to.equal(3);
		expect(normalizeNoiseLevel(-5)).to.equal(0);
		expect(normalizeNoiseLevel(999)).to.equal(255);
	});

	it('normalizeDespeckleFilter should treat non-empty strings as enabled', () => {
		expect(normalizeDespeckleFilter(true)).to.equal(true);
		expect(normalizeDespeckleFilter('EedDl')).to.equal(true);
		expect(normalizeDespeckleFilter('')).to.equal(false);
		expect(normalizeDespeckleFilter(false)).to.equal(false);
	});

	it('buildFrameChangeThresholdPatch should map to frame_change_threshold', () => {
		expect(buildFrameChangeThresholdPatch(1.5)).to.deep.equal({
			patch: { frame_change_threshold: 1.5 },
			value: 1.5,
			error: null,
		});
	});

	it('buildAutoThresholdTuningPatch should map to auto_threshold_tuning', () => {
		expect(buildAutoThresholdTuningPatch('on')).to.deep.equal({
			patch: { auto_threshold_tuning: true },
			value: true,
			error: null,
		});
	});

	it('buildAutoNoiseDetectPatch should map to auto_noise_detect', () => {
		expect(buildAutoNoiseDetectPatch(false)).to.deep.equal({
			patch: { auto_noise_detect: false },
			value: false,
			error: null,
		});
	});

	it('buildNoiseLevelPatch should map to noise_level', () => {
		expect(buildNoiseLevelPatch(64)).to.deep.equal({
			patch: { noise_level: 64 },
			value: 64,
			error: null,
		});
	});

	it('buildEventGapPatch should map to event_gap', () => {
		expect(buildEventGapPatch(30)).to.deep.equal({
			patch: { event_gap: 30 },
			value: 30,
			error: null,
		});
		const bad = buildEventGapPatch('abc');
		expect(bad.patch).to.equal(null);
		expect(bad.error).to.be.a('string');
	});

	it('buildMinimumMotionFramesPatch should map to minimum_motion_frames', () => {
		expect(buildMinimumMotionFramesPatch(10)).to.deep.equal({
			patch: { minimum_motion_frames: 10 },
			value: 10,
			error: null,
		});
	});

	it('buildLightSwitchDetectPatch should map to light_switch_detect', () => {
		expect(buildLightSwitchDetectPatch(0)).to.deep.equal({
			patch: { light_switch_detect: 0 },
			value: 0,
			error: null,
		});
	});

	it('buildDespeckleFilterPatch should map to despeckle_filter boolean', () => {
		expect(buildDespeckleFilterPatch(true)).to.deep.equal({
			patch: { despeckle_filter: true },
			value: true,
			error: null,
		});
	});

	it('buildPreCapturePatch and buildPostCapturePatch should map frame counts', () => {
		expect(buildPreCapturePatch(5)).to.deep.equal({
			patch: { pre_capture: 5 },
			value: 5,
			error: null,
		});
		expect(buildPostCapturePatch(10)).to.deep.equal({
			patch: { post_capture: 10 },
			value: 10,
			error: null,
		});
	});

	it('buildMotionDetectionPatch should dispatch by param id', () => {
		expect(buildMotionDetectionPatch('eventGap', 30).patch).to.deep.equal({ event_gap: 30 });
		expect(buildMotionDetectionPatch('unknown', 1).patch).to.equal(null);
	});
});
