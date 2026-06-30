'use strict';

/**
 * @param {unknown} password
 * @returns {string} Safe summary for logs (never includes the password).
 */
function describePassword(password) {
	const value = String(password ?? '');
	if (!value) {
		return 'not set';
	}
	return `set (${value.length} chars)`;
}

/**
 * @param {string} path Request path possibly including query string.
 * @returns {string} Pathname only (no credentials in query).
 */
function apiPathLabel(path) {
	const qIndex = path.indexOf('?');
	return qIndex >= 0 ? path.slice(0, qIndex) : path;
}

/**
 * @param {unknown} config Adapter native config.
 * @returns {boolean}
 */
function isVerboseLogging(config) {
	return config?.debugging_verbose === true;
}

/**
 * @param {unknown} config Adapter native config.
 * @param {(level: 'info' | 'debug', message: string) => void} logFn
 * @returns {(message: string) => void}
 */
function createVerboseLogger(config, logFn) {
	return message => {
		if (!isVerboseLogging(config)) {
			return;
		}
		logFn('info', `[verbose] ${message}`);
	};
}

/**
 * Verbose troubleshooting lines for MotionEye API unauthorized (no secrets).
 *
 * @param {unknown} config Adapter native config.
 * @returns {string[]}
 */
function getUnauthorizedVerboseHints(config) {
	const host = String(config?.motionHost || '').trim();
	const port = Number(config?.motionEyePort) || 8765;
	const user = String(config?.motionEyeUser || 'admin').trim() || 'admin';
	const passwordSummary = describePassword(config?.motionEyePassword);
	const lines = [
		`API login rejected (password ${passwordSummary}). MotionEye is reachable — this is not a network issue.`,
	];

	if (passwordSummary === 'not set') {
		lines.push('No password stored in adapter — enter the MotionEye admin password, save, and restart.');
	} else {
		lines.push('Clear the password field completely, save, re-type the password manually, save again.');
	}

	if (host) {
		lines.push(`Confirm web login with the same credentials: http://${host}:${port}/ (user "${user}")`);
	} else {
		lines.push(`Confirm web login with the same credentials on MotionEye port ${port} (user "${user}")`);
	}

	lines.push(
		'If web login works but the adapter still fails, set a temporary simple password (letters/numbers only) in MotionEye and repeat clear/save/re-type.',
	);

	return lines;
}

module.exports = {
	describePassword,
	apiPathLabel,
	isVerboseLogging,
	createVerboseLogger,
	getUnauthorizedVerboseHints,
};
