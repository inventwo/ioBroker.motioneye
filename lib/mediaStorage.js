'use strict';

/** Default MotionEye media base path (see motioneye.conf media_path). */
const MOTIONEYE_MEDIA_BASE = '/var/lib/motioneye';

/**
 * Sanitize a single folder name segment (no path separators).
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeMediaFolderName(value) {
	const trimmed = String(value == null ? '' : value).trim();
	if (!trimmed) {
		return '';
	}

	if (/[/\\]/.test(trimmed) || trimmed.includes('..')) {
		return '';
	}

	return trimmed
		.replace(/[^\wäöüÄÖÜß .-]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * @param {unknown} folderName
 * @returns {string} Full root_directory path or empty when invalid/unset
 */
function buildMediaRootDirectory(folderName) {
	const folder = sanitizeMediaFolderName(folderName);
	if (!folder) {
		return '';
	}

	return `${MOTIONEYE_MEDIA_BASE}/${folder}`;
}

/**
 * MotionEye config patch for custom file storage path.
 * @param {unknown} folderName
 * @returns {Record<string, unknown>}
 */
function buildStoragePatch(folderName) {
	const rootDirectory = buildMediaRootDirectory(folderName);
	if (!rootDirectory) {
		return {};
	}

	return {
		storage_device: 'custom-path',
		root_directory: rootDirectory,
	};
}

module.exports = {
	MOTIONEYE_MEDIA_BASE,
	sanitizeMediaFolderName,
	buildMediaRootDirectory,
	buildStoragePatch,
};
