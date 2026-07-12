'use strict';

const { buildSnapshotStoragePath, isJpegBuffer } = require('./snapshotCache');

/** Telegram sendPhoto limit is 10 MB; use document above 9 MB. */
const TELEGRAM_PHOTO_MAX_BYTES = 9 * 1024 * 1024;

/**
 * @typedef {object} TelegramRecipient
 * @property {number} [instance]
 * @property {string} chatId
 * @property {string} [name]
 * @property {boolean} [enabled] When false, skip this recipient (default: enabled)
 */

/**
 * @typedef {object} CameraNotificationConfig
 * @property {boolean} onMotion
 * @property {boolean} onSnapshot
 * @property {string} preText
 * @property {boolean} sendImage
 * @property {string} postText
 * @property {boolean} includeTimestamp
 * @property {string[]} recipientFilter Empty = all enabled recipients; otherwise names or chat IDs (comma-separated in config)
 */

/**
 * @param {unknown} recipients
 * @returns {TelegramRecipient[]}
 */
function parseTelegramRecipients(recipients) {
	if (!Array.isArray(recipients)) {
		return [];
	}

	/** @type {TelegramRecipient[]} */
	const parsed = [];
	for (const entry of recipients) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const chatId = String(entry.chatId || '').trim();
		if (!chatId) {
			continue;
		}
		const instance = Number(entry.instance);
		parsed.push({
			instance: Number.isFinite(instance) && instance >= 0 ? Math.round(instance) : 0,
			chatId,
			name: String(entry.name || '').trim(),
			enabled: entry.enabled !== false,
		});
	}
	return parsed;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseNotificationRecipientFilter(value) {
	if (value == null || !String(value).trim()) {
		return [];
	}
	const trimmed = String(value).trim();
	if (/^(alle|all|tous|todo|todos|wszystko|все|全部|tutto|\(leer = alle\)|\(empty = all\))$/i.test(trimmed)) {
		return [];
	}
	return trimmed
		.split(/[,;]+/)
		.map(part => part.trim())
		.filter(Boolean);
}

/**
 * @param {unknown} value Select value: empty/true = yes, "false"/false = no
 * @param {boolean} [legacyExcluded] Legacy opt-out
 * @returns {boolean}
 */
function resolveNotificationTriState(value, legacyExcluded) {
	if (legacyExcluded === true) {
		return false;
	}
	if (value === 'false' || value === false) {
		return false;
	}
	return true;
}

/**
 * Per-camera Ja/Nein dropdown: empty = Ja, "false" = Nein.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function resolveNotificationTrigger(value) {
	if (value === 'false' || value === false) {
		return false;
	}
	return true;
}

/**
 * Legacy whole-camera opt-out (pre–1.1.0 checkbox). Per-column dropdowns override
 * the removed global master switch (`notificationEnabled` in old saved configs).
 *
 * @param {import('./cameraRegistry').NativeCameraConfig} [entry]
 * @returns {boolean}
 */
function isLegacyNotificationMasterOff(entry) {
	return entry?.notificationExcluded === true;
}

/**
 * @param {import('./cameraRegistry').NativeCameraConfig} [entry]
 * @returns {CameraNotificationConfig}
 */
function resolveCameraNotification(entry) {
	const legacyMasterOff = isLegacyNotificationMasterOff(entry);
	const onMotion = resolveNotificationTrigger(entry?.notificationOnMotion);
	const onSnapshot = resolveNotificationTrigger(entry?.notificationOnSnapshot);
	return {
		onMotion: legacyMasterOff ? false : onMotion,
		onSnapshot: legacyMasterOff ? false : onSnapshot,
		preText: String(entry?.notificationPreText || ''),
		sendImage: resolveNotificationTriState(entry?.notificationSendImage),
		postText: String(entry?.notificationPostText || ''),
		includeTimestamp: resolveNotificationTriState(entry?.notificationIncludeTimestamp),
		recipientFilter: parseNotificationRecipientFilter(entry?.notificationRecipients),
	};
}

/**
 * @param {TelegramRecipient[]} recipients
 * @param {string[]} filterTokens
 * @returns {TelegramRecipient[]}
 */
