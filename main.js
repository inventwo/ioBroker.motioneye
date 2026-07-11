'use strict';

/*
 * Created with @iobroker/create-adapter (inventwo scaffold)
 */

const utils = require('@iobroker/adapter-core');
const { createMotionEyeApi } = require('./lib/motionEyeApi');
const { buildStoragePatch } = require('./lib/mediaStorage');
const { summarizeMediaList, bytesToMb } = require('./lib/mediaUsage');
const { INFO_STATE_LABELS } = require('./lib/infoLabels');
const { mergeMotionEyeCameras, parseLoadCamerasMessage } = require('./lib/cameraDiscovery');
const { resolveCameras, resolveLegacyCameras, buildWebhookUrl } = require('./lib/cameraRegistry');
const {
	normalizeMode,
	inferModeFromConfig,
	buildModePatch,
	MODE_LABELS,
	MEDIA_SETTINGS,
} = require('./lib/modeProfiles');
const {
	FRAMERATE_MIN,
	FRAMERATE_MAX,
	VALID_ROTATIONS,
	normalizeResolution,
	parseAvailableResolutions,
	normalizeRotation,
	normalizeBoolean,
	buildFrameratePatch,
	buildResolutionPatch,
	buildRotationPatch,
	buildAutoBrightnessPatch,
	buildPrivacyMaskPatch,
	TEXT_POSITION_OPTIONS,
	TEXT_SCALE_MIN,
	TEXT_SCALE_MAX,
	normalizeTextPosition,
	normalizeTextScale,
	buildTextOverlayPatch,
	buildLeftTextPatch,
	buildRightTextPatch,
	buildCustomLeftTextPatch,
	buildCustomRightTextPatch,
	buildTextScalePatch,
} = require('./lib/deviceProfiles');
const {
	FRAME_CHANGE_THRESHOLD_MIN,
	FRAME_CHANGE_THRESHOLD_MAX,
	NOISE_LEVEL_MIN,
	NOISE_LEVEL_MAX,
	EVENT_GAP_MIN,
	EVENT_GAP_MAX,
	CAPTURE_FRAMES_MIN,
	CAPTURE_FRAMES_MAX,
	MINIMUM_MOTION_FRAMES_MIN,
	MINIMUM_MOTION_FRAMES_MAX,
	LIGHT_SWITCH_DETECT_MIN,
	LIGHT_SWITCH_DETECT_MAX,
	MOTION_DETECTION_PARAM_IDS,
	normalizeFrameChangeThreshold,
	normalizeNoiseLevel,
	normalizeDespeckleFilter,
	buildMotionDetectionPatch,
} = require('./lib/motionDetectionProfiles');
const { createWebhookServer } = require('./lib/webhookServer');
const { createStreamManager } = require('./lib/streamManager');
const { createSnapshotCacheManager } = require('./lib/snapshotCacheManager');
const { createTelegramNotificationManager } = require('./lib/telegramNotifications');
const { capTimerMs, MAX_TIMER_MS } = require('./lib/timerMs');
const { createVerboseLogger, describePassword, getUnauthorizedVerboseHints } = require('./lib/diagLog');

/** Info states under `_info` (lowercase, like other adapters). */
const INFO_PREFIX = '_info';
const LEGACY_INFO_PREFIXES = ['info', '0_info'];
const LEGACY_INFO_STATES = ['connection', 'camerasOnline', 'lastSync', 'motionEyeVersion', 'motionVersion'];
/** Writable string enum — valid ioBroker role for off/still/sharp (repochecker). */
const CAMERA_MODE_ROLE = 'level.effect';
const CAMERA_STATE_IDS = [
	'mode',
	'motion',
	'status',
	'lastAction',
	'snapshot',
	'stream',
	'streamPulse',
	'streamUrl',
	'webhookUrl',
	'motionEyeId',
	'motionEyeName',
];

/** Camera device parameters grouped under the `settings` sub-channel. */
const CAMERA_SETTINGS_CHANNEL = 'settings';
/** Writable device parameters handled via setDeviceParam (state id under `settings`). */
const DEVICE_PARAMS = ['framerate', 'resolution', 'rotation', 'autoBrightness', 'privacyMask'];

/** Text overlay parameters grouped under the `overlay` sub-channel. */
const CAMERA_OVERLAY_CHANNEL = 'overlay';
/** Writable overlay parameters handled via setOverlayParam (state id under `overlay`). */
const OVERLAY_PARAMS = ['enabled', 'leftText', 'rightText', 'customLeftText', 'customRightText', 'textScale'];

/** Motion detection tuning parameters grouped under the `motiondetection` sub-channel. */
const CAMERA_MOTION_DETECTION_CHANNEL = 'motiondetection';
/** Writable motion detection parameters handled via setMotionDetectionParam. */
const MOTION_DETECTION_PARAMS = MOTION_DETECTION_PARAM_IDS;

