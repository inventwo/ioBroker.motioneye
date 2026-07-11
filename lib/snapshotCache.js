'use strict';

const SNAPSHOT_FILENAME = 'lastsnap.jpg';
const SNAPSHOTS_DIR = 'snapshots';

const SNAPSHOT_HTML_STYLE = 'width:100%; height:100%; object-fit:contain; display:block;';

/**
 * @param {string} channel
 * @returns {string} Relative path under adapter file storage (no leading slash)
 */
function buildSnapshotStoragePath(channel) {
	return `${SNAPSHOTS_DIR}/${channel}/${SNAPSHOT_FILENAME}`;
}

/**
 * @param {string} namespace
 * @param {string} channel
 * @returns {string} Web path served by ioBroker web adapter, e.g. /motioneye.0/snapshots/garten/lastsnap.jpg
 */
function buildSnapshotWebPath(namespace, channel) {
	return `/${namespace}/${buildSnapshotStoragePath(channel)}`;
}

/**
 * @param {string} urlLocal
 * @param {number} [cacheBust]
 * @returns {string}
 */
function buildSnapshotHtml(urlLocal, cacheBust) {
	const bust = cacheBust ? `?t=${cacheBust}` : '';
	const src = `${urlLocal}${bust}`;
	return (
		`<div style="width:100%;height:100%;overflow:hidden;background:#000;">` +
		`<img src="${src}" style="${SNAPSHOT_HTML_STYLE}" alt="" />` +
		`</div>`
	);
}

/**
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isJpegBuffer(buffer) {
	return (
		Buffer.isBuffer(buffer) && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
	);
}

/**
 * @param {import('./cameraRegistry').ResolvedCamera} camera
 * @param {{ snapshotCacheEnabled?: boolean }} config
 * @returns {boolean}
 */
function isSnapshotCacheEnabledForCamera(camera, config) {
	if (config.snapshotCacheEnabled === false) {
		return false;
	}
	return camera.snapshotCacheEnabled !== false;
}

/**
 * @param {import('./cameraRegistry').ResolvedCamera} camera
 * @param {{ snapshotCacheEnabled?: boolean, snapshotCacheOnMotion?: boolean }} config
 * @returns {boolean}
 */
function shouldRefreshSnapshotOnMotion(camera, config) {
	if (!isSnapshotCacheEnabledForCamera(camera, config)) {
		return false;
	}
	return config.snapshotCacheOnMotion === true;
}

/**
 * @param {number} value
 * @param {{ min?: number, max?: number, default?: number }} [limits]
 * @returns {number}
 */
function capSnapshotDelayMs(value, limits = {}) {
	const min = limits.min ?? 0;
	const max = limits.max ?? 10000;
	const fallback = limits.default ?? 800;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

module.exports = {
	SNAPSHOT_FILENAME,
	SNAPSHOTS_DIR,
	SNAPSHOT_HTML_STYLE,
	buildSnapshotStoragePath,
	buildSnapshotWebPath,
	buildSnapshotHtml,
	isJpegBuffer,
	isSnapshotCacheEnabledForCamera,
	shouldRefreshSnapshotOnMotion,
	capSnapshotDelayMs,
};
