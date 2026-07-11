'use strict';

/**
 * @param {number} bytes
 * @returns {number} GB rounded to 1 decimal (MotionEye UI style).
 */
function bytesToGb(bytes) {
	return Math.round((Number(bytes) / 1024 ** 3) * 10) / 10;
}

/**
 * Filesystem usage for the partition containing the camera's `target_dir`
 * (MotionEye `config/list` fields `disk_used` / `disk_total`, from statvfs).
 *
 * @param {Record<string, unknown> | null | undefined} uiConfig
 * @returns {{ usedGb: number, totalGb: number, usedPercent: number } | null}
 */
function parseCameraDiskUsage(uiConfig) {
	const used = Number(uiConfig?.disk_used);
	const total = Number(uiConfig?.disk_total);
	if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || used < 0) {
		return null;
	}

	const usedGb = bytesToGb(used);
	const totalGb = bytesToGb(total);
	const usedPercent = Math.round((used / total) * 100);

	return { usedGb, totalGb, usedPercent };
}

module.exports = {
	bytesToGb,
	parseCameraDiskUsage,
};
