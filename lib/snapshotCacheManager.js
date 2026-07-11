'use strict';

const {
	buildSnapshotStoragePath,
	buildSnapshotWebPath,
	buildSnapshotAbsoluteFilePath,
	buildSnapshotHtml,
	isSnapshotCacheEnabledForCamera,
	shouldRefreshSnapshotOnMotion,
	capSnapshotDelayMs,
} = require('./snapshotCache');

/**
 * @typedef {object} SnapshotCacheManagerDeps
 * @property {string} namespace
 * @property {() => Record<string, unknown>} getConfig
 * @property {() => import('./motionEyeApi').MotionEyeApiClient} getMotionEyeApi
 * @property {(relativePath: string, data: Buffer) => Promise<void>} writeFile
 * @property {(id: string, val: ioBroker.StateValue, ack?: boolean) => Promise<void>} setState
 * @property {(id: string) => Promise<ioBroker.State | null | undefined>} getState
 * @property {() => Promise<string>} resolveLocalHost
 * @property {() => Promise<{ port: number, secure: boolean }>} resolveWebAdapter
 * @property {() => string} getDataDir
 * @property {(message: string) => void} verboseLog
 * @property {(level: 'info' | 'warn' | 'error' | 'debug', message: string) => void} log
 * @property {(ms: number) => Promise<void>} delayFn
 * @property {() => boolean} isUnloading
 * @property {(camera: import('./cameraRegistry').ResolvedCamera, meta: { trigger: 'snapshot' | 'motion' | 'manual', filePath: string, lastUpdate: string }) => void} [onSnapshotCached]
 */

/**
 * @param {SnapshotCacheManagerDeps} deps
 */
function createSnapshotCacheManager(deps) {
	/** @type {{ port: number, secure: boolean }} */
	let webAdapter = { port: 8082, secure: false };
	/** @type {string} */
	let localHost = '';
	/** @type {Map<string, Promise<void>>} */
	const refreshQueues = new Map();
	/** @type {Map<string, number>} */
	const lastMotionRefreshAt = new Map();

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {string}
	 */
	function snapshotsId(camera) {
		return `${camera.channel}.snapshots`;
	}

	/**
	 * @returns {Promise<void>}
	 */
	async function init() {
		webAdapter = await deps.resolveWebAdapter();
		localHost = await deps.resolveLocalHost();
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {boolean}
	 */
	function isEnabledForCamera(camera) {
		return isSnapshotCacheEnabledForCamera(camera, deps.getConfig());
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {boolean}
	 */
	function shouldRefreshOnMotion(camera) {
		return shouldRefreshSnapshotOnMotion(camera, deps.getConfig());
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {string}
	 */
	function buildUrlLocal(camera) {
		const protocol = webAdapter.secure ? 'https' : 'http';
		const host = localHost || '127.0.0.1';
		return `${protocol}://${host}:${webAdapter.port}${buildSnapshotWebPath(deps.namespace, camera.channel)}`;
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {'snapshot' | 'motion' | 'manual' | 'notification'} trigger
	 * @param {{ force?: boolean }} [options]
	 * @returns {Promise<void>}
	 */
	async function refreshSnapshotNow(camera, trigger, options = {}) {
		if (deps.isUnloading() || (!options.force && !isEnabledForCamera(camera))) {
			return;
		}

		const api = deps.getMotionEyeApi();
		const delayMs = capSnapshotDelayMs(deps.getConfig().snapshotCacheDelayMs, {
			min: 0,
			max: 5000,
			default: 800,
		});

		if (trigger === 'snapshot' && delayMs > 0) {
			await deps.delayFn(delayMs);
		}

		if (deps.isUnloading()) {
			return;
		}

		const image = await api.downloadPicture(camera.motionEyeId);
		const storagePath = buildSnapshotStoragePath(camera.channel);
		await deps.writeFile(storagePath, image);

		const now = Date.now();
		const url = buildSnapshotWebPath(deps.namespace, camera.channel);
		const urlLocal = buildUrlLocal(camera);
		const filePath = buildSnapshotAbsoluteFilePath(deps.getDataDir(), deps.namespace, camera.channel);
		const sizeKb = Math.max(1, Math.round(image.length / 1024));
		const prefix = snapshotsId(camera);
		const lastUpdate = new Date(now).toISOString();

		await deps.setState(`${prefix}.url`, url, true);
		await deps.setState(`${prefix}.urlLocal`, urlLocal, true);
		await deps.setState(`${prefix}.filePath`, filePath, true);
		await deps.setState(`${prefix}.html`, buildSnapshotHtml(urlLocal, now), true);
		await deps.setState(`${prefix}.lastUpdate`, lastUpdate, true);
		await deps.setState(`${prefix}.sizeKb`, sizeKb, true);

		deps.verboseLog(`Snapshot cache updated for "${camera.name}" (${trigger}, ${sizeKb} KB) → ${storagePath}`);

		if (trigger !== 'notification' && typeof deps.onSnapshotCached === 'function') {
			deps.onSnapshotCached(camera, { trigger, filePath, lastUpdate });
		}
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {'snapshot' | 'motion' | 'manual' | 'notification'} trigger
	 * @param {{ force?: boolean }} [options]
	 * @returns {Promise<void>}
	 */
	function queueRefresh(camera, trigger, options = {}) {
		const key = camera.channel;
		const run = async () => {
			try {
				await refreshSnapshotNow(camera, trigger, options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.log('warn', `Snapshot cache failed for ${camera.name} (${trigger}): ${message}`);
			}
		};

		const previous = refreshQueues.get(key) || Promise.resolve();
		const next = previous.then(run, run);
		refreshQueues.set(key, next);
		return next;
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {{ force?: boolean }} [options]
	 * @returns {Promise<void>}
	 */
	function scheduleAfterSnapshot(camera, options = {}) {
		return queueRefresh(camera, 'snapshot', options);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {Promise<void>|undefined}
	 */
	function maybeRefreshOnMotion(camera) {
		if (!shouldRefreshOnMotion(camera)) {
			return;
		}

		const minIntervalSec = Math.max(
			5,
			Math.round(Number(deps.getConfig().snapshotCacheMotionMinIntervalSec) || 30),
		);
		const now = Date.now();
		const last = lastMotionRefreshAt.get(camera.channel) || 0;
		if (now - last < minIntervalSec * 1000) {
			return;
		}

		lastMotionRefreshAt.set(camera.channel, now);
		return queueRefresh(camera, 'motion');
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {{ force?: boolean }} [options]
	 * @returns {Promise<void>}
	 */
	function refreshManual(camera, options = {}) {
		return queueRefresh(camera, 'manual', options);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {Promise<void>}
	 */
	function refreshForNotification(camera) {
		return queueRefresh(camera, 'notification', { force: true });
	}

	return {
		init,
		isEnabledForCamera,
		shouldRefreshOnMotion,
		scheduleAfterSnapshot,
		maybeRefreshOnMotion,
		refreshManual,
		refreshForNotification,
		buildUrlLocal,
	};
}

module.exports = {
	createSnapshotCacheManager,
};
