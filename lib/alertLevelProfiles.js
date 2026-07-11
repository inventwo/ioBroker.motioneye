'use strict';

/** @typedef {'off'|'motion'|'notify'|'record'|'full'} AlertLevel */

/** @type {Record<string, AlertLevel>} */
const ALERT_LEVEL_ALIASES = {
	off: 'off',
	aus: 'off',
	0: 'off',
	motion: 'motion',
	bewegung: 'motion',
	1: 'motion',
	monitor: 'motion',
	notify: 'notify',
	notification: 'notify',
	alarm: 'notify',
	2: 'notify',
	record: 'record',
	aufnahme: 'record',
	video: 'record',
	3: 'record',
	full: 'full',
	voll: 'full',
	vollschutz: 'full',
	4: 'full',
};

/** @type {Record<AlertLevel, { mode: 'off'|'still'|'sharp', telegramOnMotion: boolean }>} */
const ALERT_LEVEL_PROFILES = {
	off: { mode: 'off', telegramOnMotion: false },
	motion: { mode: 'still', telegramOnMotion: false },
	notify: { mode: 'still', telegramOnMotion: true },
	record: { mode: 'sharp', telegramOnMotion: false },
	full: { mode: 'sharp', telegramOnMotion: true },
};

/** @type {Record<AlertLevel, string>} */
const ALERT_LEVEL_LABELS = {
	off: 'Off',
	motion: 'Motion only',
	notify: 'Motion + Telegram',
	record: 'Motion + Video',
	full: 'Full protection',
};

/** @type {Record<string, string>} */
const ALERT_LEVEL_STATES = {
	off: ALERT_LEVEL_LABELS.off,
	motion: ALERT_LEVEL_LABELS.motion,
	notify: ALERT_LEVEL_LABELS.notify,
	record: ALERT_LEVEL_LABELS.record,
	full: ALERT_LEVEL_LABELS.full,
};

/**
 * @param {unknown} value
 * @returns {AlertLevel|null}
 */
function normalizeAlertLevel(value) {
	const key = String(value == null ? '' : value)
		.trim()
		.toLowerCase();
	return /** @type {AlertLevel|null} */ (ALERT_LEVEL_ALIASES[key] || null);
}

/**
 * @param {AlertLevel} level
 * @returns {{ mode: 'off'|'still'|'sharp', telegramOnMotion: boolean }}
 */
function getAlertLevelProfile(level) {
	return ALERT_LEVEL_PROFILES[level];
}

/**
 * Derive the closest alert level from MotionEye mode and config Telegram-on-motion flag.
 *
 * @param {'off'|'still'|'sharp'} mode
 * @param {boolean} configTelegramOnMotion
 * @returns {AlertLevel}
 */
function inferAlertLevel(mode, configTelegramOnMotion) {
	if (mode === 'off') {
		return 'off';
	}
	if (mode === 'still') {
		return configTelegramOnMotion ? 'notify' : 'motion';
	}
	return configTelegramOnMotion ? 'full' : 'record';
}

module.exports = {
	ALERT_LEVEL_ALIASES,
	ALERT_LEVEL_PROFILES,
	ALERT_LEVEL_LABELS,
	ALERT_LEVEL_STATES,
	normalizeAlertLevel,
	getAlertLevelProfile,
	inferAlertLevel,
};
