'use strict';

/*
 * Created with @iobroker/create-adapter (inventwo scaffold)
 */

const utils = require('@iobroker/adapter-core');
const { createMotionEyeApi } = require('./lib/motionEyeApi');
const { createMotionApi } = require('./lib/motionApi');
const { buildStoragePatch } = require('./lib/mediaStorage');
const { INFO_STATE_LABELS } = require('./lib/infoLabels');
const { mergeMotionEyeCameras } = require('./lib/cameraDiscovery');
const { resolveCameras, buildWebhookUrl } = require('./lib/cameraRegistry');
const {
	normalizeMode,
	inferModeFromConfig,
	buildModePatch,
	MODE_LABELS,
	MEDIA_SETTINGS,
} = require('./lib/modeProfiles');
const { createWebhookServer } = require('./lib/webhookServer');
const { createStreamManager } = require('./lib/streamManager');

/** Info states under `0_info` — digits sort before letters (underscore does not). */
const INFO_PREFIX = '0_info';
const LEGACY_INFO_PREFIXES = ['info', '_info'];
const LEGACY_INFO_STATES = ['connection', 'camerasOnline', 'lastSync', 'motionEyeVersion', 'motionVersion'];

class Motioneye extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	constructor(options) {
		super({
			...options,
			name: 'motioneye',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.motionEyeApi = undefined;
		this.motionApi = undefined;
		this.streamManager = undefined;
		this.webhookServer = undefined;
		this.pollInterval = undefined;
		this.motionResetTimers = {};
		/** @type {Map<string, import('./lib/cameraRegistry').ResolvedCamera>} */
		this.camerasById = new Map();
		/** @type {Map<string, import('./lib/cameraRegistry').ResolvedCamera>} */
		this.camerasByChannel = new Map();
		this.webhookHost = '';
		this._unloading = false;
		this._serverVersionsFetched = false;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		this.log.info('MotionEye adapter starting...');

		await this.ensureAdapterRootMeta();

		if (!this.config.motionHost) {
			this.log.error('No MotionEye host configured. Please set the host in instance settings.');
			return;
		}

		this.motionEyeApi = createMotionEyeApi({
			host: this.config.motionHost,
			motionEyePort: this.config.motionEyePort,
			username: this.config.motionEyeUser,
			password: this.config.motionEyePassword,
			requestTimeoutMs: this.config.requestTimeoutMs,
		});

		this.motionApi = createMotionApi({
			host: this.config.motionHost,
			motionPort: this.config.motionPort,
			requestTimeoutMs: this.config.requestTimeoutMs,
		});

		this.streamManager = createStreamManager({
			motionHost: this.config.motionHost,
			motionEyeApi: this.motionEyeApi,
			useMotionEyeConfig: this.config.useMotionEyeConfig !== false,
			disableStreamOnStart: this.config.disableStreamOnStart !== false,
			streamAutoOffMs: Number(this.config.streamAutoOffMs) || 0,
			streamStartDelayMs: Number(this.config.streamStartDelayMs) || 3000,
			streamReadyTimeoutMs: Number(this.config.streamReadyTimeoutMs) || 45000,
			streamRetryMs: Number(this.config.streamRetryMs) || 2000,
			streamSiblingRelinkTimeoutMs: Number(this.config.streamSiblingRelinkTimeoutMs) || 60000,
			getState: id => this.getStateAsync(id),
			setState: (id, val, ack) => this.setStateAsync(id, val, ack),
			log: (level, message) => this.log[level](message),
			setTimeoutFn: (fn, ms) => this.setTimeout(fn, ms),
			clearTimeoutFn: id => {
				// @ts-expect-error adapter-core branded Timeout id from setTimeout
				this.clearTimeout(id);
			},
			getCamerasByChannel: () => this.camerasByChannel,
			isUnloading: () => this._unloading,
		});

		this.webhookHost = await this.resolveWebhookHost();
		if (!this.webhookHost) {
			this.log.warn(
				'webhookHost is not configured and could not be detected — set it in instance settings so MotionEye can reach webhooks',
			);
		}

		await this.ensureInfoStates();
		await this.syncCameraRegistry();

		try {
			await this.startWebhookServer();
		} catch (error) {
			this.log.error(`Webhook server failed to start: ${error.message}`);
		}

		await this.initializeCameras();

		this.subscribeStates('*.mode');
		this.subscribeStates('*.motion');
		this.subscribeStates('*.snapshot');
		this.subscribeStates('*.stream');
		this.subscribeStates('*.streamPulse');

		const pollSec = Math.max(30, Number(this.config.statusPollIntervalSec) || 300);
		this.pollInterval = this.setInterval(() => {
			this.pollMotionEye().catch(error => {
				this.log.warn(`Status poll failed: ${error.message}`);
			});
		}, pollSec * 1000);

		this.log.info('MotionEye adapter ready');
	}

	/**
	 * Ensure adapter root (e.g. motioneye) is typed as meta.
	 * instanceObjects handles motioneye.0; objects with _id "" fails on adapter update (Invalid ID).
	 */
	async ensureAdapterRootMeta() {
		const rootId = this.name;
		const titleLang = this.ioPack?.common?.titleLang;
		const name =
			typeof titleLang === 'object' && titleLang !== null && !Array.isArray(titleLang)
				? (titleLang[this.language] ?? titleLang.en ?? rootId)
				: typeof titleLang === 'string'
					? titleLang
					: rootId;

		const existing = await this.getForeignObjectAsync(rootId);
		if (!existing) {
			await this.setForeignObjectAsync(rootId, {
				type: 'meta',
				common: {
					name,
					type: 'meta.folder',
				},
				native: {},
			});
		} else if (existing.type !== 'meta') {
			await this.extendForeignObjectAsync(rootId, {
				type: 'meta',
				common: {
					name,
					type: 'meta.folder',
				},
			});
		}
	}

	/**
	 * @returns {Promise<string>}
	 */
	async resolveWebhookHost() {
		const configured = String(this.config.webhookHost || '').trim();
		if (configured) {
			return configured;
		}

		try {
			const hosts = await this.getForeignObjectsAsync('system.host.');
			if (!hosts) {
				return '';
			}

			for (const obj of Object.values(hosts)) {
				const native = obj && obj.native;
				if (!native || typeof native !== 'object') {
					continue;
				}

				for (const entry of Object.values(native)) {
					if (!entry || typeof entry !== 'object' || !('address' in entry)) {
						continue;
					}
					const address = String(entry.address);
					if (address && !address.startsWith('127.') && address !== '::1') {
						return address;
					}
				}
			}
		} catch (error) {
			this.log.debug(`Could not read system.host for webhookHost: ${error.message}`);
		}

		return '';
	}

	async ensureInfoStates() {
		for (const [stateId, name] of Object.entries(INFO_STATE_LABELS)) {
			const type = stateId === 'camerasOnline' ? 'number' : 'string';
			const role =
				stateId === 'connection' ? 'indicator.connected' : stateId === 'camerasOnline' ? 'value' : 'text';

			await this.setObjectNotExistsAsync(`${INFO_PREFIX}.${stateId}`, {
				type: 'state',
				common: {
					name,
					type: stateId === 'connection' ? 'boolean' : type,
					role,
					read: true,
					write: false,
					def: stateId === 'connection' ? false : stateId === 'camerasOnline' ? 0 : '',
				},
				native: {},
			});
		}

		await this.migrateLegacyInfoChannel();
	}

	async migrateLegacyInfoChannel() {
		for (const stateId of LEGACY_INFO_STATES) {
			const newId = `${INFO_PREFIX}.${stateId}`;

			for (const prefix of LEGACY_INFO_PREFIXES) {
				const legacyId = `${prefix}.${stateId}`;
				const legacyObject = await this.getObjectAsync(legacyId);
				if (!legacyObject) {
					continue;
				}

				const legacyState = await this.getStateAsync(legacyId);
				if (legacyState) {
					await this.setStateAsync(newId, legacyState.val, true);
				}

				await this.delObjectAsync(legacyId);
			}
		}

		for (const prefix of LEGACY_INFO_PREFIXES) {
			const legacyFolder = await this.getObjectAsync(prefix);
			if (legacyFolder) {
				await this.delObjectAsync(prefix);
			}
		}
	}

	async updateServerVersionStates() {
		if (!this.motionEyeApi) {
			return;
		}

		const motionEyeVersion = this.motionEyeApi.getLastMotionEyeVersion();
		if (motionEyeVersion) {
			await this.setStateAsync(`${INFO_PREFIX}.motionEyeVersion`, motionEyeVersion, true);
		}

		if (this._serverVersionsFetched) {
			return;
		}

		try {
			const versions = await this.motionEyeApi.getServerVersions();
			if (versions.motionEyeVersion) {
				await this.setStateAsync(`${INFO_PREFIX}.motionEyeVersion`, versions.motionEyeVersion, true);
			}
			await this.setStateAsync(`${INFO_PREFIX}.motionVersion`, versions.motionVersion || '', true);
			this._serverVersionsFetched = true;
		} catch (error) {
			this.log.debug(`Could not read MotionEye /version page: ${error.message}`);
		}
	}

	syncCameraRegistry() {
		this.camerasById.clear();
		this.camerasByChannel.clear();

		const cameras = resolveCameras(this.config.cameras, this.config.defaultMode || 'off');
		for (const camera of cameras) {
			if (!camera.enabled) {
				continue;
			}
			this.camerasById.set(camera.id, camera);
			this.camerasByChannel.set(camera.channel, camera);
		}
	}

	/**
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @returns {string}
	 */
	getWebhookUrl(camera) {
		if (!this.webhookHost) {
			return '';
		}
		return buildWebhookUrl(this.namespace, this.webhookHost, this.config.webhookPort, camera.id);
	}

	/**
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async ensureCameraObjects(camera) {
		const channelId = camera.channel;

		await this.setObjectNotExistsAsync(channelId, {
			type: 'channel',
			common: { name: camera.name },
			native: {
				id: camera.id,
				motionEyeId: camera.motionEyeId,
			},
		});

		const states = [
			{
				id: 'mode',
				common: {
					name: `${camera.name} mode`,
					type: 'string',
					role: 'level.mode',
					read: true,
					write: true,
					def: camera.defaultMode,
					states: {
						off: 'Off',
						still: 'Still',
						sharp: 'Sharp',
					},
				},
			},
			{
				id: 'motion',
				common: {
					name: `${camera.name} motion`,
					type: 'boolean',
					role: 'sensor.motion',
					read: true,
					write: true,
					def: false,
				},
			},
			{
				id: 'status',
				common: {
					name: `${camera.name} status`,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'lastAction',
				common: {
					name: `${camera.name} last action`,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'snapshot',
				common: {
					name: `${camera.name} snapshot trigger`,
					type: 'boolean',
					role: 'button',
					read: true,
					write: true,
					def: false,
				},
			},
			{
				id: 'stream',
				common: {
					name: `${camera.name} video stream`,
					type: 'boolean',
					role: 'switch',
					read: true,
					write: true,
					def: false,
				},
			},
			{
				id: 'streamPulse',
				common: {
					name: `${camera.name} stream pulse`,
					type: 'boolean',
					role: 'button',
					read: true,
					write: true,
					def: false,
				},
			},
			{
				id: 'streamUrl',
				common: {
					name: `${camera.name} stream HTML (inventwo)`,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'webhookUrl',
				common: {
					name: `${camera.name} webhook URL`,
					type: 'string',
					role: 'url',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'motionEyeId',
				common: {
					name: `${camera.name} MotionEye ID`,
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: camera.motionEyeId,
				},
			},
			{
				id: 'motionEyeName',
				common: {
					name: `${camera.name} MotionEye name`,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
					def: '',
				},
			},
		];

		for (const state of states) {
			await this.setObjectNotExistsAsync(`${channelId}.${state.id}`, {
				type: 'state',
				common: /** @type {ioBroker.StateCommon} */ (state.common),
				native: {},
			});
		}

		const webhookUrl = this.getWebhookUrl(camera);
		await this.setStateAsync(`${channelId}.webhookUrl`, webhookUrl, true);
		await this.setStateAsync(`${channelId}.motionEyeId`, camera.motionEyeId, true);
		await this.setStateAsync(`${channelId}.streamUrl`, '', true);
	}

	async initializeCameras() {
		this.syncCameraRegistry();

		if (!this.camerasById.size) {
			this.log.warn('No enabled cameras configured — add cameras on the Cameras tab');
		}

		for (const camera of this.camerasById.values()) {
			await this.ensureCameraObjects(camera);
		}

		let connected = false;
		try {
			await this.motionEyeApi.getCameraList();
			connected = true;
		} catch (error) {
			this.log.warn(`MotionEye not reachable at startup: ${error.message}`);
		}

		await this.setStateAsync(`${INFO_PREFIX}.connection`, connected, true);

		for (const camera of this.camerasById.values()) {
			try {
				await this.applyInitialCameraConfig(camera);
				await this.streamManager.applyStreamOnStart(camera);
			} catch (error) {
				this.log.warn(`Initial setup failed for ${camera.name}: ${error.message}`);
				await this.setStateAsync(`${camera.channel}.status`, `error: ${error.message}`, true);
			}
		}

		if (connected) {
			await this.updateServerVersionStates();
			await this.pollMotionEye();
		}
	}

	/**
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async applyInitialCameraConfig(camera) {
		const channelId = camera.channel;
		const currentMode = await this.getStateAsync(`${channelId}.mode`);
		const mode = /** @type {'off'|'still'|'sharp'} */ (
			normalizeMode(currentMode && currentMode.val) || camera.defaultMode || 'off'
		);

		if (!this.config.useMotionEyeConfig) {
			await this.setStateAsync(`${channelId}.mode`, mode, true);
			await this.setStateAsync(`${channelId}.status`, 'MotionEye config sync disabled', true);
			return;
		}

		/** @type {Record<string, unknown>} */
		const patch = {};

		if (this.config.applyMediaSettingsOnStart) {
			Object.assign(patch, MEDIA_SETTINGS);
		}

		Object.assign(patch, buildModePatch(mode, this.getWebhookUrl(camera)));

		if (this.config.disableStreamOnStart) {
			patch.video_streaming = false;
		}

		const storagePatch = buildStoragePatch(camera.mediaFolder);
		if (camera.mediaFolder && !storagePatch.root_directory) {
			this.log.warn(
				`Invalid media folder for ${camera.name}: "${camera.mediaFolder}" — skipped (use a single folder name without slashes)`,
			);
		} else {
			Object.assign(patch, storagePatch);
		}

		const result = await this.motionEyeApi.saveCameraConfig(camera.motionEyeId, patch);
		await this.setStateAsync(`${channelId}.mode`, mode, true);
		await this.setStateAsync(`${channelId}.status`, `Mode=${MODE_LABELS[mode]}`, true);

		if (result.changed) {
			await this.setStateAsync(`${channelId}.lastAction`, 'config/set initial', true);
			this.log.info(`Initial configuration applied for ${camera.name} (mode ${mode})`);
		}
	}

	/**
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {'off'|'still'|'sharp'} mode
	 * @param {boolean} [fromPoll]
	 */
	async setMode(camera, mode, fromPoll = false) {
		const channelId = camera.channel;

		if (!this.config.useMotionEyeConfig) {
			if (!fromPoll) {
				await this.setStateAsync(`${channelId}.mode`, mode, true);
			}
			await this.setStateAsync(`${channelId}.status`, 'useMotionEyeConfig is disabled', true);
			return;
		}

		const patch = buildModePatch(mode, this.getWebhookUrl(camera));
		const result = await this.motionEyeApi.saveCameraConfig(camera.motionEyeId, patch);

		await this.setStateAsync(`${channelId}.status`, `Mode=${MODE_LABELS[mode]}`, true);

		if (result.changed) {
			await this.setStateAsync(`${channelId}.lastAction`, `config/set mode=${mode}`, true);
			this.log.info(`Mode for ${camera.name}: ${MODE_LABELS[mode]}`);
		}

		if (!fromPoll) {
			await this.setStateAsync(`${channelId}.mode`, mode, true);
		}
	}

	async pollMotionEye() {
		if (!this.motionEyeApi) {
			return;
		}

		let cameras;
		try {
			cameras = await this.motionEyeApi.getCameraList();
			await this.setStateAsync(`${INFO_PREFIX}.connection`, true, true);
		} catch (error) {
			await this.setStateAsync(`${INFO_PREFIX}.connection`, false, true);
			throw error;
		}

		const byId = new Map(cameras.map(entry => [Number(entry.id), entry]));
		let online = 0;

		for (const camera of this.camerasById.values()) {
			const uiConfig = byId.get(camera.motionEyeId);
			if (!uiConfig) {
				await this.setStateAsync(`${camera.channel}.status`, 'not found in MotionEye', true);
				continue;
			}

			online += 1;
			const mode = inferModeFromConfig(uiConfig);
			const motionEyeName = String(uiConfig.name || uiConfig.id || camera.motionEyeId);

			await this.setStateAsync(`${camera.channel}.motionEyeName`, motionEyeName, true);

			const currentMode = await this.getStateAsync(`${camera.channel}.mode`);
			const localMode = normalizeMode(currentMode && currentMode.val);

			if (localMode !== mode) {
				await this.setMode(camera, mode, true);
			} else {
				await this.setStateAsync(`${camera.channel}.status`, `Mode=${MODE_LABELS[mode]}`, true);
			}

			const streaming = !!uiConfig.video_streaming;
			const streamState = await this.getStateAsync(`${camera.channel}.stream`);
			const localStream = !!(streamState && streamState.val);
			if (localStream !== streaming) {
				await this.streamManager.setStream(camera, streaming, true);
			}
		}

		await this.setStateAsync(`${INFO_PREFIX}.camerasOnline`, online, true);
		await this.setStateAsync(`${INFO_PREFIX}.lastSync`, new Date().toISOString(), true);
		await this.updateServerVersionStates();
	}

	async startWebhookServer() {
		if (this.webhookServer) {
			return;
		}

		this.webhookServer = createWebhookServer({
			port: this.config.webhookPort,
			bind: this.config.webhookBind || '0.0.0.0',
			namespace: this.namespace,
			onMotion: (cameraId, value) => this.handleWebhookMotion(cameraId, value),
			log: (level, message) => this.log[level](message),
		});

		await this.webhookServer.start();
	}

	/**
	 * @param {string} cameraId
	 * @param {boolean} value
	 */
	async handleWebhookMotion(cameraId, value) {
		const camera = this.camerasById.get(cameraId);
		if (!camera) {
			this.log.warn(`Webhook for unknown camera id "${cameraId}"`);
			return;
		}

		const stateId = `${this.namespace}.${camera.channel}.motion`;
		await this.setStateAsync(stateId, value, true);

		if (value) {
			this.scheduleMotionReset(camera);
			await this.setStateAsync(`${camera.channel}.lastAction`, 'motion webhook', true);
			this.log.debug(`Motion webhook for ${camera.name}`);
		}
	}

	/**
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	scheduleMotionReset(camera) {
		const stateId = `${this.namespace}.${camera.channel}.motion`;
		if (this.motionResetTimers[stateId]) {
			this.clearTimeout(this.motionResetTimers[stateId]);
		}

		const resetMs = Math.max(1000, Number(this.config.motionResetMs) || 15000);
		this.motionResetTimers[stateId] = this.setTimeout(async () => {
			delete this.motionResetTimers[stateId];
			await this.setStateAsync(stateId, false, true);
		}, resetMs);
	}

	/**
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (!state || state.ack || this._unloading) {
			return;
		}

		const relativeId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
		const dot = relativeId.indexOf('.');
		if (dot < 0) {
			return;
		}

		const channel = relativeId.slice(0, dot);
		const stateName = relativeId.slice(dot + 1);
		const camera = this.camerasByChannel.get(channel);
		if (!camera) {
			return;
		}

		if (stateName === 'mode') {
			const mode = normalizeMode(state.val);
			if (!mode) {
				this.log.warn(`Invalid mode "${state.val}" for ${camera.name}`);
				return;
			}

			try {
				await this.setMode(camera, mode);
			} catch (error) {
				this.log.error(`setMode failed for ${camera.name}: ${error.message}`);
				await this.setStateAsync(`${camera.channel}.status`, `error: ${error.message}`, true);
			}
			return;
		}

		if (stateName === 'motion' && state.val === true) {
			this.scheduleMotionReset(camera);
			return;
		}

		if (stateName === 'snapshot' && state.val === true) {
			try {
				const result = await this.motionApi.takeSnapshot(camera.motionEyeId);
				await this.setStateAsync(`${camera.channel}.lastAction`, `action/snapshot: ${result.body}`, true);
			} catch (error) {
				this.log.error(`Snapshot failed for ${camera.name}: ${error.message}`);
			}
			await this.setStateAsync(`${camera.channel}.snapshot`, false, true);
			return;
		}

		if (stateName === 'stream') {
			try {
				await this.streamManager.setStream(camera, !!state.val);
			} catch (error) {
				this.log.error(`setStream failed for ${camera.name}: ${error.message}`);
				await this.setStateAsync(`${camera.channel}.status`, `error: ${error.message}`, true);
			}
			return;
		}

		if (stateName === 'streamPulse' && state.val === true) {
			try {
				await this.streamManager.pulseStream(camera);
			} catch (error) {
				this.log.error(`streamPulse failed for ${camera.name}: ${error.message}`);
			}
			await this.setStateAsync(`${camera.channel}.streamPulse`, false, true);
		}
	}

	/**
	 * @param {import('@iobroker/adapter-core').Message} obj
	 */
	async onMessage(obj) {
		if (!obj || typeof obj.command !== 'string') {
			return;
		}

		if (obj.command === 'loadCameras') {
			await this.handleLoadCameras(obj);
		}
	}

	/**
	 * @param {import('@iobroker/adapter-core').Message} obj
	 */
	async handleLoadCameras(obj) {
		const payload = obj.message && typeof obj.message === 'object' ? obj.message : {};

		const motionHost = String(payload.motionHost || this.config.motionHost || '').trim();
		const motionEyePort = Number(payload.motionEyePort ?? this.config.motionEyePort) || 8765;
		const motionEyeUser = String(payload.motionEyeUser ?? this.config.motionEyeUser ?? 'admin');
		const motionEyePassword = String(payload.motionEyePassword ?? this.config.motionEyePassword ?? '');
		const requestTimeoutMs = Number(payload.requestTimeoutMs ?? this.config.requestTimeoutMs) || 45000;
		const defaultMode = String(payload.defaultMode || this.config.defaultMode || 'off');
		const existingCameras = Array.isArray(payload.cameras) ? payload.cameras : this.config.cameras || [];

		try {
			if (!motionHost) {
				throw new Error('MotionEye host is required');
			}

			const api = createMotionEyeApi({
				host: motionHost,
				motionEyePort,
				username: motionEyeUser,
				password: motionEyePassword,
				requestTimeoutMs,
				listCacheMs: 0,
			});

			const motionEyeList = await api.getCameraList();
			const { cameras, added } = mergeMotionEyeCameras(existingCameras, motionEyeList, defaultMode);

			this.log.info(`Loaded ${motionEyeList.length} camera(s) from MotionEye, added ${added} new row(s)`);

			if (obj.callback) {
				obj.callback({
					native: { cameras },
					result: added > 0 ? 'added' : 'none',
				});
			}
		} catch (error) {
			this.log.error(`loadCameras failed: ${error.message}`);
			if (obj.callback) {
				obj.callback({ error: error.message });
			}
		}
	}

	/**
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		this._unloading = true;

		try {
			if (this.pollInterval) {
				this.clearInterval(this.pollInterval);
				this.pollInterval = undefined;
			}

			for (const timerId of Object.keys(this.motionResetTimers)) {
				this.clearTimeout(this.motionResetTimers[timerId]);
			}
			this.motionResetTimers = {};

			if (this.streamManager) {
				this.streamManager.destroy();
				this.streamManager = undefined;
			}

			const stopWebhook = this.webhookServer ? this.webhookServer.stop() : Promise.resolve();
			stopWebhook
				.catch(error => {
					this.log.warn(`Webhook server stop error: ${error.message}`);
				})
				.finally(() => {
					this.webhookServer = undefined;
					this.motionEyeApi = undefined;
					this.motionApi = undefined;
					callback();
				});
		} catch (error) {
			this.log.error(`Error during unloading: ${error.message}`);
			callback();
		}
	}
}

if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	module.exports = options => new Motioneye(options);
	module.exports.Motioneye = Motioneye;
} else {
	new Motioneye();
}
