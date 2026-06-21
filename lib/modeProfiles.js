'use strict';

/** @type {Record<string, string>} */
const MODE_ALIASES = {
	off: 'off',
	aus: 'off',
	0: 'off',
	false: 'off',
	still: 'still',
	ruhig: 'still',
	trigger: 'still',
	sharp: 'sharp',
	scharf: 'sharp',
	armed: 'sharp',
	1: 'sharp',
	true: 'sharp',
};

/** @type {Record<string, Record<string, unknown>>} */
const MODE_PROFILES = {
	off: {
		motion_detection: false,
		movies: false,
		web_hook_notifications_enabled: false,
	},
	still: {
		motion_detection: true,
		movies: false,
		web_hook_notifications_enabled: true,
		web_hook_notifications_http_method: 'GET',
	},
	sharp: {
		motion_detection: true,
		movies: true,
		recording_mode: 'motion-triggered',
		movie_format: 'mp4',
		web_hook_notifications_enabled: true,
		web_hook_notifications_http_method: 'GET',
	},
};

/** @type {Record<string, string>} */
const MODE_LABELS = {
	off: 'Off',
	still: 'Still',
	sharp: 'Sharp',
};

/** Snapshot media defaults applied on adapter start when enabled. */
const MEDIA_SETTINGS = {
	still_images: true,
	capture_mode: 'manual',
	manual_snapshots: true,
};

/**
 * @param {unknown} value
 * @returns {'off'|'still'|'sharp'|null}
 */
function normalizeMode(value) {
	const key = String(value == null ? '' : value)
		.trim()
		.toLowerCase();
	return /** @type {'off'|'still'|'sharp'|null} */ (MODE_ALIASES[key] || null);
}

/**
 * @param {Record<string, unknown>} uiConfig MotionEye camera config
 * @returns {'off'|'still'|'sharp'}
 */
function inferModeFromConfig(uiConfig) {
	if (!uiConfig.motion_detection) {
		return 'off';
	}
	if (uiConfig.movies) {
		return 'sharp';
	}
	return 'still';
}

/**
 * @param {'off'|'still'|'sharp'} mode
 * @param {string} [webhookUrl]
 * @returns {Record<string, unknown>}
 */
function buildModePatch(mode, webhookUrl) {
	const patch = { ...MODE_PROFILES[mode] };
	if ((mode === 'still' || mode === 'sharp') && webhookUrl) {
		patch.web_hook_notifications_url = webhookUrl;
	}
	return patch;
}

module.exports = {
	MODE_ALIASES,
	MODE_PROFILES,
	MODE_LABELS,
	MEDIA_SETTINGS,
	normalizeMode,
	inferModeFromConfig,
	buildModePatch,
};
