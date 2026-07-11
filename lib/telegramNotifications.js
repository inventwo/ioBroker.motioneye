'use strict';

/**
 * @typedef {object} TelegramRecipient
 * @property {number} [instance]
 * @property {string} chatId
 * @property {string} [name]
 */

/**
 * @typedef {object} CameraNotificationConfig
 * @property {boolean} enabled
 * @property {string} preText
 * @property {boolean} sendImage
 * @property {string} postText
 * @property {boolean} includeTimestamp
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
		});
	}
	return parsed;
}

/**
 * @param {import('./cameraRegistry').NativeCameraConfig} [entry]
 * @returns {CameraNotificationConfig}
 */
function resolveCameraNotification(entry) {
	return {
		enabled: entry?.notificationExcluded !== true,
		preText: String(entry?.notificationPreText || ''),
		sendImage: entry?.notificationSendImage !== false,
		postText: String(entry?.notificationPostText || ''),
		includeTimestamp: entry?.notificationIncludeTimestamp !== false,
	};
}

/**
 * @param {import('./cameraRegistry').ResolvedCamera} camera
 * @param {string} template
 * @param {string} [timestampIso]
 * @returns {string}
 */
function expandNotificationText(camera, template, timestampIso) {
	const timestamp = timestampIso || new Date().toISOString();
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
	const timestamp = timestampIso || new Date().toISOString();
	let text = expandNotificationText(camera, config.postText, timestamp).trim();
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
 * @typedef {object} TelegramNotificationManagerDeps
 * @property {() => Record<string, unknown>} getConfig
 * @property {(camera: import('./cameraRegistry').ResolvedCamera) => CameraNotificationConfig} getCameraNotification
 * @property {(instance: number, payload: Record<string, unknown>) => Promise<void>} sendToTelegram
 * @property {(camera: import('./cameraRegistry').ResolvedCamera) => Promise<{ filePath: string, lastUpdate: string }>} ensureSnapshot
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
	 * @returns {boolean}
	 */
	function shouldSendForCamera(camera) {
		const notification = deps.getCameraNotification(camera);
		if (!notification.enabled) {
			return false;
		}
		return getRecipients().length > 0;
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

		for (const recipient of getRecipients()) {
			if (deps.isUnloading()) {
				return;
			}
			if (preText) {
				await sendToRecipient(recipient, { text: preText });
			}
			if (notification.sendImage && filePath) {
				await sendToRecipient(recipient, { text: filePath });
			}
			if (postText) {
				await sendToRecipient(recipient, { text: postText });
			}
		}

		deps.verboseLog(`Telegram notification sent for "${camera.name}" to ${getRecipients().length} recipient(s)`);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @returns {Promise<void>}
	 */
	async function onMotion(camera) {
		if (deps.isUnloading() || !shouldSendForCamera(camera) || !allowSendNow(camera)) {
			return;
		}

		const notification = deps.getCameraNotification(camera);
		/** @type {string} */
		let filePath = '';
		/** @type {string} */
		let lastUpdate = '';

		try {
			if (notification.sendImage) {
				const snapshot = await deps.ensureSnapshot(camera);
				filePath = snapshot.filePath;
				lastUpdate = snapshot.lastUpdate;
			}
			await deliverNotification(camera, notification, filePath, lastUpdate);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.log('warn', `Telegram notification failed for ${camera.name}: ${message}`);
		}
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} [camera]
	 * @returns {Promise<{ sent: boolean, reason?: string }>}
	 */
	async function sendTestNotification(camera) {
		const recipients = getRecipients();
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
						const snapshot = await deps.ensureSnapshot(target);
						if (snapshot.filePath) {
							await sendToRecipient(recipient, { text: snapshot.filePath });
						}
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
		sendTestNotification,
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
	resolveCameraNotification,
	expandNotificationText,
	buildPostMessage,
	hasNotificationContent,
	capNotificationIntervalSec,
	createTelegramNotificationManager,
};
