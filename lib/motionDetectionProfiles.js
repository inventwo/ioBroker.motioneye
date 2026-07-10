'use strict';

const { normalizeBoolean } = require('./deviceProfiles');

/** Frame change threshold bounds matching the MotionEye motion-detection slider (0–20 %). */
const FRAME_CHANGE_THRESHOLD_MIN = 0;
const FRAME_CHANGE_THRESHOLD_MAX = 20;

/** Manual noise level bounds in the MotionEye UI (0–255). */
const NOISE_LEVEL_MIN = 0;
const NOISE_LEVEL_MAX = 255;

/** Seconds between motion events (`event_gap`). */
const EVENT_GAP_MIN = 1;
const EVENT_GAP_MAX = 86400;

/** Pre/post capture frame bounds (`pre_capture` / `post_capture`). */
const CAPTURE_FRAMES_MIN = 0;
const CAPTURE_FRAMES_MAX = 1000;

/** Minimum motion frames before a trigger (`minimum_motion_frames`). */
const MINIMUM_MOTION_FRAMES_MIN = 0;
const MINIMUM_MOTION_FRAMES_MAX = 1000;

/** Light switch detection percent (`light_switch_detect`). */
const LIGHT_SWITCH_DETECT_MIN = 0;
const LIGHT_SWITCH_DETECT_MAX = 100;

/**
 * @param {unknown} value
 * @param {{ min?: number, max?: number }} [options]
 * @returns {number | null} Rounded integer in range, or null when not a number.
 */
function normalizeInteger(value, { min, max }) {
	const num = Math.round(Number(value));
	if (!Number.isFinite(num)) {
		return null;
	}
	if (num < min) {
		return min;
	}
	if (num > max) {
		return max;
	}
	return num;
}

/**
 * @param {unknown} value
 * @returns {number | null} Percent threshold rounded to one decimal, or null when invalid.
 */
