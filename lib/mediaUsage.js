'use strict';

/**
 * MotionEye's `pretty_size()` (motioneye/utils/__init__.py) formats bytes as
 * `"<value with 1 decimal> <unit>"` using 1024-based units — 'B', 'kB', 'MB', 'GB'.
 * There is no raw byte count in the `/picture/<id>/list/` / `/movie/<id>/list/`
 * response, only this pre-rounded string, so totals are an approximation (rounding
 * error per file is at most ~0.05 of a unit).
 */
const SIZE_UNIT_BYTES = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

/**
 * @param {unknown} sizeStr e.g. "1.2 MB", "512.0 B"
 * @returns {number} Bytes, or 0 when unparseable.
 */
function parseSizeStrToBytes(sizeStr) {
	const match = String(sizeStr ?? '')
		.trim()
		.match(/^([\d.]+)\s*(B|KB|MB|GB)$/i);
	if (!match) {
		return 0;
	}

	const value = parseFloat(match[1]);
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.round(value * SIZE_UNIT_BYTES[match[2].toUpperCase()]);
}

/**
 * @param {unknown} mediaList Response entries from MotionEye's media list endpoint (each with a `sizeStr`).
 * @returns {{ count: number, totalBytes: number }}
 */
function summarizeMediaList(mediaList) {
	const entries = Array.isArray(mediaList) ? mediaList : [];
	let totalBytes = 0;
	for (const entry of entries) {
		totalBytes += parseSizeStrToBytes(entry && typeof entry === 'object' ? entry.sizeStr : null);
	}
	return { count: entries.length, totalBytes };
}

/**
 * @param {number} bytes
 * @returns {number} MB rounded to 1 decimal.
 */
function bytesToMb(bytes) {
	return Math.round((Number(bytes) / (1024 * 1024)) * 10) / 10;
}

module.exports = {
	SIZE_UNIT_BYTES,
	parseSizeStrToBytes,
	summarizeMediaList,
	bytesToMb,
};
