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
		.replace(/[^a-zA-Z0-9_äöüÄÖÜß-]/g, '_')
		.toLowerCase();
}

/**
 * Pre-0.2.2 channel IDs (mixed case) — used for one-time migration on adapter start.
 * @param {string} name
 * @returns {string}
 */
function legacySafeChannelName(name) {
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
 * @property {string} [mediaFolder] Folder name under /var/lib/motioneye
 * @property {string} [overlayEnabled] Tri-state string ('', 'true', 'false') from the Overlay config table
 * @property {string} [leftText] TEXT_POSITION_OPTIONS value, or '' to leave unchanged
 * @property {string} [rightText] TEXT_POSITION_OPTIONS value, or '' to leave unchanged
 * @property {string} [customLeftText] Custom left overlay text, or '' to leave unchanged
 * @property {string} [customRightText] Custom right overlay text, or '' to leave unchanged
 * @property {number} [textScale] 1-10, or 0 to leave unchanged
 * @property {boolean} [storageAutoRefreshExcluded] Opt-out checkbox (Storage config tab) — true excludes this camera
 *   from the storage auto-refresh interval. Deliberately opt-out (default false/unchecked), not opt-in: an opt-in
 *   flag defaulting to true would need to be "true" for every pre-existing camera row that predates this column,
 *   which admin table components tend to (re-)write back into the config on render — observed as checkboxes
 *   getting checked on their own while switching tabs. false/absent behaves identically, so there is nothing to
 *   backfill.
 */

/**
 * @typedef {object} OverlayConfig
 * @property {string} enabled '', 'true' or 'false'
 * @property {string} leftText TEXT_POSITION_OPTIONS value, or '' to leave unchanged
 * @property {string} rightText TEXT_POSITION_OPTIONS value, or '' to leave unchanged
 * @property {string} customLeftText Custom left overlay text, or '' to leave unchanged
 * @property {string} customRightText Custom right overlay text, or '' to leave unchanged
 * @property {number} textScale 1-10, or 0 to leave unchanged
 */

/**
 * @typedef {object} ResolvedCamera
 * @property {string} id Internal webhook key
 * @property {string} name Display name
 * @property {string} channel Channel ID under adapter namespace
 * @property {number} motionEyeId
 * @property {boolean} enabled
 * @property {string} defaultMode
 * @property {string} mediaFolder Sanitized folder name or empty
 * @property {OverlayConfig} overlayConfig Raw values from the Overlay config table (sentinels = leave unchanged)
 * @property {boolean} storageAutoRefresh Whether this camera is included in the global storage auto-refresh interval (opposite of storageAutoRefreshExcluded)
 */

/**
 * Read a raw Overlay config table row into sentinel-safe values.
 * Empty/'' means "leave unchanged" — the field was not filled in the table.
 *
 * @param {NativeCameraConfig} entry
 * @returns {OverlayConfig}
 */
function resolveOverlayConfig(entry) {
	const textScale = Math.round(Number(entry.textScale));
	return {
		enabled: entry.overlayEnabled === 'true' || entry.overlayEnabled === 'false' ? entry.overlayEnabled : '',
		leftText: String(entry.leftText || '').trim(),
		rightText: String(entry.rightText || '').trim(),
		customLeftText: String(entry.customLeftText || ''),
		customRightText: String(entry.customRightText || ''),
		textScale: Number.isFinite(textScale) && textScale > 0 ? textScale : 0,
	};
}

/**
 * @param {NativeCameraConfig[]} cameras
 * @param {string} [fallbackDefaultMode]
 * @param {(name: string) => string} [channelNameFn]
 * @returns {ResolvedCamera[]}
 */
function resolveCameras(cameras, fallbackDefaultMode = 'off', channelNameFn = safeChannelName) {
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
		const channel = channelNameFn(name);
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
			mediaFolder: String(entry.mediaFolder || '').trim(),
			overlayConfig: resolveOverlayConfig(entry),
			storageAutoRefresh: entry.storageAutoRefreshExcluded !== true,
		});
	}

	return resolved;
}

/**
 * @param {NativeCameraConfig[]} cameras
 * @param {string} [fallbackDefaultMode]
 * @returns {ResolvedCamera[]}
 */
function resolveLegacyCameras(cameras, fallbackDefaultMode = 'off') {
	return resolveCameras(cameras, fallbackDefaultMode, legacySafeChannelName);
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
	legacySafeChannelName,
	slugifyId,
	resolveOverlayConfig,
	resolveCameras,
	resolveLegacyCameras,
	buildWebhookUrl,
	parseWebhookRequest,
};
