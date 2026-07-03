'use strict';

/** Framerate bounds matching the MotionEye device panel slider. */
const FRAMERATE_MIN = 1;
const FRAMERATE_MAX = 30;

/** Match a "WIDTHxHEIGHT" resolution string (MotionEye UI config format). */
const RESOLUTION_REGEX = /^(\d{2,4})x(\d{2,4})$/;

/** Valid MotionEye video rotation values (degrees). */
const VALID_ROTATIONS = [0, 90, 180, 270];

/**
 * Normalize a resolution value to canonical "WIDTHxHEIGHT" (e.g. "640x480").
 *
 * @param {unknown} value
 * @returns {string} Normalized string, or '' when the format is invalid.
 */
function normalizeResolution(value) {
	if (value == null) {
		return '';
	}
	const str = String(value).trim().toLowerCase().replace(/\s+/g, '');
	const match = str.match(RESOLUTION_REGEX);
	if (!match) {
		return '';
	}
	return `${parseInt(match[1], 10)}x${parseInt(match[2], 10)}`;
}

/**
 * Extract the list of supported resolutions from a MotionEye UI config.
 *
 * @param {Record<string, unknown> | null | undefined} uiConfig
 * @returns {string[]} Deduplicated normalized resolutions (empty when unknown).
 */
function parseAvailableResolutions(uiConfig) {
	const list = uiConfig ? uiConfig.available_resolutions : null;
	if (!Array.isArray(list)) {
		return [];
	}

	/** @type {string[]} */
	const out = [];
	for (const entry of list) {
		const norm = normalizeResolution(entry);
		if (norm && !out.includes(norm)) {
			out.push(norm);
		}
	}
	return out;
}

/**
 * @param {unknown} value
 * @param {{ min?: number, max?: number }} [options]
 * @returns {number | null} Capped integer framerate, or null when not a number.
 */