/** Snapshot/video count + occupied space grouped under the `storage` sub-channel. */
const CAMERA_STORAGE_CHANNEL = 'storage';
/** Cached snapshot JPEG + URLs grouped under the `snapshots` sub-channel. */
const CAMERA_SNAPSHOTS_CHANNEL = 'snapshots';
/** Floor for storagePollIntervalSec when auto-refresh is enabled (media listing is expensive). */
const STORAGE_POLL_MIN_SEC = 300;
/** Human-readable labels for the left_text/right_text enum (MotionEye UI config). */
const TEXT_POSITION_LABELS = {
	'camera-name': 'Camera name',
	timestamp: 'Timestamp',
	'custom-text': 'Custom text',
	disabled: 'Disabled',
};

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
		this.on('message', obj => {
			this.onMessage(obj).catch(error => {
				this.log.error(`onMessage failed: ${error.stack || error.message || error}`);
				this.replyToMessage(obj, { error: String(error.message || error) });
			});
		});
		this.on('unload', this.onUnload.bind(this));

		this.motionEyeApi = undefined;
		this.streamManager = undefined;
		this.snapshotCache = undefined;
		this.telegramNotifications = undefined;
		this.webhookServer = undefined;
		this.pollInterval = undefined;
		this.storagePollInterval = undefined;
		this.motionResetTimers = {};
		/** @type {Map<string, import('./lib/cameraRegistry').ResolvedCamera>} */
		this.camerasById = new Map();
		/** @type {Map<string, import('./lib/cameraRegistry').ResolvedCamera>} */
		this.camerasByChannel = new Map();
		/** @type {Map<string, string[]>} Supported resolutions per channel (from last poll). */
		this.availableResolutionsByChannel = new Map();
		/** @type {Map<string, unknown[]>} Last known privacy mask regions per channel (to restore on re-enable). */
		this.privacyMaskLinesByChannel = new Map();
		this.webhookHost = '';
		this._unloading = false;
		this._serverVersionsFetched = false;
		this.verboseLog = _message => {};
	}

	/**
	 * Refresh verbose logger after config is available.
	 */
	initVerboseLogging() {
		this.verboseLog = createVerboseLogger(this.config, (level, message) => this.log[level](message));
	}

	/**
	 * Log connection settings when verbose logging is enabled (no secrets).
	 */
	logVerboseStartup() {
		if (!this.config.debugging_verbose) {
			return;
		}

		const host = String(this.config.motionHost || '').trim();
		const user = String(this.config.motionEyeUser || 'admin');
		this.verboseLog('Verbose diagnostic logging enabled — disable after troubleshooting');
		this.verboseLog(
			`MotionEye API: ${host}:${Number(this.config.motionEyePort) || 8765}, user=${user}, password ${describePassword(this.config.motionEyePassword)}`,
		);
		this.verboseLog(
			`Webhook listener: ${this.config.webhookBind || '0.0.0.0'}:${Number(this.config.webhookPort) || 8090}, webhook host for MotionEye: ${this.webhookHost || '(not set)'}`,
		);
		this.verboseLog(`useMotionEyeConfig=${this.config.useMotionEyeConfig !== false}`);
		this.verboseLog(`Enabled cameras in config: ${this.camerasById.size}`);
	}

	/**
	 * Extra verbose hints when MotionEye API returns unauthorized.
	 */
	logVerboseUnauthorizedHints() {
		for (const line of getUnauthorizedVerboseHints(this.config)) {
			this.verboseLog(line);
		}
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		this.log.info('MotionEye adapter starting...');
		this.initVerboseLogging();

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
			verboseLog: message => this.verboseLog(message),
		});

		this.streamManager = createStreamManager({
			motionHost: this.config.motionHost,
			motionEyeApi: this.motionEyeApi,
			useMotionEyeConfig: this.config.useMotionEyeConfig !== false,
			disableStreamOnStart: this.config.disableStreamOnStart !== false,
			streamAutoOffMs: capTimerMs(this.config.streamAutoOffMs, { min: 0, default: 0 }),
			streamStartDelayMs: capTimerMs(this.config.streamStartDelayMs, { min: 0, default: 3000 }),
			streamReadyTimeoutMs: capTimerMs(this.config.streamReadyTimeoutMs, { min: 1000, default: 45000 }),
			streamRetryMs: capTimerMs(this.config.streamRetryMs, { min: 100, default: 2000 }),
			streamSiblingRelinkTimeoutMs: capTimerMs(this.config.streamSiblingRelinkTimeoutMs, {
				min: 0,
				default: 60000,
			}),
			getState: id => this.getStateAsync(id),
			setState: (id, val, ack) => this.setStateAsync(id, val, ack),
			log: (level, message) => this.log[level](message),
			setTimeoutFn: (fn, ms) => this.setTimeout(fn, ms),
			delayFn: ms => this.delay(ms),
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

		this.snapshotCache = createSnapshotCacheManager({
			namespace: this.namespace,
			getConfig: () => this.config,
			getMotionEyeApi: () => this.motionEyeApi,
			writeFile: (relativePath, data) =>
				new Promise((resolve, reject) => {
					this.writeFile(this.namespace, relativePath, data, err => {
						if (err) {
							reject(err instanceof Error ? err : new Error(String(err)));
							return;
						}
						resolve();
					});
				}),
			setState: (id, val, ack) => this.setStateAsync(id, val, ack),
			getState: id => this.getStateAsync(id),
			resolveLocalHost: async () => {
				const host = await this.resolveWebhookHost();
				return host || '127.0.0.1';
			},
			resolveWebAdapter: () => this.resolveWebAdapter(),
			getDataDir: () => utils.getAbsoluteDefaultDataDir(),
			verboseLog: message => this.verboseLog(message),
			log: (level, message) => this.log[level](message),
			delayFn: ms => this.delay(ms),
			isUnloading: () => this._unloading,
			onSnapshotCached: (camera, meta) => {
				void this.telegramNotifications?.onSnapshotCached(camera, meta);
			},
		});
		await this.snapshotCache.init();

		this.telegramNotifications = createTelegramNotificationManager({
			getConfig: () => this.config,
			getCameraNotification: camera => camera.notification,
			sendToTelegram: (instance, payload) =>
				new Promise(resolve => {
					this.sendTo(`telegram.${instance}`, 'send', payload, () => resolve());
				}),
			ensureSnapshot: async camera => {
				await this.snapshotCache.refreshForNotification(camera);
				const prefix = `${camera.channel}.${CAMERA_SNAPSHOTS_CHANNEL}`;
				const [filePathState, lastUpdateState] = await Promise.all([
					this.getStateAsync(`${prefix}.filePath`),
					this.getStateAsync(`${prefix}.lastUpdate`),
				]);
				return {
					filePath: String(filePathState?.val || ''),
					lastUpdate: String(lastUpdateState?.val || ''),
				};
			},
			log: (level, message) => this.log[level](message),
			verboseLog: message => this.verboseLog(message),
			isUnloading: () => this._unloading,
		});

		await this.ensureInfoStates();
		await this.syncCameraRegistry();
		this.logVerboseStartup();

		try {
			await this.startWebhookServer();
		} catch (error) {
			this.log.error(`Webhook server failed to start: ${error.message}`);
		}

		await this.initializeCameras();

		this.subscribeStates('*.mode');
		this.subscribeStates('*.snapshot');
		this.subscribeStates('*.stream');
		this.subscribeStates('*.streamPulse');
		this.subscribeStates('*.settings.framerate');
		this.subscribeStates('*.settings.resolution');
		this.subscribeStates('*.settings.rotation');
		this.subscribeStates('*.settings.autoBrightness');
		this.subscribeStates('*.settings.privacyMask');
		this.subscribeStates('*.overlay.enabled');
		this.subscribeStates('*.overlay.leftText');
		this.subscribeStates('*.overlay.rightText');
		this.subscribeStates('*.overlay.customLeftText');
		this.subscribeStates('*.overlay.customRightText');
		this.subscribeStates('*.overlay.textScale');
		this.subscribeStates('*.storage.refresh');
		this.subscribeStates('*.snapshots.refresh');

		const pollSec = Math.min(
			Math.max(30, Number(this.config.statusPollIntervalSec) || 300),
			Math.floor(MAX_TIMER_MS / 1000),
		);
		const schedulePoll = () => {
			this.pollInterval = this.setTimeout(async () => {
				try {
					await this.pollMotionEye();
				} catch (error) {
					this.log.warn(`Status poll failed: ${error.message}`);
				}
				if (!this._unloading) {
					schedulePoll();
				}
			}, pollSec * 1000);
		};
		schedulePoll();

		// Off by default — media listing requires MotionEye to recursively stat() every
		// stored file, which can be slow with large media libraries. Use the per-camera
		// storage.refresh trigger for on-demand refreshes instead. When enabled, only
		// cameras with storageAutoRefresh !== false (Storage config tab) are included.
		const storagePollSecRaw = Math.floor(Number(this.config.storagePollIntervalSec)) || 0;
		if (this.config.storagePollEnabled && storagePollSecRaw > 0) {
			const storagePollSec = Math.min(
				Math.max(STORAGE_POLL_MIN_SEC, storagePollSecRaw),
				Math.floor(MAX_TIMER_MS / 1000),
			);
			const scheduleStoragePoll = () => {
				this.storagePollInterval = this.setTimeout(async () => {
					try {
						await this.refreshAllCameraStorage();
					} catch (error) {
						this.log.warn(`Storage poll failed: ${error.message}`);
					}
					if (!this._unloading) {
						scheduleStoragePoll();
					}
				}, storagePollSec * 1000);
			};
			scheduleStoragePoll();
		}

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
		const metaCommon = {
			name,
			type: 'meta.user',
		};
		if (!existing) {
			await this.setForeignObjectAsync(rootId, {
				type: 'meta',
				common: metaCommon,
				native: {},
			});
		} else if (existing.type !== 'meta' || existing.common?.type !== 'meta.user') {
			await this.extendForeignObjectAsync(rootId, {
				type: 'meta',
				common: metaCommon,
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

	/**
	 * @returns {Promise<{ port: number, secure: boolean }>}
	 */
	async resolveWebAdapter() {
		try {
			const webObj = await this.getForeignObjectAsync('system.adapter.web.0');
			return {
				port: Number(webObj?.native?.port) || 8082,
				secure: webObj?.native?.secure === true,
			};
		} catch (error) {
			this.log.debug(`Could not read web adapter port, using 8082: ${error.message}`);
			return { port: 8082, secure: false };
		}
	}

	async ensureInfoStates() {
		const infoChannelName = {
			en: 'MotionEye adapter information',
			de: 'MotionEye-Adapter-Informationen',
			ru: 'Информация об адаптере MotionEye',
			pt: 'Informações do adaptador MotionEye',
			nl: 'MotionEye-adapterinformatie',
			fr: "Informations sur l'adaptateur MotionEye",
			it: "Informazioni sull'adattatore MotionEye",
			es: 'Información del adaptador MotionEye',
			pl: 'Informacje o adapterze MotionEye',
			uk: 'Інформація про адаптер MotionEye',
			'zh-cn': 'MotionEye 适配器信息',
		};

		await this.setObjectNotExistsAsync(INFO_PREFIX, {
			type: 'channel',
			common: {
				name: infoChannelName,
			},
			native: {},
		});

		const infoChannel = await this.getObjectAsync(INFO_PREFIX);
		if (infoChannel && infoChannel.type !== 'channel') {
			await this.setObjectAsync(INFO_PREFIX, {
				type: 'channel',
				common: {
					name: infoChannelName,
				},
				native: infoChannel.native || {},
			});
		}

		for (const [stateId, labels] of Object.entries(INFO_STATE_LABELS)) {
			if (stateId.startsWith('_')) {
				continue;
			}
			const type = stateId === 'camerasOnline' ? 'number' : 'string';
			const role =
				stateId === 'connection' ? 'indicator.connected' : stateId === 'camerasOnline' ? 'value' : 'text';

			await this.setObjectNotExistsAsync(`${INFO_PREFIX}.${stateId}`, {
				type: 'state',
				common: {
					name: /** @type {ioBroker.StringOrTranslated} */ (labels),
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
					role: CAMERA_MODE_ROLE,
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
					write: false,
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
					name: `${camera.name} stream HTML`,
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
			const stateId = `${channelId}.${state.id}`;
			await this.setObjectNotExistsAsync(stateId, {
				type: 'state',
				common: /** @type {ioBroker.StateCommon} */ (state.common),
				native: {},
			});
		}

		await this.ensureCameraSettingsObjects(camera);
		await this.ensureCameraOverlayObjects(camera);
		await this.ensureCameraMotionDetectionObjects(camera);
		await this.ensureCameraStorageObjects(camera);
		await this.ensureCameraSnapshotsObjects(camera);

		await this.extendObjectAsync(`${channelId}.mode`, {
			common: { role: CAMERA_MODE_ROLE },
		});
		await this.extendObjectAsync(`${channelId}.motion`, {
			common: { write: false, role: 'sensor.motion' },
		});

		const streamUrlId = `${channelId}.streamUrl`;
		const streamUrlName = `${camera.name} stream HTML`;
		const streamUrlObject = await this.getObjectAsync(streamUrlId);
		const currentStreamUrlName = streamUrlObject?.common?.name ? String(streamUrlObject.common.name) : '';
		if (currentStreamUrlName && /\(inventwo\)|inventwo HTML/i.test(currentStreamUrlName)) {
			await this.extendObjectAsync(streamUrlId, {
				common: { name: streamUrlName },
			});
		}

		const webhookUrl = this.getWebhookUrl(camera);
		await this.setStateAsync(`${channelId}.webhookUrl`, webhookUrl, true);
		await this.setStateAsync(`${channelId}.motionEyeId`, camera.motionEyeId, true);
		await this.setStateAsync(`${channelId}.streamUrl`, '', true);
	}

	/**
	 * Cache privacy mask regions in memory and persist them to the settings channel's
	 * native config, so they survive adapter restarts/updates (see setPrivacyMask).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {unknown[]} lines
	 */
	async cachePrivacyMaskLines(camera, lines) {
		if (!Array.isArray(lines) || !lines.length) {
			return;
		}

		const previous = this.privacyMaskLinesByChannel.get(camera.channel);
		this.privacyMaskLinesByChannel.set(camera.channel, lines);

		if (JSON.stringify(previous) === JSON.stringify(lines)) {
			return;
		}

		const settingsId = `${camera.channel}.${CAMERA_SETTINGS_CHANNEL}`;
		await this.extendObjectAsync(settingsId, {
			native: { privacyMaskLines: lines },
		});
	}

	/**
	 * Create the `settings` sub-channel and camera device parameter states.
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async ensureCameraSettingsObjects(camera) {
		const settingsId = `${camera.channel}.${CAMERA_SETTINGS_CHANNEL}`;

		await this.setObjectNotExistsAsync(settingsId, {
			type: 'channel',
			common: { name: `${camera.name} settings` },
			native: {},
		});

		// Seed the in-memory cache from persisted native config — the object survives
		// adapter restarts/updates, unlike a plain JS Map, so privacy mask regions
		// are not lost when the adapter is updated (npm or GitHub).
		const settingsObject = await this.getObjectAsync(settingsId);
		const storedLines = settingsObject?.native?.privacyMaskLines;
		if (Array.isArray(storedLines) && storedLines.length && !this.privacyMaskLinesByChannel.has(camera.channel)) {
			this.privacyMaskLinesByChannel.set(camera.channel, storedLines);
		}

		const states = [
			{
				id: 'framerate',
				common: {
					name: `${camera.name} framerate`,
					type: 'number',
					role: 'level',
					unit: 'fps',
					min: FRAMERATE_MIN,
					max: FRAMERATE_MAX,
					read: true,
					write: true,
					def: FRAMERATE_MIN,
				},
			},
			{
				id: 'resolution',
				common: {
					name: `${camera.name} resolution`,
					type: 'string',
					role: 'text',
					read: true,
					write: true,
					def: '',
				},
			},
			{
				id: 'availableResolutions',
				common: {
					name: `${camera.name} available resolutions`,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'rotation',
				common: {
					name: `${camera.name} rotation`,
					type: 'number',
					role: 'level',
					unit: '°',
					read: true,
					write: true,
					def: 0,
					states: VALID_ROTATIONS.reduce((acc, deg) => {
						acc[deg] = `${deg}°`;
						return acc;
					}, /** @type {Record<number, string>} */ ({})),
				},
			},
			{
				id: 'autoBrightness',
				common: {
					name: `${camera.name} auto brightness`,
					type: 'boolean',
					role: 'switch',
					read: true,
					write: true,
					def: false,
				},
			},
			{
				id: 'privacyMask',
				common: {
					name: `${camera.name} privacy mask`,
					type: 'boolean',
					role: 'switch',
					read: true,
					write: true,
					def: false,
				},
			},
		];

		for (const state of states) {
			await this.setObjectNotExistsAsync(`${settingsId}.${state.id}`, {
				type: 'state',
				common: /** @type {ioBroker.StateCommon} */ (state.common),
				native: {},
			});
		}

		// Clean up pre-settings-channel root states (unreleased 0.5.x dev builds).
		for (const legacyId of ['framerate', 'resolution', 'availableResolutions']) {
			const rootId = `${camera.channel}.${legacyId}`;
			if (await this.getObjectAsync(rootId)) {
				await this.delObjectAsync(rootId);
			}
		}
	}

	/**
	 * Create the `overlay` sub-channel and camera text overlay states.
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async ensureCameraOverlayObjects(camera) {
		const overlayId = `${camera.channel}.${CAMERA_OVERLAY_CHANNEL}`;

		await this.setObjectNotExistsAsync(overlayId, {
			type: 'channel',
			common: { name: `${camera.name} text overlay` },
			native: {},
		});

		const textPositionStates = TEXT_POSITION_OPTIONS.reduce((acc, option) => {
			acc[option] = TEXT_POSITION_LABELS[option] || option;
			return acc;
		}, /** @type {Record<string, string>} */ ({}));

		// `def` only takes effect the first time this state object is created (e.g. a
		// brand-new camera) — it seeds the initial value from the Overlay config table
		// row, if filled in. It has no effect on cameras that already have this state.
		const overlay = camera.overlayConfig;
		const states = [
			{
				id: 'enabled',
				common: {
					name: `${camera.name} text overlay enabled`,
					type: 'boolean',
					role: 'switch',
					read: true,
					write: true,
					def: overlay.enabled === 'true',
				},
			},
			{
				id: 'leftText',
				common: {
					name: `${camera.name} left text`,
					type: 'string',
					role: 'text',
					read: true,
					write: true,
					def: overlay.leftText || 'camera-name',
					states: textPositionStates,
				},
			},
			{
				id: 'rightText',
				common: {
					name: `${camera.name} right text`,
					type: 'string',
					role: 'text',
					read: true,
					write: true,
					def: overlay.rightText || 'timestamp',
					states: textPositionStates,
				},
			},
			{
				id: 'customLeftText',
				common: {
					name: `${camera.name} custom left text`,
					type: 'string',
					role: 'text',
					read: true,
					write: true,
					def: overlay.customLeftText,
				},
			},
			{
				id: 'customRightText',
				common: {
					name: `${camera.name} custom right text`,
					type: 'string',
					role: 'text',
					read: true,
					write: true,
					def: overlay.customRightText,
				},
			},
			{
				id: 'textScale',
				common: {
					name: `${camera.name} text size`,
					type: 'number',
					role: 'level',
					min: TEXT_SCALE_MIN,
					max: TEXT_SCALE_MAX,
					read: true,
					write: true,
					def: overlay.textScale || TEXT_SCALE_MIN,
				},
			},
		];

		for (const state of states) {
			await this.setObjectNotExistsAsync(`${overlayId}.${state.id}`, {
				type: 'state',
				common: /** @type {ioBroker.StateCommon} */ (state.common),
				native: {},
			});
		}
	}

	/**
	 * Create the `motiondetection` sub-channel and motion detection tuning states.
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async ensureCameraMotionDetectionObjects(camera) {
		const motionDetectionId = `${camera.channel}.${CAMERA_MOTION_DETECTION_CHANNEL}`;

		await this.setObjectNotExistsAsync(motionDetectionId, {
			type: 'channel',
			common: { name: `${camera.name} motion detection` },
			native: {},
		});

		const states = [
			{
				id: 'frameChangeThreshold',
				common: {
					name: `${camera.name} frame change threshold`,
					type: 'number',
					role: 'level',
					unit: '%',
					min: FRAME_CHANGE_THRESHOLD_MIN,
					max: FRAME_CHANGE_THRESHOLD_MAX,
					read: true,
					write: true,
					def: 1,
				},
			},
			{
				id: 'autoThresholdTuning',
				common: {
					name: `${camera.name} auto threshold tuning`,
					type: 'boolean',
					role: 'switch',
					read: true,
					write: true,
					def: false,
				},
			},
			{
				id: 'autoNoiseDetect',
				common: {
					name: `${camera.name} auto noise detection`,
					type: 'boolean',
					role: 'switch',
					read: true,
					write: true,
					def: true,
				},
			},
			{
				id: 'noiseLevel',
				common: {
					name: `${camera.name} noise level`,
					type: 'number',
					role: 'level',
					min: NOISE_LEVEL_MIN,
					max: NOISE_LEVEL_MAX,
					read: true,
					write: true,
					def: 32,
				},
			},
			{
				id: 'eventGap',
				common: {
					name: `${camera.name} motionless gap`,
					type: 'number',
					role: 'level',
					unit: 's',
					min: EVENT_GAP_MIN,
					max: EVENT_GAP_MAX,
					read: true,
					write: true,
					def: 30,
				},
			},
			{
				id: 'minimumMotionFrames',
				common: {
					name: `${camera.name} minimum motion frames`,
					type: 'number',
					role: 'level',
					unit: 'frames',
					min: MINIMUM_MOTION_FRAMES_MIN,
					max: MINIMUM_MOTION_FRAMES_MAX,
					read: true,
					write: true,
					def: 10,
				},
			},
			{
				id: 'lightSwitchDetect',
				common: {
					name: `${camera.name} light switch detection`,
					type: 'number',
					role: 'level',
					unit: '%',
					min: LIGHT_SWITCH_DETECT_MIN,
					max: LIGHT_SWITCH_DETECT_MAX,
					read: true,
					write: true,
					def: 0,
				},
			},
			{
				id: 'despeckleFilter',
				common: {
					name: `${camera.name} despeckle filter`,
					type: 'boolean',
					role: 'switch',
					read: true,
					write: true,
					def: false,
				},
			},
			{
				id: 'preCapture',
				common: {
					name: `${camera.name} pre-capture frames`,
					type: 'number',
					role: 'level',
					unit: 'frames',
					min: CAPTURE_FRAMES_MIN,
					max: CAPTURE_FRAMES_MAX,
					read: true,
					write: true,
					def: 5,
				},
			},
			{
				id: 'postCapture',
				common: {
					name: `${camera.name} post-capture frames`,
					type: 'number',
					role: 'level',
					unit: 'frames',
					min: CAPTURE_FRAMES_MIN,
					max: CAPTURE_FRAMES_MAX,
					read: true,
					write: true,
					def: 10,
				},
			},
		];

		for (const state of states) {
			await this.setObjectNotExistsAsync(`${motionDetectionId}.${state.id}`, {
				type: 'state',
				common: /** @type {ioBroker.StateCommon} */ (state.common),
				native: {},
			});
		}
	}

	/**
	 * Create the `storage` sub-channel: snapshot/video counts and occupied space
	 * (read-only, filled in by refreshCameraStorage) plus a manual refresh trigger.
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async ensureCameraStorageObjects(camera) {
		const storageId = `${camera.channel}.${CAMERA_STORAGE_CHANNEL}`;

		await this.setObjectNotExistsAsync(storageId, {
			type: 'channel',
			common: { name: `${camera.name} storage` },
			native: {},
		});

		const states = [
			{
				id: 'snapshotCount',
				common: {
					name: `${camera.name} snapshot count`,
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: 0,
				},
			},
			{
				id: 'videoCount',
				common: {
					name: `${camera.name} video count`,
					type: 'number',
					role: 'value',
					read: true,
					write: false,
					def: 0,
				},
			},
			{
				id: 'usedSpaceMb',
				common: {
					name: `${camera.name} occupied space`,
					type: 'number',
					role: 'value',
					unit: 'MB',
					read: true,
					write: false,
					def: 0,
				},
			},
			{
				id: 'lastRefresh',
				common: {
					name: `${camera.name} storage last refresh`,
					type: 'string',
					role: 'date',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'refresh',
				common: {
					name: `${camera.name} storage refresh trigger`,
					type: 'boolean',
					role: 'button',
					read: true,
					write: true,
					def: false,
				},
			},
		];

		for (const state of states) {
			await this.setObjectNotExistsAsync(`${storageId}.${state.id}`, {
				type: 'state',
				common: /** @type {ioBroker.StateCommon} */ (state.common),
				native: {},
			});
		}
	}

	/**
	 * Create the `snapshots` sub-channel: cached JPEG in ioBroker file storage plus
	 * URLs and HTML for VIS/Telegram (filled by snapshotCacheManager).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async ensureCameraSnapshotsObjects(camera) {
		const snapshotsId = `${camera.channel}.${CAMERA_SNAPSHOTS_CHANNEL}`;

		await this.setObjectNotExistsAsync(snapshotsId, {
			type: 'channel',
			common: { name: `${camera.name} snapshots` },
			native: {},
		});

		const states = [
			{
				id: 'url',
				common: {
					name: `${camera.name} snapshot URL`,
					type: 'string',
					role: 'url',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'urlLocal',
				common: {
					name: `${camera.name} snapshot URL (LAN)`,
					type: 'string',
					role: 'url',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'filePath',
				common: {
					name: `${camera.name} snapshot file path`,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'html',
				common: {
					name: `${camera.name} snapshot HTML`,
					type: 'string',
					role: 'text',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'lastUpdate',
				common: {
					name: `${camera.name} snapshot last update`,
					type: 'string',
					role: 'date',
					read: true,
					write: false,
					def: '',
				},
			},
			{
				id: 'sizeKb',
				common: {
					name: `${camera.name} snapshot size`,
					type: 'number',
					role: 'value',
					unit: 'KB',
					read: true,
					write: false,
					def: 0,
				},
			},
			{
				id: 'refresh',
				common: {
					name: `${camera.name} snapshot cache refresh`,
					type: 'boolean',
					role: 'button',
					read: true,
					write: true,
					def: false,
				},
			},
		];

		for (const state of states) {
			await this.setObjectNotExistsAsync(`${snapshotsId}.${state.id}`, {
				type: 'state',
				common: /** @type {ioBroker.StateCommon} */ (state.common),
				native: {},
			});
		}
	}

	/**
	 * Fetch snapshot/video counts and occupied space from MotionEye's media list API
	 * for one camera and write them to the `storage` sub-channel. This requires
	 * MotionEye to recursively scan and stat() every stored file — deliberately not
	 * called on every status poll (see storagePollIntervalSec / storage.refresh).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 */
	async refreshCameraStorage(camera) {
		const storageId = `${camera.channel}.${CAMERA_STORAGE_CHANNEL}`;

		try {
			const [pictures, movies] = await Promise.all([
				this.motionEyeApi.listPictures(camera.motionEyeId),
				this.motionEyeApi.listMovies(camera.motionEyeId),
			]);

			const pictureSummary = summarizeMediaList(pictures);
			const movieSummary = summarizeMediaList(movies);
			const usedSpaceMb = bytesToMb(pictureSummary.totalBytes + movieSummary.totalBytes);

			await this.setStateAsync(`${storageId}.snapshotCount`, pictureSummary.count, true);
			await this.setStateAsync(`${storageId}.videoCount`, movieSummary.count, true);
			await this.setStateAsync(`${storageId}.usedSpaceMb`, usedSpaceMb, true);
			await this.setStateAsync(`${storageId}.lastRefresh`, new Date().toISOString(), true);

			this.log.info(
				`Storage refreshed for ${camera.name}: ${pictureSummary.count} snapshot(s), ${movieSummary.count} video(s), ${usedSpaceMb} MB`,
			);
		} catch (error) {
			this.log.warn(`Storage refresh failed for ${camera.name}: ${error.message}`);
			await this.setStateAsync(
				`${camera.channel}.status`,
				`error: storage refresh failed: ${error.message}`,
				true,
			);
		}
	}

	/**
	 * Refresh storage stats for all running cameras that opted into the auto-refresh
	 * interval (storageAutoRefresh !== false, Storage config tab), sequentially
	 * (avoids hammering MotionEye with N concurrent recursive directory scans).
	 */
	async refreshAllCameraStorage() {
		for (const camera of this.camerasById.values()) {
			if (camera.storageAutoRefresh === false) {
				continue;
			}
			await this.refreshCameraStorage(camera);
		}
	}

	async migrateLegacyCameraChannels() {
		const cameras = resolveCameras(this.config.cameras, this.config.defaultMode || 'off');
		const legacyCameras = resolveLegacyCameras(this.config.cameras, this.config.defaultMode || 'off');

		for (const camera of cameras) {
			if (!camera.enabled) {
				continue;
			}

			const legacy = legacyCameras.find(
				entry => entry.motionEyeId === camera.motionEyeId && entry.id === camera.id,
			);
			if (!legacy || legacy.channel === camera.channel) {
				continue;
			}

			const legacyChannel = legacy.channel;
			const legacyFolder = await this.getObjectAsync(legacyChannel);
			if (!legacyFolder) {
				continue;
			}

			for (const stateId of CAMERA_STATE_IDS) {
				const legacyId = `${legacyChannel}.${stateId}`;
				const newId = `${camera.channel}.${stateId}`;
				const legacyState = await this.getStateAsync(legacyId);
				if (legacyState) {
					await this.setStateAsync(newId, legacyState.val, legacyState.ack);
				}
				if (await this.getObjectAsync(legacyId)) {
					await this.delObjectAsync(legacyId);
				}
			}

			await this.delObjectAsync(legacyChannel);
			this.log.info(`Migrated camera channel ${legacyChannel} → ${camera.channel}`);
		}
	}

	async initializeCameras() {
		this.syncCameraRegistry();

		if (!this.camerasById.size) {
			this.log.warn('No enabled cameras configured — add cameras on the Cameras tab');
		}

		await this.migrateLegacyCameraChannels();

		for (const camera of this.camerasById.values()) {
			await this.ensureCameraObjects(camera);
		}

		let connected = false;
		try {
			await this.motionEyeApi.getCameraList();
			connected = true;
		} catch (error) {
			this.log.warn(`MotionEye not reachable at startup: ${error.message}`);
			if (String(error.message).toLowerCase().includes('unauthorized')) {
				this.logVerboseUnauthorizedHints();
			}
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
	 * Re-push the currently known `overlay.*` datapoint values to MotionEye on every
	 * adapter start (mirrors `mode`) — this keeps MotionEye in sync after e.g. a
	 * MotionEye restart, and applies the Overlay config table `def` seed for brand-new
	 * cameras. It never reads the config table directly, so live datapoint changes
	 * made between adapter restarts are never overwritten by stale config values.
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @returns {Promise<Record<string, unknown>>}
	 */
	async buildOverlayStartupPatch(camera) {
		const overlayId = `${camera.channel}.${CAMERA_OVERLAY_CHANNEL}`;
		const [enabled, leftText, rightText, customLeftText, customRightText, textScale] = await Promise.all(
			['enabled', 'leftText', 'rightText', 'customLeftText', 'customRightText', 'textScale'].map(id =>
				this.getStateAsync(`${overlayId}.${id}`),
			),
		);

		/** @type {Record<string, unknown>} */
		const patch = {};
		Object.assign(patch, buildTextOverlayPatch(enabled?.val).patch);
		const leftBuilt = buildLeftTextPatch(leftText?.val);
		if (leftBuilt.patch) {
			Object.assign(patch, leftBuilt.patch);
		}
		const rightBuilt = buildRightTextPatch(rightText?.val);
		if (rightBuilt.patch) {
			Object.assign(patch, rightBuilt.patch);
		}
		Object.assign(patch, buildCustomLeftTextPatch(customLeftText?.val).patch);
		Object.assign(patch, buildCustomRightTextPatch(customRightText?.val).patch);
		const scaleBuilt = buildTextScalePatch(textScale?.val);
		if (scaleBuilt.patch) {
			Object.assign(patch, scaleBuilt.patch);
		}
		return patch;
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

		Object.assign(patch, await this.buildOverlayStartupPatch(camera));

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

	/**
	 * Update framerate / resolution states from a MotionEye UI config (read path).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {Record<string, unknown>} uiConfig
	 */
	async syncDeviceParams(camera, uiConfig) {
		const settingsId = `${camera.channel}.${CAMERA_SETTINGS_CHANNEL}`;

		const available = parseAvailableResolutions(uiConfig);
		this.availableResolutionsByChannel.set(camera.channel, available);
		await this.setStateAsync(`${settingsId}.availableResolutions`, available.join(', '), true);

		if (uiConfig.resolution != null) {
			const resolution = normalizeResolution(uiConfig.resolution);
			if (resolution) {
				await this.setStateAsync(`${settingsId}.resolution`, resolution, true);
			}
		}

		if (uiConfig.framerate != null) {
			const framerate = Number(uiConfig.framerate);
			if (Number.isFinite(framerate)) {
				await this.setStateAsync(`${settingsId}.framerate`, framerate, true);
			}
		}

		if (uiConfig.rotation != null) {
			const rotation = normalizeRotation(uiConfig.rotation);
			if (rotation != null) {
				await this.setStateAsync(`${settingsId}.rotation`, rotation, true);
			}
		}

		if (uiConfig.auto_brightness != null) {
			await this.setStateAsync(`${settingsId}.autoBrightness`, normalizeBoolean(uiConfig.auto_brightness), true);
		}

		await this.cachePrivacyMaskLines(camera, /** @type {unknown[]} */ (uiConfig.privacy_mask_lines));

		if (uiConfig.privacy_mask != null) {
			await this.setStateAsync(`${settingsId}.privacyMask`, normalizeBoolean(uiConfig.privacy_mask), true);
		}
	}

	/**
	 * Update text overlay states from a MotionEye UI config (read path).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {Record<string, unknown>} uiConfig
	 */
	async syncOverlayParams(camera, uiConfig) {
		const overlayId = `${camera.channel}.${CAMERA_OVERLAY_CHANNEL}`;

		if (uiConfig.text_overlay != null) {
			await this.setStateAsync(`${overlayId}.enabled`, normalizeBoolean(uiConfig.text_overlay), true);
		}

		if (uiConfig.left_text != null) {
			const leftText = normalizeTextPosition(uiConfig.left_text);
			if (leftText) {
				await this.setStateAsync(`${overlayId}.leftText`, leftText, true);
			}
		}

		if (uiConfig.right_text != null) {
			const rightText = normalizeTextPosition(uiConfig.right_text);
			if (rightText) {
				await this.setStateAsync(`${overlayId}.rightText`, rightText, true);
			}
		}

		if (uiConfig.custom_left_text != null) {
			await this.setStateAsync(`${overlayId}.customLeftText`, String(uiConfig.custom_left_text), true);
		}

		if (uiConfig.custom_right_text != null) {
			await this.setStateAsync(`${overlayId}.customRightText`, String(uiConfig.custom_right_text), true);
		}

		if (uiConfig.text_scale != null) {
			const textScale = normalizeTextScale(uiConfig.text_scale);
			if (textScale != null) {
				await this.setStateAsync(`${overlayId}.textScale`, textScale, true);
			}
		}
	}

	/**
	 * Update motion detection tuning states from a MotionEye UI config (read path).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {Record<string, unknown>} uiConfig
	 */
	async syncMotionDetectionParams(camera, uiConfig) {
		const motionDetectionId = `${camera.channel}.${CAMERA_MOTION_DETECTION_CHANNEL}`;

		if (uiConfig.frame_change_threshold != null) {
			const frameChangeThreshold = normalizeFrameChangeThreshold(uiConfig.frame_change_threshold);
			if (frameChangeThreshold != null) {
				await this.setStateAsync(`${motionDetectionId}.frameChangeThreshold`, frameChangeThreshold, true);
			}
		}

		if (uiConfig.auto_threshold_tuning != null) {
			await this.setStateAsync(
				`${motionDetectionId}.autoThresholdTuning`,
				normalizeBoolean(uiConfig.auto_threshold_tuning),
				true,
			);
		}

		if (uiConfig.auto_noise_detect != null) {
			await this.setStateAsync(
				`${motionDetectionId}.autoNoiseDetect`,
				normalizeBoolean(uiConfig.auto_noise_detect),
				true,
			);
		}

		if (uiConfig.noise_level != null) {
			const noiseLevel = normalizeNoiseLevel(uiConfig.noise_level);
			if (noiseLevel != null) {
				await this.setStateAsync(`${motionDetectionId}.noiseLevel`, noiseLevel, true);
			}
		}

		if (uiConfig.event_gap != null) {
			const eventGap = Number(uiConfig.event_gap);
			if (Number.isFinite(eventGap)) {
				await this.setStateAsync(`${motionDetectionId}.eventGap`, Math.round(eventGap), true);
			}
		}

		if (uiConfig.minimum_motion_frames != null) {
			const minimumMotionFrames = Number(uiConfig.minimum_motion_frames);
			if (Number.isFinite(minimumMotionFrames)) {
				await this.setStateAsync(
					`${motionDetectionId}.minimumMotionFrames`,
					Math.round(minimumMotionFrames),
					true,
				);
			}
		}

		if (uiConfig.light_switch_detect != null) {
			const lightSwitchDetect = Number(uiConfig.light_switch_detect);
			if (Number.isFinite(lightSwitchDetect)) {
				await this.setStateAsync(`${motionDetectionId}.lightSwitchDetect`, Math.round(lightSwitchDetect), true);
			}
		}

		if (uiConfig.despeckle_filter != null) {
			await this.setStateAsync(
				`${motionDetectionId}.despeckleFilter`,
				normalizeDespeckleFilter(uiConfig.despeckle_filter),
				true,
			);
		}

		if (uiConfig.pre_capture != null) {
			const preCapture = Number(uiConfig.pre_capture);
			if (Number.isFinite(preCapture)) {
				await this.setStateAsync(`${motionDetectionId}.preCapture`, Math.round(preCapture), true);
			}
		}

		if (uiConfig.post_capture != null) {
			const postCapture = Number(uiConfig.post_capture);
			if (Number.isFinite(postCapture)) {
				await this.setStateAsync(`${motionDetectionId}.postCapture`, Math.round(postCapture), true);
			}
		}
	}

	/**
	 * Write a camera device parameter to MotionEye (control path).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {'framerate'|'resolution'|'rotation'|'autoBrightness'|'privacyMask'} param
	 * @param {unknown} value
	 */
	async setDeviceParam(camera, param, value) {
		const channelId = camera.channel;
		const settingsId = `${channelId}.${CAMERA_SETTINGS_CHANNEL}`;

		if (!this.config.useMotionEyeConfig) {
			await this.setStateAsync(`${channelId}.status`, 'useMotionEyeConfig is disabled', true);
			return;
		}

		let built;
		switch (param) {
			case 'framerate':
				built = buildFrameratePatch(value, { min: FRAMERATE_MIN, max: FRAMERATE_MAX });
				break;
			case 'resolution':
				built = buildResolutionPatch(value, this.availableResolutionsByChannel.get(channelId) || []);
				break;
			case 'rotation':
				built = buildRotationPatch(value);
				break;
			case 'autoBrightness':
				built = buildAutoBrightnessPatch(value);
				break;
			case 'privacyMask':
				await this.setPrivacyMask(camera, value);
				return;
			default:
				return;
		}

		if (!built.patch) {
			this.log.warn(`${param} rejected for ${camera.name}: ${built.error}`);
			await this.setStateAsync(`${channelId}.status`, `error: ${built.error}`, true);
			return;
		}

		const result = await this.motionEyeApi.saveCameraConfig(camera.motionEyeId, built.patch);

		await this.setStateAsync(`${settingsId}.${param}`, built.value, true);
		await this.setStateAsync(`${channelId}.status`, `${param}=${built.value}`, true);

		if (result.changed) {
			await this.setStateAsync(`${channelId}.lastAction`, `config/set ${param}=${built.value}`, true);
			this.log.info(`${param} for ${camera.name}: ${built.value}`);
		}
	}

	/**
	 * Toggle the privacy mask. MotionEye rebuilds the mask file from
	 * `privacy_mask_lines` only while the mask is enabled and drops the regions
	 * when disabled, so we cache the regions and re-send them when enabling.
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {unknown} value
	 */
	async setPrivacyMask(camera, value) {
		const channelId = camera.channel;
		const settingsId = `${channelId}.${CAMERA_SETTINGS_CHANNEL}`;

		if (!this.config.useMotionEyeConfig) {
			await this.setStateAsync(`${channelId}.status`, 'useMotionEyeConfig is disabled', true);
			return;
		}

		const built = buildPrivacyMaskPatch(value);
		const enabled = built.value;

		// Capture the currently drawn regions before MotionEye drops them on disable.
		try {
			const uiConfig = await this.motionEyeApi.getCameraConfig(camera.motionEyeId);
			await this.cachePrivacyMaskLines(camera, /** @type {unknown[]} */ (uiConfig.privacy_mask_lines));
		} catch {
			// fall back to cached/persisted regions
		}

		/** @type {Record<string, unknown>} */
		const patch = { ...built.patch };

		if (enabled) {
			const lines = this.privacyMaskLinesByChannel.get(channelId) || [];
			if (lines.length) {
				patch.privacy_mask_lines = lines;
			} else {
				this.log.warn(
					`privacyMask enabled for ${camera.name} but no mask regions are known — draw the mask once in the MotionEye UI, then toggle again`,
				);
			}
		}

		const result = await this.motionEyeApi.saveCameraConfig(camera.motionEyeId, patch);

		await this.setStateAsync(`${settingsId}.privacyMask`, enabled, true);
		await this.setStateAsync(`${channelId}.status`, `privacyMask=${enabled}`, true);

		if (result.changed) {
			await this.setStateAsync(`${channelId}.lastAction`, `config/set privacyMask=${enabled}`, true);
			this.log.info(`privacyMask for ${camera.name}: ${enabled}`);
		}
	}

	/**
	 * Write a camera text overlay parameter to MotionEye (control path).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {'enabled'|'leftText'|'rightText'|'customLeftText'|'customRightText'|'textScale'} param
	 * @param {unknown} value
	 */
	async setOverlayParam(camera, param, value) {
		const channelId = camera.channel;
		const overlayId = `${channelId}.${CAMERA_OVERLAY_CHANNEL}`;

		if (!this.config.useMotionEyeConfig) {
			await this.setStateAsync(`${channelId}.status`, 'useMotionEyeConfig is disabled', true);
			return;
		}

		if (param === 'leftText' || param === 'customLeftText') {
			await this.setTextOverlaySide(camera, 'left', param, value);
			return;
		}
		if (param === 'rightText' || param === 'customRightText') {
			await this.setTextOverlaySide(camera, 'right', param, value);
			return;
		}

		let built;
		switch (param) {
			case 'enabled':
				built = buildTextOverlayPatch(value);
				break;
			case 'textScale':
				built = buildTextScalePatch(value);
				break;
			default:
				return;
		}

		if (!built.patch) {
			this.log.warn(`${param} rejected for ${camera.name}: ${built.error}`);
			await this.setStateAsync(`${channelId}.status`, `error: ${built.error}`, true);
			return;
		}

		const result = await this.motionEyeApi.saveCameraConfig(camera.motionEyeId, built.patch);

		await this.setStateAsync(`${overlayId}.${param}`, built.value, true);
		await this.setStateAsync(`${channelId}.status`, `${param}=${built.value}`, true);

		if (result.changed) {
			await this.setStateAsync(`${channelId}.lastAction`, `config/set ${param}=${built.value}`, true);
			this.log.info(`${param} for ${camera.name}: ${built.value}`);
		}
	}

	/**
	 * MotionEye only persists `custom_left_text`/`custom_right_text` while `left_text`/
	 * `right_text` already equals `custom-text` *at save time* — otherwise it's silently
	 * discarded. Saving the position and the custom text as two separate requests can
	 * therefore lose the custom text (whichever field is saved second overwrites the
	 * other with a stale value fetched before the first save applied). Always resolve
	 * and send both fields of a side together, in one request.
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {'left'|'right'} side
	 * @param {'leftText'|'customLeftText'|'rightText'|'customRightText'} param
	 * @param {unknown} value
	 */
	async setTextOverlaySide(camera, side, param, value) {
		const channelId = camera.channel;
		const overlayId = `${channelId}.${CAMERA_OVERLAY_CHANNEL}`;
		const positionId = side === 'left' ? 'leftText' : 'rightText';
		const customId = side === 'left' ? 'customLeftText' : 'customRightText';
		const defaultPosition = side === 'left' ? 'camera-name' : 'timestamp';

		const positionValue =
			param === positionId
				? value
				: ((await this.getStateAsync(`${overlayId}.${positionId}`))?.val ?? defaultPosition);
		const customValue =
			param === customId ? value : ((await this.getStateAsync(`${overlayId}.${customId}`))?.val ?? '');

		const positionBuilt = side === 'left' ? buildLeftTextPatch(positionValue) : buildRightTextPatch(positionValue);
		if (!positionBuilt.patch) {
			this.log.warn(`${positionId} rejected for ${camera.name}: ${positionBuilt.error}`);
			await this.setStateAsync(`${channelId}.status`, `error: ${positionBuilt.error}`, true);
			return;
		}

		const customBuilt =
			side === 'left' ? buildCustomLeftTextPatch(customValue) : buildCustomRightTextPatch(customValue);
		const patch = { ...positionBuilt.patch, ...customBuilt.patch };

		const result = await this.motionEyeApi.saveCameraConfig(camera.motionEyeId, patch);

		await this.setStateAsync(`${overlayId}.${positionId}`, positionBuilt.value, true);
		await this.setStateAsync(`${overlayId}.${customId}`, customBuilt.value, true);
		await this.setStateAsync(`${channelId}.status`, `${param}=${value}`, true);

		if (result.changed) {
			await this.setStateAsync(
				`${channelId}.lastAction`,
				`config/set ${positionId}=${positionBuilt.value}`,
				true,
			);
			this.log.info(
				`${positionId} for ${camera.name}: ${positionBuilt.value} (${customId}=${customBuilt.value})`,
			);
		}
	}

	/**
	 * Write a motion detection tuning parameter to MotionEye (control path).
	 *
	 * @param {import('./lib/cameraRegistry').ResolvedCamera} camera
	 * @param {(typeof MOTION_DETECTION_PARAMS)[number]} param
	 * @param {unknown} value
	 */
	async setMotionDetectionParam(camera, param, value) {
		const channelId = camera.channel;
		const motionDetectionId = `${channelId}.${CAMERA_MOTION_DETECTION_CHANNEL}`;

		if (!this.config.useMotionEyeConfig) {
			await this.setStateAsync(`${channelId}.status`, 'useMotionEyeConfig is disabled', true);
			return;
		}

		const built = buildMotionDetectionPatch(param, value);
		if (!built.patch) {
			this.log.warn(`${param} rejected for ${camera.name}: ${built.error}`);
			await this.setStateAsync(`${channelId}.status`, `error: ${built.error}`, true);
			return;
		}

		const result = await this.motionEyeApi.saveCameraConfig(camera.motionEyeId, built.patch);

		await this.setStateAsync(`${motionDetectionId}.${param}`, built.value, true);
		await this.setStateAsync(`${channelId}.status`, `${param}=${built.value}`, true);

		if (result.changed) {
			await this.setStateAsync(`${channelId}.lastAction`, `config/set ${param}=${built.value}`, true);
			this.log.info(`${param} for ${camera.name}: ${built.value}`);
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
			if (String(error.message).toLowerCase().includes('unauthorized')) {
				this.logVerboseUnauthorizedHints();
			}
			throw error;
		}

		this.verboseLog(
			`Poll OK: ${cameras.length} camera(s) in MotionEye, ${this.camerasById.size} enabled in ioBroker`,
		);

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
			await this.syncDeviceParams(camera, uiConfig);
			await this.syncOverlayParams(camera, uiConfig);
			await this.syncMotionDetectionParams(camera, uiConfig);

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
			this.verboseLog(`Motion webhook for camera "${camera.name}" (id=${cameraId})`);
			this.log.debug(`Motion webhook for ${camera.name}`);
			if (this.snapshotCache) {
				void this.snapshotCache.maybeRefreshOnMotion(camera);
			}
			if (this.telegramNotifications) {
				void this.telegramNotifications.onMotion(camera);
			}
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

		const resetMs = capTimerMs(this.config.motionResetMs, { min: 1000, default: 15000 });
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

		if (stateName === 'snapshot' && state.val === true) {
			try {
				await this.motionEyeApi.takeSnapshot(camera.motionEyeId);
				await this.setStateAsync(`${camera.channel}.lastAction`, 'action/snapshot: OK', true);
				if (this.snapshotCache) {
					const cacheEnabled = this.snapshotCache.isEnabledForCamera(camera);
					const needsTelegramSnapshot = this.telegramNotifications?.needsSnapshotRefresh(camera) ?? false;
					if (cacheEnabled || needsTelegramSnapshot) {
						void this.snapshotCache.scheduleAfterSnapshot(camera, {
							force: needsTelegramSnapshot && !cacheEnabled,
						});
					}
				}
			} catch (error) {
				this.log.error(`Snapshot failed for ${camera.name}: ${error.message}`);
				await this.setStateAsync(
					`${camera.channel}.lastAction`,
					`action/snapshot: error: ${error.message}`,
					true,
				);
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
			return;
		}

		if (stateName === `${CAMERA_STORAGE_CHANNEL}.refresh` && state.val === true) {
			await this.refreshCameraStorage(camera);
			await this.setStateAsync(`${camera.channel}.${CAMERA_STORAGE_CHANNEL}.refresh`, false, true);
			return;
		}

		if (stateName === `${CAMERA_SNAPSHOTS_CHANNEL}.refresh` && state.val === true) {
			if (this.snapshotCache) {
				const cacheEnabled = this.snapshotCache.isEnabledForCamera(camera);
				const needsTelegramSnapshot = this.telegramNotifications?.needsSnapshotRefresh(camera) ?? false;
				if (cacheEnabled || needsTelegramSnapshot) {
					await this.snapshotCache.refreshManual(camera, {
						force: needsTelegramSnapshot && !cacheEnabled,
					});
				}
			}
			await this.setStateAsync(`${camera.channel}.${CAMERA_SNAPSHOTS_CHANNEL}.refresh`, false, true);
			return;
		}

		const settingsPrefix = `${CAMERA_SETTINGS_CHANNEL}.`;
		if (stateName.startsWith(settingsPrefix)) {
			const param = stateName.slice(settingsPrefix.length);
			if (!DEVICE_PARAMS.includes(param)) {
				return;
			}
			try {
				await this.setDeviceParam(
					camera,
					/** @type {'framerate'|'resolution'|'rotation'|'autoBrightness'|'privacyMask'} */ (param),
					state.val,
				);
			} catch (error) {
				this.log.error(`set ${param} failed for ${camera.name}: ${error.message}`);
				await this.setStateAsync(`${camera.channel}.status`, `error: ${error.message}`, true);
			}
			return;
		}

		const overlayPrefix = `${CAMERA_OVERLAY_CHANNEL}.`;
		if (stateName.startsWith(overlayPrefix)) {
			const param = stateName.slice(overlayPrefix.length);
			if (!OVERLAY_PARAMS.includes(param)) {
				return;
			}
			try {
				await this.setOverlayParam(
					camera,
					/** @type {'enabled'|'leftText'|'rightText'|'customLeftText'|'customRightText'|'textScale'} */ (
						param
					),
					state.val,
				);
			} catch (error) {
				this.log.error(`set ${param} failed for ${camera.name}: ${error.message}`);
				await this.setStateAsync(`${camera.channel}.status`, `error: ${error.message}`, true);
			}
			return;
		}

		const motionDetectionPrefix = `${CAMERA_MOTION_DETECTION_CHANNEL}.`;
		if (stateName.startsWith(motionDetectionPrefix)) {
			const param = stateName.slice(motionDetectionPrefix.length);
			if (!MOTION_DETECTION_PARAMS.includes(param)) {
				return;
			}
			try {
				await this.setMotionDetectionParam(
					camera,
					/** @type {(typeof MOTION_DETECTION_PARAMS)[number]} */ (param),
					state.val,
				);
			} catch (error) {
				this.log.error(`set ${param} failed for ${camera.name}: ${error.message}`);
				await this.setStateAsync(`${camera.channel}.status`, `error: ${error.message}`, true);
			}
		}
	}

	/**
	 * @param {ioBroker.Message} obj
	 * @param {Record<string, unknown>} response
	 */
	replyToMessage(obj, response) {
		if (!obj?.callback || !obj.from || !obj.command) {
			return;
		}

		this.sendTo(obj.from, obj.command, response, obj.callback);
	}

	/**
	 * @param {ioBroker.Message} obj
	 */
	async onMessage(obj) {
		if (!obj || typeof obj.command !== 'string') {
			return;
		}

		if (obj.command === 'loadCameras') {
			await this.handleLoadCameras(obj);
		} else if (obj.command === 'testConnection') {
			await this.handleTestConnection(obj);
		} else if (obj.command === 'applyOverlayNow') {
			await this.handleApplyOverlayNow(obj);
		} else if (obj.command === 'refreshStorageNow') {
			await this.handleRefreshStorageNow(obj);
		} else if (obj.command === 'testTelegram') {
			await this.handleTestTelegram(obj);
		}
	}

	/**
	 * @param {ioBroker.Message} obj
	 */
	async handleTestConnection(obj) {
		const payload = parseLoadCamerasMessage(obj.message);

		const motionHost = String(payload.motionHost || this.config.motionHost || '').trim();
		const motionEyePort = Number(payload.motionEyePort ?? this.config.motionEyePort) || 8765;
		const motionEyeUser = String(payload.motionEyeUser ?? this.config.motionEyeUser ?? 'admin');
		const motionEyePassword = String(this.config.motionEyePassword ?? '');
		const requestTimeoutMs = Number(payload.requestTimeoutMs ?? this.config.requestTimeoutMs) || 45000;

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
				verboseLog: message => this.verboseLog(message),
			});

			const cameras = await api.getCameraList();
			const versions = await api.getServerVersions().catch(() => null);
			const motionEyeVersion = versions?.motionEyeVersion || api.getLastMotionEyeVersion() || '';

			this.log.info(
				`Test connection OK — ${cameras.length} camera(s) at ${motionHost}:${motionEyePort}${motionEyeVersion ? `, MotionEye ${motionEyeVersion}` : ''}`,
			);

			this.replyToMessage(obj, { result: 'success' });
		} catch (error) {
			const message = String(error.message || error);
			this.log.error(`testConnection failed: ${message}`);
			if (/unauthorized/i.test(message)) {
				this.logVerboseUnauthorizedHints();
				this.replyToMessage(obj, { result: 'unauthorized', error: message });
			} else {
				this.replyToMessage(obj, { error: message });
			}
		}
	}

	/**
	 * @param {ioBroker.Message} obj
	 */
	async handleLoadCameras(obj) {
		const payload = parseLoadCamerasMessage(obj.message);

		const motionHost = String(payload.motionHost || this.config.motionHost || '').trim();
		const motionEyePort = Number(payload.motionEyePort ?? this.config.motionEyePort) || 8765;
		const motionEyeUser = String(payload.motionEyeUser ?? this.config.motionEyeUser ?? 'admin');
		const motionEyePassword = String(this.config.motionEyePassword ?? '');
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
				verboseLog: message => this.verboseLog(message),
			});

			const motionEyeList = await api.getCameraList();
			const { cameras, added } = mergeMotionEyeCameras(existingCameras, motionEyeList, defaultMode);

			this.log.info(`Loaded ${motionEyeList.length} camera(s) from MotionEye, added ${added} new row(s)`);

			this.replyToMessage(obj, {
				native: { cameras },
				result: added > 0 ? 'added' : 'none',
			});
		} catch (error) {
			this.log.error(`loadCameras failed: ${error.message}`);
			this.replyToMessage(obj, { error: error.message });
		}
	}

	/**
	 * Applies the Overlay config table (button "Apply overlay settings now") to the
	 * matching running cameras. Only non-empty fields are applied — empty fields mean
	 * "leave unchanged" and are skipped, so this never overwrites a live datapoint with
	 * a blank value. Uses the current, possibly unsaved, admin form data (`payload.cameras`)
	 * so the instance does not need to be restarted first.
	 *
	 * @param {ioBroker.Message} obj
	 */
	async handleApplyOverlayNow(obj) {
		if (!this.motionEyeApi) {
			this.replyToMessage(obj, { error: 'Adapter instance is not running' });
			return;
		}

		const payload = parseLoadCamerasMessage(obj.message);
		const rows = Array.isArray(payload.cameras) ? payload.cameras : this.config.cameras || [];
		const resolvedRows = resolveCameras(rows, this.config.defaultMode || 'off');
		const runningCameras = [...this.camerasById.values()];

		let appliedCameras = 0;
		let appliedFields = 0;

		for (const row of resolvedRows) {
			const camera = runningCameras.find(entry => entry.motionEyeId === row.motionEyeId);
			if (!camera) {
				continue;
			}

			const overlay = row.overlayConfig;
			/** @type {[('enabled'|'leftText'|'rightText'|'customLeftText'|'customRightText'|'textScale'), unknown][]} */
			const fields = [
				[
					'enabled',
					overlay.enabled === 'true' || overlay.enabled === 'false' ? overlay.enabled === 'true' : null,
				],
				['leftText', overlay.leftText || null],
				['customLeftText', overlay.customLeftText || null],
				['rightText', overlay.rightText || null],
				['customRightText', overlay.customRightText || null],
				['textScale', overlay.textScale || null],
			];

			let changedForCamera = false;
			for (const [param, value] of fields) {
				if (value === null) {
					continue;
				}
				try {
					await this.setOverlayParam(camera, param, value);
					changedForCamera = true;
					appliedFields += 1;
				} catch (error) {
					this.log.error(`applyOverlayNow: set ${param} failed for ${camera.name}: ${error.message}`);
				}
			}

			if (changedForCamera) {
				appliedCameras += 1;
			}
		}

		this.log.info(`Applied Overlay config table to ${appliedCameras} camera(s), ${appliedFields} field(s)`);
		this.replyToMessage(obj, { result: appliedCameras > 0 ? 'applied' : 'none', appliedCameras, appliedFields });
	}

	/**
	 * Refreshes storage stats for every camera in the Storage config table that matches
	 * a currently running camera (button "Refresh storage stats now"). Unlike the
	 * automatic interval, this ignores each row's storageAutoRefresh flag — an explicit
	 * manual request always refreshes every matched camera.
	 *
	 * @param {ioBroker.Message} obj
	 */
	async handleRefreshStorageNow(obj) {
		if (!this.motionEyeApi) {
			this.replyToMessage(obj, { error: 'Adapter instance is not running' });
			return;
		}

		const payload = parseLoadCamerasMessage(obj.message);
		const rows = Array.isArray(payload.cameras) ? payload.cameras : this.config.cameras || [];
		const resolvedRows = resolveCameras(rows, this.config.defaultMode || 'off');
		const runningCameras = [...this.camerasById.values()];

		let refreshed = 0;
		for (const row of resolvedRows) {
			const camera = runningCameras.find(entry => entry.motionEyeId === row.motionEyeId);
			if (!camera) {
				continue;
			}
			await this.refreshCameraStorage(camera);
			refreshed += 1;
		}

		this.log.info(`refreshStorageNow: refreshed storage stats for ${refreshed} camera(s)`);
		this.replyToMessage(obj, { result: refreshed > 0 ? 'refreshed' : 'none', refreshed });
	}

	/**
	 * @param {ioBroker.Message} obj
	 */
	async handleTestTelegram(obj) {
		if (!this.telegramNotifications) {
			this.replyToMessage(obj, { error: 'Adapter instance is not running' });
			return;
		}

		const firstCamera = this.camerasById.values().next().value;
		const result = await this.telegramNotifications.sendTestNotification(firstCamera);
		if (!result.sent) {
			this.replyToMessage(obj, { result: result.reason || 'none' });
			return;
		}

		this.log.info('Telegram test notification sent');
		this.replyToMessage(obj, { result: 'sent' });
	}

	/**
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		this._unloading = true;

		try {
			if (this.pollInterval) {
				this.clearTimeout(this.pollInterval);
				this.pollInterval = undefined;
			}

			if (this.storagePollInterval) {
				this.clearTimeout(this.storagePollInterval);
				this.storagePollInterval = undefined;
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
