'use strict';

const { MOTIONEYE_MEDIA_BASE, sanitizeMediaFolderName } = require('./mediaStorage');

/**
 * Extract custom media folder name from a MotionEye camera config entry.
 * @param {Record<string, unknown>} camera
 * @returns {string}
 */
function extractMediaFolderFromMotionEyeConfig(camera) {
	const rootDir = String(camera?.root_directory || '').trim();
	if (!rootDir) {
		return '';
	}

	const prefix = `${MOTIONEYE_MEDIA_BASE}/`;
	if (!rootDir.startsWith(prefix)) {
		return '';
	}

	const folder = rootDir.slice(prefix.length);
	if (!folder || /^Camera\d+$/i.test(folder)) {
		return '';
	}

	return sanitizeMediaFolderName(folder);
}

/**
 * @param {unknown} entry
 * @returns {import('./cameraRegistry').NativeCameraConfig|null}
 */
function mapMotionEyeCamera(entry, defaultMode) {
	if (!entry || typeof entry !== 'object') {
		return null;
	}

	const motionEyeId = Number(entry.id);
	if (!motionEyeId || Number.isNaN(motionEyeId)) {
		return null;
	}

	const name = String(entry.name || `Camera ${motionEyeId}`).trim();
	if (!name) {
		return null;
	}

	return {
		name,
		motionEyeId,
		id: '',
		mediaFolder: extractMediaFolderFromMotionEyeConfig(entry),
		defaultMode: defaultMode || 'off',
		enabled: true,
	};
}

/**
 * Add MotionEye cameras that are not yet in the admin table.
 *
 * @param {import('./cameraRegistry').NativeCameraConfig[]} existingCameras
 * @param {Record<string, unknown>[]} motionEyeList
 * @param {string} [defaultMode]
 * @returns {{ cameras: import('./cameraRegistry').NativeCameraConfig[], added: number, total: number }}
 */
function mergeMotionEyeCameras(existingCameras, motionEyeList, defaultMode = 'off') {
	const cameras = Array.isArray(existingCameras)
		? existingCameras.map(entry => ({ ...entry }))
		: [];

	const knownIds = new Set(
		cameras
			.map(entry => Number(entry?.motionEyeId))
			.filter(id => !Number.isNaN(id) && id > 0),
	);

	let added = 0;
	const list = Array.isArray(motionEyeList) ? motionEyeList : [];

	for (const entry of list) {
		const mapped = mapMotionEyeCamera(entry, defaultMode);
		if (!mapped || knownIds.has(mapped.motionEyeId)) {
			continue;
		}

		cameras.push(mapped);
		knownIds.add(mapped.motionEyeId);
		added += 1;
	}

	return { cameras, added, total: list.length };
}

module.exports = {
	extractMediaFolderFromMotionEyeConfig,
	mapMotionEyeCamera,
	mergeMotionEyeCameras,
};
