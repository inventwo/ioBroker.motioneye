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

module.exports = {
	describePassword,
	apiPathLabel,
	isVerboseLogging,
	createVerboseLogger,
};