function filterRecipientsForCamera(recipients, filterTokens) {
	const enabled = recipients.filter(recipient => recipient.enabled !== false);
	if (!filterTokens.length) {
		return enabled;
	}

	return enabled.filter(recipient =>
		filterTokens.some(token => {
			if (recipient.chatId === token) {
				return true;
			}
			if (recipient.name && recipient.name.toLowerCase() === token.toLowerCase()) {
				return true;
			}
			return false;
		}),
	);
}

/**
 * @param {string|number|Date} [value] ISO string or Date — defaults to now
 * @returns {string} Local time `YYYY-MM-DD HH:mm:ss` (ioBroker host timezone)
 */
function formatNotificationTimestamp(value) {
	const date = value == null || value === '' ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return String(value ?? '');
	}
	const pad = part => String(part).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * @param {import('./cameraRegistry').ResolvedCamera} camera
 * @param {string} template
 * @param {string} [timestampIso]
 * @returns {string}
 */
function expandNotificationText(camera, template, timestampIso) {
	const timestamp = formatNotificationTimestamp(timestampIso);
	return String(template)
		.replace(/\{camera\}/gi, camera.name)
		.replace(/\{channel\}/gi, camera.channel)
		.replace(/\{timestamp\}/gi, timestamp)
		.replace(/\{time\}/gi, timestamp);
}

/**
 * @param {import('./cameraRegistry').ResolvedCamera} camera
 * @param {CameraNotificationConfig} config
 * @param {string} [timestampIso]
 * @returns {string}
 */
function buildPostMessage(camera, config, timestampIso) {
	const timestamp = formatNotificationTimestamp(timestampIso);
	let text = expandNotificationText(camera, config.postText, timestampIso).trim();
	if (!config.includeTimestamp) {
		return text;
	}
	if (!text) {
		return timestamp;
	}
	return text.endsWith(':') || text.endsWith(' ') ? `${text}${timestamp}` : `${text} ${timestamp}`;
}

/**
 * @param {CameraNotificationConfig} config
 * @param {string} [filePath]
 * @returns {boolean}
 */
function hasNotificationContent(config, filePath) {
	if (config.preText.trim()) {
		return true;
	}
	if (config.sendImage && filePath) {
		return true;
	}
	if (config.postText.trim() || config.includeTimestamp) {
		return true;
	}
	return false;
}

/**
 * @param {Buffer} buffer
 * @returns {'photo'|'document'}
 */
function telegramSnapshotMessageType(buffer) {
	return buffer.length > TELEGRAM_PHOTO_MAX_BYTES ? 'document' : 'photo';
}

/**
 * @param {number} value
 * @param {{ min?: number, max?: number, default?: number }} [limits]
 * @returns {number}
 */
