'use strict';

/** Node.js maximum delay for setTimeout/setInterval (32-bit signed int). */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Clamp a millisecond value for use with setTimeout/setInterval.
 *
 * @param {unknown} value
 * @param {{ min?: number, default?: number }} [options]
 * @returns {number}
 */
function capTimerMs(value, options = {}) {
	const { min = 0, default: defaultValue = min } = options;
	const n = Number(value);
	const base = Number.isFinite(n) ? n : defaultValue;
	return Math.min(MAX_TIMER_MS, Math.max(min, base));
}

module.exports = {
	MAX_TIMER_MS,
	capTimerMs,
};