function normalizeFrameChangeThreshold(value) {
	const num = Number(value);
	if (!Number.isFinite(num)) {
		return null;
	}
	const rounded = Math.round(num * 10) / 10;
	if (rounded < FRAME_CHANGE_THRESHOLD_MIN) {
		return FRAME_CHANGE_THRESHOLD_MIN;
	}
	if (rounded > FRAME_CHANGE_THRESHOLD_MAX) {
		return FRAME_CHANGE_THRESHOLD_MAX;
	}
	return rounded;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeNoiseLevel(value) {
	return normalizeInteger(value, { min: NOISE_LEVEL_MIN, max: NOISE_LEVEL_MAX });
}

/**
 * MotionEye stores despeckle as a filter string (e.g. `EedDl`) or empty when off.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function normalizeDespeckleFilter(value) {
	if (typeof value === 'boolean') {
		return value;
	}
	return Boolean(value && String(value).trim());
}

/**
 * @param {unknown} value
 * @returns {{ patch: { frame_change_threshold: number } | null, value: number | null, error: string | null }}
 */
function buildFrameChangeThresholdPatch(value) {
	const frameChangeThreshold = normalizeFrameChangeThreshold(value);
	if (frameChangeThreshold == null) {
		return {
			patch: null,
			value: null,
			error: `invalid frameChangeThreshold "${String(value)}" (expected a number)`,
		};
	}
	return { patch: { frame_change_threshold: frameChangeThreshold }, value: frameChangeThreshold, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { auto_threshold_tuning: boolean }, value: boolean, error: null }}
 */
function buildAutoThresholdTuningPatch(value) {
	const enabled = normalizeBoolean(value);
	return { patch: { auto_threshold_tuning: enabled }, value: enabled, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { auto_noise_detect: boolean }, value: boolean, error: null }}
 */
function buildAutoNoiseDetectPatch(value) {
	const enabled = normalizeBoolean(value);
	return { patch: { auto_noise_detect: enabled }, value: enabled, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { noise_level: number } | null, value: number | null, error: string | null }}
 */
function buildNoiseLevelPatch(value) {
	const noiseLevel = normalizeNoiseLevel(value);
	if (noiseLevel == null) {
		return {
			patch: null,
			value: null,
			error: `invalid noiseLevel "${String(value)}" (expected a number)`,
		};
	}
	return { patch: { noise_level: noiseLevel }, value: noiseLevel, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { event_gap: number } | null, value: number | null, error: string | null }}
 */
function buildEventGapPatch(value) {
	const eventGap = normalizeInteger(value, { min: EVENT_GAP_MIN, max: EVENT_GAP_MAX });
	if (eventGap == null) {
		return {
			patch: null,
			value: null,
			error: `invalid eventGap "${String(value)}" (expected a number)`,
		};
	}
	return { patch: { event_gap: eventGap }, value: eventGap, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { minimum_motion_frames: number } | null, value: number | null, error: string | null }}
 */
function buildMinimumMotionFramesPatch(value) {
	const minimumMotionFrames = normalizeInteger(value, {
		min: MINIMUM_MOTION_FRAMES_MIN,
		max: MINIMUM_MOTION_FRAMES_MAX,
	});
	if (minimumMotionFrames == null) {
		return {
			patch: null,
			value: null,
			error: `invalid minimumMotionFrames "${String(value)}" (expected a number)`,
		};
	}
	return {
		patch: { minimum_motion_frames: minimumMotionFrames },
		value: minimumMotionFrames,
		error: null,
	};
}

/**
 * @param {unknown} value
 * @returns {{ patch: { light_switch_detect: number } | null, value: number | null, error: string | null }}
 */
function buildLightSwitchDetectPatch(value) {
	const lightSwitchDetect = normalizeInteger(value, {
		min: LIGHT_SWITCH_DETECT_MIN,
		max: LIGHT_SWITCH_DETECT_MAX,
	});
	if (lightSwitchDetect == null) {
		return {
			patch: null,
			value: null,
			error: `invalid lightSwitchDetect "${String(value)}" (expected a number)`,
		};
	}
	return {
		patch: { light_switch_detect: lightSwitchDetect },
		value: lightSwitchDetect,
		error: null,
	};
}

/**
 * @param {unknown} value
 * @returns {{ patch: { despeckle_filter: boolean }, value: boolean, error: null }}
 */
function buildDespeckleFilterPatch(value) {
	const enabled = normalizeBoolean(value);
	return { patch: { despeckle_filter: enabled }, value: enabled, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { pre_capture: number } | null, value: number | null, error: string | null }}
 */
function buildPreCapturePatch(value) {
	const preCapture = normalizeInteger(value, { min: CAPTURE_FRAMES_MIN, max: CAPTURE_FRAMES_MAX });
	if (preCapture == null) {
		return {
			patch: null,
			value: null,
			error: `invalid preCapture "${String(value)}" (expected a number)`,
		};
	}
	return { patch: { pre_capture: preCapture }, value: preCapture, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { post_capture: number } | null, value: number | null, error: string | null }}
 */
function buildPostCapturePatch(value) {
	const postCapture = normalizeInteger(value, { min: CAPTURE_FRAMES_MIN, max: CAPTURE_FRAMES_MAX });
	if (postCapture == null) {
		return {
			patch: null,
			value: null,
			error: `invalid postCapture "${String(value)}" (expected a number)`,
		};
	}
	return { patch: { post_capture: postCapture }, value: postCapture, error: null };
}

/** Writable motion-detection datapoint ids under `motiondetection.*`. */
const MOTION_DETECTION_PARAM_IDS = [
	'frameChangeThreshold',
	'autoThresholdTuning',
	'autoNoiseDetect',
	'noiseLevel',
	'eventGap',
	'minimumMotionFrames',
	'lightSwitchDetect',
	'despeckleFilter',
	'preCapture',
	'postCapture',
];

/**
 * @param {string} param
 * @param {unknown} value
 * @returns {{ patch: Record<string, unknown> | null, value: unknown, error: string | null }}
 */
function buildMotionDetectionPatch(param, value) {
	switch (param) {
		case 'frameChangeThreshold':
			return buildFrameChangeThresholdPatch(value);
		case 'autoThresholdTuning':
			return buildAutoThresholdTuningPatch(value);
		case 'autoNoiseDetect':
			return buildAutoNoiseDetectPatch(value);
		case 'noiseLevel':
			return buildNoiseLevelPatch(value);
		case 'eventGap':
			return buildEventGapPatch(value);
		case 'minimumMotionFrames':
			return buildMinimumMotionFramesPatch(value);
		case 'lightSwitchDetect':
			return buildLightSwitchDetectPatch(value);
		case 'despeckleFilter':
			return buildDespeckleFilterPatch(value);
		case 'preCapture':
			return buildPreCapturePatch(value);
		case 'postCapture':
			return buildPostCapturePatch(value);
		default:
			return { patch: null, value: null, error: `unknown motion detection param "${param}"` };
	}
}

module.exports = {
	FRAME_CHANGE_THRESHOLD_MIN,
	FRAME_CHANGE_THRESHOLD_MAX,
	NOISE_LEVEL_MIN,
	NOISE_LEVEL_MAX,
	EVENT_GAP_MIN,
	EVENT_GAP_MAX,
	CAPTURE_FRAMES_MIN,
	CAPTURE_FRAMES_MAX,
	MINIMUM_MOTION_FRAMES_MIN,
	MINIMUM_MOTION_FRAMES_MAX,
	LIGHT_SWITCH_DETECT_MIN,
	LIGHT_SWITCH_DETECT_MAX,
	MOTION_DETECTION_PARAM_IDS,
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
};