function capNotificationIntervalSec(value, limits = {}) {
	const min = limits.min ?? 5;
	const max = limits.max ?? 3600;
	const fallback = limits.default ?? 30;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * @param {Record<string, unknown>} config
 * @returns {boolean}
 */
function isTelegramNotificationsEnabled(config) {
	return config.telegramNotificationsEnabled === true;
}

/**
 * @param {CameraNotificationConfig} notification
 * @returns {boolean}
 */
function needsSnapshotImageForNotification(notification) {
	return notification.onSnapshot && notification.sendImage;
}

/**
 * @typedef {object} TelegramNotificationManagerDeps
 * @property {() => Record<string, unknown>} getConfig
 * @property {(camera: import('./cameraRegistry').ResolvedCamera) => CameraNotificationConfig} getCameraNotification
 * @property {(instance: number, payload: Record<string, unknown>) => Promise<void>} sendToTelegram
 * @property {(camera: import('./cameraRegistry').ResolvedCamera) => Promise<{ filePath: string, lastUpdate: string }>} ensureSnapshot
 * @property {(relativePath: string) => Promise<Buffer|null>} readSnapshotFile
 * @property {(level: 'info' | 'warn' | 'error' | 'debug', message: string) => void} log
 * @property {(message: string) => void} verboseLog
 * @property {() => boolean} isUnloading
 */

/**
 * @param {TelegramNotificationManagerDeps} deps
 */
function createTelegramNotificationManager(deps) {
	/** @type {Map<string, number>} */
	const lastSentAt = new Map();

	/**
	 * @returns {TelegramRecipient[]}
	 */
	function getRecipients() {
		const config = deps.getConfig();
		if (config.telegramNotificationsEnabled !== true) {
			return [];
		}
		return parseTelegramRecipients(config.telegramRecipients);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {CameraNotificationConfig} notification
	 * @returns {TelegramRecipient[]}
	 */
	function getRecipientsForCamera(camera, notification) {
		return filterRecipientsForCamera(getRecipients(), notification.recipientFilter);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {'snapshot' | 'motion' | 'manual'} trigger
	 * @returns {boolean}
	 */
	function shouldSendForCamera(camera, trigger) {
		const notification = deps.getCameraNotification(camera);
		if (trigger === 'motion' && !notification.onMotion) {
			return false;
		}
		if ((trigger === 'snapshot' || trigger === 'manual') && !notification.onSnapshot) {
			return false;
		}
		return getRecipientsForCamera(camera, notification).length > 0;
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {boolean}
	 */
	function needsSnapshotRefresh(camera) {
		if (!isTelegramNotificationsEnabled(deps.getConfig())) {
			return false;
		}
		if (!shouldSendForCamera(camera, 'snapshot')) {
			return false;
		}
		return deps.getCameraNotification(camera).sendImage;
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {boolean}
	 */
	function allowSendNow(camera) {
		const minIntervalSec = capNotificationIntervalSec(deps.getConfig().telegramNotificationMinIntervalSec);
		const now = Date.now();
		const last = lastSentAt.get(camera.channel) || 0;
		if (now - last < minIntervalSec * 1000) {
			return false;
		}
		lastSentAt.set(camera.channel, now);
		return true;
	}

	/**
	 * @param {TelegramRecipient} recipient
	 * @param {Record<string, unknown>} payload
	 * @returns {Promise<void>}
	 */
	async function sendToRecipient(recipient, payload) {
		await deps.sendToTelegram(recipient.instance, {
			...payload,
			chatId: recipient.chatId,
		});
	}

	/**
	 * Read cached JPEG via adapter file storage and send as Telegram photo/document.
	 *
	 * @param {TelegramRecipient} recipient
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {string} [caption]
	 * @returns {Promise<boolean>} true when an image was sent
	 */
	async function sendSnapshotImageToRecipient(recipient, camera, caption) {
		const storagePath = buildSnapshotStoragePath(camera.channel);
		/** @type {Buffer|null} */
		let buffer = null;

		try {
			buffer = await deps.readSnapshotFile(storagePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.log('warn', `Telegram image read failed for ${camera.name} (${storagePath}): ${message}`);
			return false;
		}

		if (!Buffer.isBuffer(buffer) || !buffer.length) {
			deps.log('warn', `Telegram image skipped for ${camera.name}: empty snapshot (${storagePath})`);
			return false;
		}

		if (!isJpegBuffer(buffer)) {
			deps.log(
				'warn',
				`Telegram image skipped for ${camera.name}: not a JPEG (${buffer.length} bytes, ${storagePath})`,
			);
			return false;
		}

		const type = telegramSnapshotMessageType(buffer);
		/** @type {Record<string, unknown>} */
		const payload = { text: buffer, type };
		if (caption) {
			payload.caption = caption;
		}
		await sendToRecipient(recipient, payload);
		deps.log('info', `Telegram image sent for ${camera.name} (${buffer.length} bytes, ${type})`);
		return true;
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {CameraNotificationConfig} notification
	 * @param {string} filePath
	 * @param {string} lastUpdate
	 * @returns {Promise<void>}
	 */
	async function deliverNotification(camera, notification, filePath, lastUpdate) {
		const timestamp = lastUpdate || new Date().toISOString();
		const preText = expandNotificationText(camera, notification.preText, timestamp).trim();
		const postText = buildPostMessage(camera, notification, timestamp);

		if (!hasNotificationContent(notification, filePath)) {
			deps.log('debug', `Telegram notification skipped for ${camera.name}: no content configured`);
			return;
		}

		const recipients = getRecipientsForCamera(camera, notification);
		if (!recipients.length) {
			deps.log('debug', `Telegram notification skipped for ${camera.name}: no matching recipients`);
			return;
		}

		for (const recipient of recipients) {
			if (deps.isUnloading()) {
				return;
			}

			let imageSent = false;
			if (notification.sendImage) {
				imageSent = await sendSnapshotImageToRecipient(recipient, camera, preText || undefined);
				if (!imageSent && preText) {
					await sendToRecipient(recipient, { text: preText });
				}
			} else if (preText) {
				await sendToRecipient(recipient, { text: preText });
				deps.log(
					'info',
					`Telegram image not sent for ${camera.name}: Send image disabled in camera config (check Notifications tab)`,
				);
			}

			if (postText) {
				await sendToRecipient(recipient, { text: postText });
			}
		}

		deps.log(
			'info',
			`Telegram notification completed for ${camera.name} to ${recipients.length} recipient(s) (sendImage=${notification.sendImage})`,
		);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {CameraNotificationConfig} notification
	 * @param {string} filePath
	 * @param {string} lastUpdate
	 * @returns {Promise<void>}
	 */
	async function sendNotification(camera, notification, filePath, lastUpdate) {
		if (!allowSendNow(camera)) {
			return;
		}

		try {
			await deliverNotification(camera, notification, filePath, lastUpdate);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.log('warn', `Telegram notification failed for ${camera.name}: ${message}`);
		}
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {{ trigger: 'snapshot' | 'motion' | 'manual', filePath: string, lastUpdate: string }} meta
	 * @returns {Promise<void>}
	 */
	async function onSnapshotCached(camera, meta) {
		if (deps.isUnloading() || !shouldSendForCamera(camera, meta.trigger)) {
			return;
		}

		const notification = deps.getCameraNotification(camera);
		deps.log(
			'info',
			`Telegram snapshot hook for ${camera.name}: sendImage=${notification.sendImage}, onSnapshot=${notification.onSnapshot}, trigger=${meta.trigger}`,
		);
		await sendNotification(camera, notification, meta.filePath, meta.lastUpdate);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {Promise<void>}
	 */
	async function onMotion(camera) {
		if (deps.isUnloading() || !shouldSendForCamera(camera, 'motion')) {
			return;
		}

		const notification = deps.getCameraNotification(camera);
		/** @type {string} */
		let filePath = '';
		/** @type {string} */
		let lastUpdate = '';

		if (notification.sendImage) {
			try {
				const snapshot = await deps.ensureSnapshot(camera);
				filePath = snapshot.filePath;
				lastUpdate = snapshot.lastUpdate;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.log('warn', `Telegram notification failed for ${camera.name}: ${message}`);
				return;
			}
		}

		await sendNotification(camera, notification, filePath, lastUpdate);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} [camera]
	 * @returns {Promise<{ sent: boolean, reason?: string }>}
	 */
	async function sendTestNotification(camera) {
		const recipients = getRecipients().filter(recipient => recipient.enabled !== false);
		if (deps.getConfig().telegramNotificationsEnabled !== true) {
			return { sent: false, reason: 'disabled' };
		}
		if (!recipients.length) {
			return { sent: false, reason: 'no_recipients' };
		}

		const target = camera || null;
		const testText = target ? `MotionEye Telegram test (${target.name})` : 'MotionEye Telegram test';

		for (const recipient of recipients) {
			await sendToRecipient(recipient, { text: testText });
			if (target) {
				const notification = deps.getCameraNotification(target);
				if (notification.sendImage) {
					try {
						await deps.ensureSnapshot(target);
						await sendSnapshotImageToRecipient(recipient, target);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						deps.log('warn', `Telegram test image failed for ${target.name}: ${message}`);
					}
				}
			}
		}

		return { sent: true };
	}

	return {
		onMotion,
		onSnapshotCached,
		sendTestNotification,
		needsSnapshotRefresh,
		getRecipients,
		shouldSendForCamera,
		parseTelegramRecipients,
		resolveCameraNotification,
		expandNotificationText,
		buildPostMessage,
	};
}

module.exports = {
	parseTelegramRecipients,
	parseNotificationRecipientFilter,
	filterRecipientsForCamera,
	resolveNotificationTriState,
	resolveNotificationTrigger,
	isLegacyNotificationMasterOff,
	resolveCameraNotification,
	expandNotificationText,
	buildPostMessage,
	hasNotificationContent,
	telegramSnapshotMessageType,
	TELEGRAM_PHOTO_MAX_BYTES,
	capNotificationIntervalSec,
	isTelegramNotificationsEnabled,
	needsSnapshotImageForNotification,
	formatNotificationTimestamp,
	createTelegramNotificationManager,
};
