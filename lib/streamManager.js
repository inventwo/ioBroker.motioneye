'use strict';

const http = require('node:http');

const STREAM_HTML_STYLE = 'width:100%; height:100%; object-fit:contain; display:block;';
const STREAM_LOADING_HTML = '<p style="margin:0;padding:2em;text-align:center;color:#aaa;">Stream starting…</p>';
const STREAM_PAUSED_HTML = '';
const STREAM_ERROR_HTML =
	'<p style="margin:0;padding:2em;text-align:center;color:#f88;">Stream not reachable<br>' +
	'<span style="color:#aaa;font-size:0.9em;">MotionEye port offline or VIS blocks HTTP images (HTTPS?)</span></p>';

/**
 * @param {number} motionEyeId
 * @param {Record<string, unknown>} [uiConfig]
 * @returns {number}
 */
function resolveStreamPort(motionEyeId, uiConfig) {
	if (uiConfig && uiConfig.streaming_port != null) {
		return Number(uiConfig.streaming_port);
	}
	return 9080 + motionEyeId;
}

/**
 * @param {string} motionHost
 * @param {number} motionEyeId
 * @param {Record<string, unknown>} [uiConfig]
 * @param {number} [cacheBust]
 * @returns {string}
 */
function buildStreamSrc(motionHost, motionEyeId, uiConfig, cacheBust) {
	const streamPort = resolveStreamPort(motionEyeId, uiConfig);
	const bust = cacheBust ? `?t=${cacheBust}` : '';
	return `http://${motionHost}:${streamPort}/${bust}`;
}

/**
 * @param {string} motionHost
 * @param {number} motionEyeId
 * @param {Record<string, unknown>} [uiConfig]
 * @param {number} [cacheBust]
 * @returns {string}
 */
function buildStreamHtml(motionHost, motionEyeId, uiConfig, cacheBust) {
	const src = buildStreamSrc(motionHost, motionEyeId, uiConfig, cacheBust);
	const streamPort = resolveStreamPort(motionEyeId, uiConfig);
	const baseSrc = `http://${motionHost}:${streamPort}/`;
	const reconnect = `this.onerror=null;this.src='${baseSrc}?t='+Date.now()`;

	return (
		`<div style="width:100%;height:100%;overflow:hidden;background:#000;">` +
		`<img src="${src}" style="${STREAM_HTML_STYLE}" alt="" onerror="${reconnect}">` +
		`</div>`
	);
}

/**
 * @param {string} motionHost
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function checkStreamPort(motionHost, port) {
	return new Promise(resolve => {
		const req = http.request(
			{
				hostname: motionHost,
				port,
				path: '/',
				method: 'GET',
				timeout: 4000,
			},
			res => {
				req.destroy();
				resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400);
			},
		);

		req.on('timeout', () => {
			req.destroy();
			resolve(false);
		});
		req.on('error', () => resolve(false));
		req.end();
	});
}

/**
 * @typedef {object} StreamManagerDeps
 * @property {string} motionHost
 * @property {ReturnType<import('./motionEyeApi')['createMotionEyeApi']>} motionEyeApi
 * @property {boolean} useMotionEyeConfig
 * @property {boolean} disableStreamOnStart
 * @property {number} streamAutoOffMs
 * @property {number} streamStartDelayMs
 * @property {number} streamReadyTimeoutMs
 * @property {number} streamRetryMs
 * @property {number} streamSiblingRelinkTimeoutMs
 * @property {(channelId: string) => Promise<ioBroker.State | null | undefined>} getState
 * @property {(id: string, val: ioBroker.StateValue, ack?: boolean) => Promise<unknown>} setState
 * @property {(level: string, message: string) => void} log
 * @property {(fn: () => void, ms: number) => unknown} setTimeoutFn
 * @property {(id: unknown) => void} clearTimeoutFn
 * @property {(ms: number) => Promise<void>} delayFn
 * @property {() => Map<string, import('./cameraRegistry').ResolvedCamera>} getCamerasByChannel
 * @property {() => boolean} isUnloading
 */

/**
 * @param {StreamManagerDeps} deps
 */
