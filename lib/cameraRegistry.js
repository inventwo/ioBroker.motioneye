'use strict';

/**
 * Sanitize a user-chosen camera name for ioBroker channel IDs.
 * @param {string} name
 * @returns {string}
 */
function safeChannelName(name) {
	return String(name)
		.trim()
		.replace(/\s+/g, '_')
		.replace(/[^a-zA-Z0-9_äöüÄÖÜß-]/g, '_');
}

/**
 * @param {string} value
 * @returns {string}
 */
function slugifyId(value) {
	return safeChannelName(value)
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '');
}

/**
 * @typedef {object} NativeCameraConfig
 * @property {string} [id]
 * @property {string} name
 * @property {number} motionEyeId
 * @property {boolean} [enabled]
 * @property {string} [defaultMode]
 */

/**
 * @typedef {object} ResolvedCamera
 * @property {string} id Internal webhook key
 * @property {string} name Display name
 * @property {string} channel Channel ID under adapter namespace
 * @property {number} motionEyeId
 * @property {boolean} enabled
 * @property {string} defaultMode
 */

/**
 * @param {NativeCameraConfig[]} cameras
 * @param {string} fallbackDefaultMode
 * @returns {ResolvedCamera[]}
 */
function resolveCameras(cameras, fallbackDefaultMode = 'off') {
	if (!Array.isArray(cameras)) {
		return [];
	}

	/** @type {ResolvedCamera[]} */
	const resolved = [];
	const usedIds = new Set();
	const usedChannels = new Set();

	for (const entry of cameras) {
		if (!entry || !entry.name || entry.motionEyeId == null) {
			continue;
		}

		const name = String(entry.name).trim();
		const channel = safeChannelName(name);
		if (!channel) {
			continue;
		}

		let id = entry.id ? slugifyId(entry.id) : slugifyId(name);
		if (!id) {
			id = `cam_${entry.motionEyeId}`;
		}

		let uniqueId = id;
		let suffix = 2;
		while (usedIds.has(uniqueId)) {
			uniqueId = `${id}_${suffix}`;
			suffix += 1;
		}

		let uniqueChannel = channel;
		suffix = 2;
		while (usedChannels.has(uniqueChannel)) {
			uniqueChannel = `${channel}_${suffix}`;
			suffix += 1;
		}

		usedIds.add(uniqueId);
		usedChannels.add(uniqueChannel);

		resolved.push({
			id: uniqueId,
			name,
			channel: uniqueChannel,
			motionEyeId: Number(entry.motionEyeId),
			enabled: entry.enabled !== false,
			defaultMode: entry.defaultMode || fallbackDefaultMode,
		});
	}

	return resolved;
}

/**
 * @param {string} namespace Adapter namespace (e.g. motioneye.0)
 * @param {string} webhookHost ioBroker host reachable from MotionEye
 * @param {number} webhookPort
 * @param {string} cameraId Internal camera key
 * @returns {string}
 */
function buildWebhookUrl(namespace, webhookHost, webhookPort, cameraId) {
	const host = String(webhookHost).trim();
	const port = Number(webhookPort);
	return `http://${host}:${port}/${namespace}/webhook/${encodeURIComponent(cameraId)}?value=true`;
}

/**
 * @param {string} path Request path including query string
 * @param {string} namespace Adapter namespace (e.g. motioneye.0)
 * @returns {{ cameraId: string, value: boolean } | null}
 */
function parseWebhookRequest(path, namespace) {
	const pathOnly = path.split('?')[0];
	const prefix = `/${namespace}/webhook/`;
	if (!pathOnly.startsWith(prefix)) {
		return null;
	}

	const cameraId = decodeURIComponent(pathOnly.slice(prefix.length).replace(/\/+$/, ''));
	if (!cameraId) {
		return null;
	}

	const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
	let value = true;
	for (const part of query.split('&')) {
		if (!part) {
			continue;
		}
		const eq = part.indexOf('=');
		const key = eq >= 0 ? decodeURIComponent(part.slice(0, eq)) : decodeURIComponent(part);
		if (key === 'value') {
			const raw = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : '';
			value = !['0', 'false', 'off', 'no'].includes(String(raw).trim().toLowerCase());
		}
	}

	return { cameraId, value };
}

module.exports = {
	safeChannelName,
	slugifyId,
	resolveCameras,
	buildWebhookUrl,
	parseWebhookRequest,
};