function normalizeFramerate(value, { min = FRAMERATE_MIN, max = FRAMERATE_MAX } = {}) {
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
 * @param {{ min?: number, max?: number }} [options]
 * @returns {{ patch: { framerate: number } | null, value: number | null, error: string | null }}
 */
function buildFrameratePatch(value, options) {
	const framerate = normalizeFramerate(value, options);
	if (framerate == null) {
		return { patch: null, value: null, error: `invalid framerate "${String(value)}" (expected a number)` };
	}
	return { patch: { framerate }, value: framerate, error: null };
}

/**
 * Build a resolution patch, validating against the camera's supported list.
 *
 * @param {unknown} value
 * @param {string[]} [available] Supported resolutions (empty = skip validation).
 * @returns {{ patch: { resolution: string } | null, value: string, error: string | null }}
 */
function buildResolutionPatch(value, available = []) {
	const resolution = normalizeResolution(value);
	if (!resolution) {
		return {
			patch: null,
			value: '',
			error: `invalid resolution "${String(value)}" (expected e.g. 640x480)`,
		};
	}

	if (Array.isArray(available) && available.length && !available.includes(resolution)) {
		return {
			patch: null,
			value: resolution,
			error: `resolution "${resolution}" not supported (available: ${available.join(', ')})`,
		};
	}

	return { patch: { resolution }, value: resolution, error: null };
}

/**
 * @param {unknown} value
 * @returns {number | null} One of 0/90/180/270, or null when invalid.
 */
function normalizeRotation(value) {
	const num = Math.round(Number(value));
	if (!Number.isFinite(num)) {
		return null;
	}
	return VALID_ROTATIONS.includes(num) ? num : null;
}

/**
 * @param {unknown} value
 * @returns {{ patch: { rotation: number } | null, value: number | null, error: string | null }}
 */
function buildRotationPatch(value) {
	const rotation = normalizeRotation(value);
	if (rotation == null) {
		return {
			patch: null,
			value: null,
			error: `invalid rotation "${String(value)}" (allowed: ${VALID_ROTATIONS.join(', ')})`,
		};
	}
	return { patch: { rotation }, value: rotation, error: null };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function normalizeBoolean(value) {
	if (typeof value === 'boolean') {
		return value;
	}
	const str = String(value).trim().toLowerCase();
	return str === 'true' || str === '1' || str === 'on' || str === 'yes';
}

/**
 * @param {unknown} value
 * @returns {{ patch: { auto_brightness: boolean }, value: boolean, error: null }}
 */
function buildAutoBrightnessPatch(value) {
	const enabled = normalizeBoolean(value);
	return { patch: { auto_brightness: enabled }, value: enabled, error: null };
}

/**
 * Toggle the privacy mask. The mask regions (`privacy_mask_lines`) are drawn in
 * the MotionEye UI and preserved by the full-config save; this only flips it on/off.
 *
 * @param {unknown} value
 * @returns {{ patch: { privacy_mask: boolean }, value: boolean, error: null }}
 */
function buildPrivacyMaskPatch(value) {
	const enabled = normalizeBoolean(value);
	return { patch: { privacy_mask: enabled }, value: enabled, error: null };
}

/** Valid MotionEye left/right text overlay modes (UI config `left_text`/`right_text`). */
const TEXT_POSITION_OPTIONS = ['camera-name', 'timestamp', 'custom-text', 'disabled'];

/** Text overlay scale bounds matching the MotionEye "text size" slider. */
const TEXT_SCALE_MIN = 1;
const TEXT_SCALE_MAX = 10;

/**
 * @param {unknown} value
 * @returns {{ patch: { text_overlay: boolean }, value: boolean, error: null }}
 */
function buildTextOverlayPatch(value) {
	const enabled = normalizeBoolean(value);
	return { patch: { text_overlay: enabled }, value: enabled, error: null };
}

/**
 * @param {unknown} value
 * @returns {string | null} One of TEXT_POSITION_OPTIONS, or null when invalid.
 */
function normalizeTextPosition(value) {
	const str = String(value ?? '')
		.trim()
		.toLowerCase();
	return TEXT_POSITION_OPTIONS.includes(str) ? str : null;
}

/**
 * @param {unknown} value
 * @returns {{ patch: { left_text: string } | null, value: string | null, error: string | null }}
 */
function buildLeftTextPatch(value) {
	const leftText = normalizeTextPosition(value);
	if (leftText == null) {
		return {
			patch: null,
			value: null,
			error: `invalid leftText "${String(value)}" (allowed: ${TEXT_POSITION_OPTIONS.join(', ')})`,
		};
	}
	return { patch: { left_text: leftText }, value: leftText, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { right_text: string } | null, value: string | null, error: string | null }}
 */
function buildRightTextPatch(value) {
	const rightText = normalizeTextPosition(value);
	if (rightText == null) {
		return {
			patch: null,
			value: null,
			error: `invalid rightText "${String(value)}" (allowed: ${TEXT_POSITION_OPTIONS.join(', ')})`,
		};
	}
	return { patch: { right_text: rightText }, value: rightText, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { custom_left_text: string }, value: string, error: null }}
 */
function buildCustomLeftTextPatch(value) {
	const text = String(value ?? '');
	return { patch: { custom_left_text: text }, value: text, error: null };
}

/**
 * @param {unknown} value
 * @returns {{ patch: { custom_right_text: string }, value: string, error: null }}
 */
function buildCustomRightTextPatch(value) {
	const text = String(value ?? '');
	return { patch: { custom_right_text: text }, value: text, error: null };
}

/**
 * @param {unknown} value
 * @returns {number | null} Capped integer text scale (1-10), or null when not a number.
 */
function normalizeTextScale(value) {
	const num = Math.round(Number(value));
	if (!Number.isFinite(num)) {
		return null;
	}
	if (num < TEXT_SCALE_MIN) {
		return TEXT_SCALE_MIN;
	}
	if (num > TEXT_SCALE_MAX) {
		return TEXT_SCALE_MAX;
	}
	return num;
}

/**
 * @param {unknown} value
 * @returns {{ patch: { text_scale: number } | null, value: number | null, error: string | null }}
 */
function buildTextScalePatch(value) {
	const textScale = normalizeTextScale(value);
	if (textScale == null) {
		return { patch: null, value: null, error: `invalid textScale "${String(value)}" (expected a number)` };
	}
	return { patch: { text_scale: textScale }, value: textScale, error: null };
}

module.exports = {
	FRAMERATE_MIN,
	FRAMERATE_MAX,
	RESOLUTION_REGEX,
	VALID_ROTATIONS,
	normalizeResolution,
	parseAvailableResolutions,
	normalizeFramerate,
	buildFrameratePatch,
	buildResolutionPatch,
	normalizeRotation,
	buildRotationPatch,
	normalizeBoolean,
	buildAutoBrightnessPatch,
	buildPrivacyMaskPatch,
	TEXT_POSITION_OPTIONS,
	TEXT_SCALE_MIN,
	TEXT_SCALE_MAX,
	buildTextOverlayPatch,
	normalizeTextPosition,
	buildLeftTextPatch,
	buildRightTextPatch,
	buildCustomLeftTextPatch,
	buildCustomRightTextPatch,
	normalizeTextScale,
	buildTextScalePatch,
};