function createStreamManager(deps) {
	/** @type {Record<string, unknown>} */
	const timers = {};
	/** @type {Record<string, number>} */
	const relinkRunIds = {};

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	function channelId(camera) {
		return camera.channel;
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	async function isStreamEnabled(camera) {
		const state = await deps.getState(`${channelId(camera)}.stream`);
		return !!(state && state.val);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {string} html
	 */
	async function setStreamUrl(camera, html) {
		await deps.setState(`${channelId(camera)}.streamUrl`, html, true);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	async function setStreamLoadingHtml(camera) {
		await setStreamUrl(camera, STREAM_LOADING_HTML);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	async function setStreamPausedHtml(camera) {
		await setStreamUrl(camera, STREAM_PAUSED_HTML);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 * @param {boolean} enabled
	 * @param {number} [cacheBust]
	 * @param {Record<string, unknown>} [uiConfig]
	 * @param {boolean} [force]
	 */
	async function updateStreamHtml(camera, enabled, cacheBust, uiConfig, force = false) {
		const html = enabled
			? buildStreamHtml(deps.motionHost, camera.motionEyeId, uiConfig, cacheBust)
			: STREAM_PAUSED_HTML;
		const current = await deps.getState(`${channelId(camera)}.streamUrl`);
		if (!force && current && current.val === html) {
			return;
		}
		await setStreamUrl(camera, html);
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	function clearStreamHtmlTimer(camera) {
		const key = `${channelId(camera)}.streamHtml`;
		if (timers[key]) {
			deps.clearTimeoutFn(timers[key]);
			delete timers[key];
		}
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	function clearStreamAutoOffTimer(camera) {
		const key = `${channelId(camera)}.streamAutoOff`;
		if (timers[key]) {
			deps.clearTimeoutFn(timers[key]);
			delete timers[key];
		}
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	async function getStreamUiConfig(camera) {
		const uiConfig = await deps.motionEyeApi.getCameraConfig(camera.motionEyeId);
		return {
			streaming_port: resolveStreamPort(camera.motionEyeId, uiConfig),
		};
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	async function publishStreamHtmlWhenReady(camera) {
		const started = Date.now();
		await deps.delayFn(deps.streamStartDelayMs);

		while (Date.now() - started < deps.streamReadyTimeoutMs) {
			if (deps.isUnloading() || !(await isStreamEnabled(camera))) {
				return;
			}

			let uiConfig;
			try {
				uiConfig = await getStreamUiConfig(camera);
			} catch (error) {
				deps.log('debug', `Stream port query ${camera.name}: ${error.message}`);
				await deps.delayFn(deps.streamRetryMs);
				continue;
			}

			const port = Number(uiConfig.streaming_port);
			const ready = await checkStreamPort(deps.motionHost, port);
			if (ready) {
				await updateStreamHtml(camera, true, Date.now(), uiConfig);
				deps.log('info', `Stream HTML set for ${camera.name} (port ${port})`);
				return;
			}

			await setStreamLoadingHtml(camera);
			await deps.delayFn(deps.streamRetryMs);
		}

		if (await isStreamEnabled(camera)) {
			await setStreamUrl(camera, STREAM_ERROR_HTML);
			deps.log('warn', `Stream for ${camera.name} not reachable after ${deps.streamReadyTimeoutMs} ms`);
		}
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} camera
	 */
	function scheduleStreamHtml(camera) {
		clearStreamHtmlTimer(camera);
		publishStreamHtmlWhenReady(camera).catch(error => {
			deps.log('warn', `Stream HTML error for ${camera.name}: ${error.message}`);
		});
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} changedCamera
	 */
	function getActiveSiblingCameras(changedCamera) {
		const siblings = [];
		for (const cam of deps.getCamerasByChannel().values()) {
			if (cam.channel === changedCamera.channel) {
				continue;
			}
			siblings.push(cam);
		}
		return siblings;
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} changedCamera
	 */
	async function publishSiblingStreamRelink(changedCamera) {
		const siblings = [];
		for (const cam of getActiveSiblingCameras(changedCamera)) {
			if (await isStreamEnabled(cam)) {
				siblings.push(cam);
			}
		}
		if (!siblings.length) {
			return;
		}

		const runId = Date.now();
		const runKey = `${channelId(changedCamera)}.siblingRelinkRun`;
		relinkRunIds[runKey] = runId;

		const started = Date.now();
		/** @type {Record<string, boolean>} */
		const relinked = {};

		await deps.delayFn(deps.streamStartDelayMs);

		while (Date.now() - started < deps.streamSiblingRelinkTimeoutMs) {
			if (deps.isUnloading() || relinkRunIds[runKey] !== runId) {
				return;
			}

			for (const cam of siblings) {
				if (!(await isStreamEnabled(cam))) {
					continue;
				}

				try {
					const uiConfig = await getStreamUiConfig(cam);
					const port = Number(uiConfig.streaming_port);
					if (!(await checkStreamPort(deps.motionHost, port))) {
						continue;
					}
					await updateStreamHtml(cam, true, Date.now(), uiConfig, true);
					if (!relinked[cam.channel]) {
						deps.log('info', `Stream re-linked for ${cam.name}`);
						relinked[cam.channel] = true;
					}
				} catch (error) {
					deps.log('warn', `Stream re-link ${cam.name}: ${error.message}`);
				}
			}

			let allDone = true;
			for (const cam of siblings) {
				if ((await isStreamEnabled(cam)) && !relinked[cam.channel]) {
					allDone = false;
					break;
				}
			}
			if (allDone) {
				return;
			}

			await deps.delayFn(deps.streamRetryMs);
		}
	}

	/**
	 * @param {import('./cameraRegistry').ResolvedCamera} changedCamera
	 */
	function scheduleSiblingStreamRelink(changedCamera) {
		if (!deps.streamSiblingRelinkTimeoutMs) {
			return;
		}
		delete relinkRunIds[`${channelId(changedCamera)}.siblingRelinkRun`];
		publishSiblingStreamRelink(changedCamera).catch(error => {
			deps.log('warn', `Stream sibling re-link error: ${error.message}`);
		});
	}

	function scheduleStreamOff(setStreamFn) {
		return (/** @type {import('./cameraRegistry').ResolvedCamera} */ camera) => {
			if (!deps.streamAutoOffMs) {
				return;
			}
			clearStreamAutoOffTimer(camera);
			const key = `${channelId(camera)}.streamAutoOff`;
			timers[key] = deps.setTimeoutFn(() => {
				delete timers[key];
				setStreamFn(camera, false).catch(error => {
					deps.log('warn', `Stream auto-off for ${camera.name}: ${error.message}`);
				});
			}, deps.streamAutoOffMs);
		};
	}

	const api = {
		/**
		 * @param {import('./cameraRegistry').ResolvedCamera} camera
		 * @param {boolean} enabled
		 * @param {boolean} [fromPoll]
		 * @param {boolean} [autoOff]
		 */
		async setStream(camera, enabled, fromPoll = false, autoOff = false) {
			if (!deps.useMotionEyeConfig) {
				if (!fromPoll) {
					await deps.setState(`${channelId(camera)}.stream`, !!enabled, true);
				}
				deps.log('warn', `Stream control for ${camera.name} requires useMotionEyeConfig=true`);
				return;
			}

			if (!enabled) {
				clearStreamHtmlTimer(camera);
			}

			const result = await deps.motionEyeApi.saveCameraConfig(camera.motionEyeId, {
				video_streaming: !!enabled,
			});
			await deps.setState(`${channelId(camera)}.lastAction`, `config/set video_streaming=${!!enabled}`, true);

			if (result.changed) {
				deps.log('info', `Video stream for ${camera.name}: ${enabled ? 'on' : 'off'}`);
			}

			if (enabled) {
				if (result.changed) {
					await setStreamLoadingHtml(camera);
					scheduleStreamHtml(camera);
				} else {
					try {
						const uiConfig = await getStreamUiConfig(camera);
						await updateStreamHtml(camera, true, Date.now(), uiConfig);
					} catch {
						await setStreamLoadingHtml(camera);
						scheduleStreamHtml(camera);
					}
				}
				if (autoOff) {
					scheduleStreamOff(api.setStream)(camera);
				} else {
					clearStreamAutoOffTimer(camera);
				}
			} else {
				clearStreamAutoOffTimer(camera);
				await setStreamPausedHtml(camera);
			}

			if (!fromPoll) {
				await deps.setState(`${channelId(camera)}.stream`, !!enabled, true);
				scheduleSiblingStreamRelink(camera);
			}
		},

		/**
		 * @param {import('./cameraRegistry').ResolvedCamera} camera
		 */
		async pulseStream(camera) {
			await api.setStream(camera, true, false, true);
		},

		/**
		 * @param {import('./cameraRegistry').ResolvedCamera} camera
		 */
		async applyStreamOnStart(camera) {
			if (!deps.useMotionEyeConfig) {
				await setStreamPausedHtml(camera);
				return;
			}

			let uiConfig;
			try {
				uiConfig = await deps.motionEyeApi.getCameraConfig(camera.motionEyeId);
			} catch {
				await setStreamPausedHtml(camera);
				return;
			}

			if (deps.disableStreamOnStart && uiConfig.video_streaming) {
				await api.setStream(camera, false);
				return;
			}

			const streaming = !!uiConfig.video_streaming;
			await deps.setState(`${channelId(camera)}.stream`, streaming, true);
			if (streaming) {
				try {
					await updateStreamHtml(camera, true, Date.now(), {
						streaming_port: uiConfig.streaming_port || 9080 + camera.motionEyeId,
					});
				} catch {
					scheduleStreamHtml(camera);
				}
			} else {
				await setStreamPausedHtml(camera);
			}
		},

		destroy() {
			for (const key of Object.keys(timers)) {
				deps.clearTimeoutFn(timers[key]);
				delete timers[key];
			}
			for (const key of Object.keys(relinkRunIds)) {
				delete relinkRunIds[key];
			}
		},
	};

	return api;
}

module.exports = {
	STREAM_LOADING_HTML,
	STREAM_PAUSED_HTML,
	buildStreamSrc,
	buildStreamHtml,
	checkStreamPort,
	createStreamManager,
};
