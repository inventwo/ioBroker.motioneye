/**
 * ioBroker JavaScript – MotionEye Anbindung
 *
 * Steuert Bewegungserkennung über die MotionEye-Konfigurations-API (Port 8765),
 * damit der Schalter in der Web-Oberfläche mitgeht. Ein Admin-Passwort ist
 * nicht zwingend – leeres Passwort in MotionEye ist erlaubt.
 * Modi pro Kamera (Datenpunkt .mode):
 *   off   – Aus: keine Erkennung, kein Trigger, keine Aufnahmen
 *   still – Still: Trigger (.motion), aber keine Videoaufnahmen
 *   sharp – Scharf: Trigger (.motion) und Videoaufnahmen bei Bewegung
 *
 * Voraussetzung motion.conf:
 *   webcontrol_localhost off
 *   webcontrol_port 7999
 *
 * Bewegungs-Trigger Richtung ioBroker (Webhook in MotionEye):
 *   siehe Datenpunkt <Kamera>.webhookUrl
 *
 *   .stream = an/aus (nur diese Kamera; streamUrl wird beim AUS nicht geleert)
 *   .streamPulse = kurz an, schaltet nach streamAutoOffMs wieder aus
 *   .streamUrl = HTML fürs inventwo-Widget
 */

const config = {
    scriptVersion: '2026-06-20o',
    motionHost: '192.168.130.240',
    motionPort: 7999,
    motionEyePort: 8765,
    motionEyeUser: 'admin',
    motionEyePassword: '', // Klartext-Passwort wie beim MotionEye-Login (admin)
    ioBrokerHost: '192.168.130.130',
    ioBrokerSimpleApiPort: 8087,
    useMotionEyeConfig: true, // false = nur Motion-API (7999), UI-Schalter bleibt unverändert
    applyMediaSettingsOnStart: true, // Snapshot-Grundprofil beim Script-Start setzen
    disableStreamOnStart: true, // Videostream beim Script-Start in MotionEye ausschalten
    streamAutoOffMs: 120000, // Nur für .streamPulse: Stream nach 2 Min. wieder aus (0 = nie)
    streamStartDelayMs: 3000, // Erste Prüfung nach Stream-Start (Motion-Neustart dauert oft 5–15 s)
    streamReadyTimeoutMs: 45000, // Max. Wartezeit bis MJPEG-Port antwortet
    streamRetryMs: 2000, // Abstand zwischen Port-Prüfungen
    streamHtmlStyle: 'width:100%; height:100%; object-fit:contain; display:block;',
    streamLoadingHtml: '<p style="margin:0;padding:2em;text-align:center;color:#aaa;">Stream startet…</p>',
    streamPausedHtml: '', // leer = kein <img>, inventwo zeigt nur eigenes Pausiert-Icon
    streamSiblingRelinkTimeoutMs: 60000, // andere Streams nach VIS-Neuaufbau wieder verbinden (bis Port antwortet)
    streamErrorHtml: '<p style="margin:0;padding:2em;text-align:center;color:#f88;">Stream nicht erreichbar<br><span style="color:#aaa;font-size:0.9em;">MotionEye-Port noch offline oder VIS blockiert HTTP-Bilder (HTTPS?)</span></p>',
    defaultMode: 'off',
    mediaSettings: {
        still_images: true,
        capture_mode: 'manual',
        manual_snapshots: true,
    },
    modeProfiles: {
        off: {
            motion_detection: false,
            movies: false,
            web_hook_notifications_enabled: false,
        },
        still: {
            motion_detection: true,
            movies: false,
            web_hook_notifications_enabled: true,
            web_hook_notifications_http_method: 'GET',
        },
        sharp: {
            motion_detection: true,
            movies: true,
            recording_mode: 'motion-triggered',
            web_hook_notifications_enabled: true,
            web_hook_notifications_http_method: 'GET',
        },
    },
    basePath: '0_userdata.0.MotionEye',
    motionResetMs: 15000,
    requestTimeout: 45000, // Motion-Neustart nach config/set kann >12 s dauern
    cameras: [
        { name: 'Auffahrt', id: 1 },
        { name: 'Carport', id: 2 },
        { name: 'Innenhof', id: 3 },
        { name: 'Innenhof II', id: 4 },
        { name: 'Koiteich', id: 5 },
        { name: 'Garten', id: 6 },
        { name: 'inventwo', id: 7 },
        { name: 'Laptop', id: 8 },
        { name: 'Bambu', id: 9 },
    ],
};

const http = require('http');
const crypto = require('crypto');
const timers = {};

const OBSOLETE_STATE_SUFFIXES = [
    'armed',
    'record',
    'streamSrc',
    'streamEmbedUrl',
    'showInView',
];

function removeStateIfExists(stateId) {
    if (!existsState(stateId)) {
        return false;
    }

    deleteState(stateId);
    return true;
}

async function cleanupObsoleteStates(camera) {
    for (const suffix of OBSOLETE_STATE_SUFFIXES) {
        const stateId = `${camera.base}.${suffix}`;
        if (removeStateIfExists(stateId)) {
            log(`Alter Datenpunkt entfernt: ${stateId}`, 'info');
        }
    }
}

const SIGNATURE_REGEX = /[^a-zA-Z0-9/?_.=&{}\[\]":, -]/g;

function safe(name) {
    return String(name).trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_äöüÄÖÜß-]/g, '_');
}

function buildWebhookUrl(camera) {
    return `http://${config.ioBrokerHost}:${config.ioBrokerSimpleApiPort}/set/${camera.base}.motion?value=true`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStreamUiConfig(camera) {
    const uiConfig = await getCameraConfig(camera.id);
    return {
        streaming_port: uiConfig.streaming_port || (9080 + camera.id),
    };
}

function checkStreamPort(port) {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: config.motionHost,
            port,
            path: '/',
            method: 'GET',
            timeout: 4000,
        }, (res) => {
            req.destroy();
            resolve(res.statusCode >= 200 && res.statusCode < 400);
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

function buildStreamSrc(camera, uiConfig, enabled, cacheBust) {
    if (!enabled) {
        return '';
    }

    const streamPort = uiConfig && uiConfig.streaming_port
        ? Number(uiConfig.streaming_port)
        : 9080 + camera.id;
    const bust = cacheBust ? `?t=${cacheBust}` : '';

    return `http://${config.motionHost}:${streamPort}/${bust}`;
}

function buildStreamHtml(camera, uiConfig, cacheBust) {
    const src = buildStreamSrc(camera, uiConfig, true, cacheBust);
    if (!src) {
        return '';
    }

    const streamPort = uiConfig && uiConfig.streaming_port
        ? Number(uiConfig.streaming_port)
        : 9080 + camera.id;
    const baseSrc = `http://${config.motionHost}:${streamPort}/`;
    const reconnect = `this.onerror=null;this.src='${baseSrc}?t='+Date.now()`;

    return `<div style="width:100%;height:100%;overflow:hidden;background:#000;">`
        + `<img src="${src}" style="${config.streamHtmlStyle}" alt="" onerror="${reconnect}">`
        + `</div>`;
}

async function updateStreamHtml(camera, enabled, cacheBust, uiConfig, force) {
    const html = enabled
        ? buildStreamHtml(camera, uiConfig || { streaming_port: 9080 + camera.id }, cacheBust)
        : config.streamPausedHtml;
    const stateId = `${camera.base}.streamUrl`;
    const current = getState(stateId);
    if (!force && current && current.val === html) {
        return;
    }
    await setStateAsync(stateId, html, true);
}

async function setStreamPausedHtml(camera) {
    await updateStreamHtml(camera, false);
}

async function setStreamLoadingHtml(camera) {
    await setText(camera, '.streamUrl', config.streamLoadingHtml);
}

function clearStreamHtmlTimer(camera) {
    const timerId = `${camera.base}.streamHtml`;
    if (timers[timerId]) {
        clearTimeout(timers[timerId]);
        delete timers[timerId];
    }
}

function isStreamEnabled(camera) {
    const state = getState(`${camera.base}.stream`);
    return !!(state && state.val);
}

async function publishStreamHtmlWhenReady(camera) {
    const started = Date.now();

    await sleep(config.streamStartDelayMs);

    while (Date.now() - started < config.streamReadyTimeoutMs) {
        if (!isStreamEnabled(camera)) {
            return;
        }

        let uiConfig;
        try {
            uiConfig = await getStreamUiConfig(camera);
        } catch (error) {
            log(`Stream-Port-Abfrage ${camera.name}: ${error.message}`, 'debug');
            await sleep(config.streamRetryMs);
            continue;
        }

        const port = Number(uiConfig.streaming_port);
        const ready = await checkStreamPort(port);
        if (ready) {
            await updateStreamHtml(camera, true, Date.now(), uiConfig);
            log(`Stream-HTML für ${camera.name} gesetzt (Port ${port})`, 'info');
            return;
        }

        await setStreamLoadingHtml(camera);
        await sleep(config.streamRetryMs);
    }

    if (isStreamEnabled(camera)) {
        await setText(camera, '.streamUrl', config.streamErrorHtml);
        log(`Stream für ${camera.name} nach ${config.streamReadyTimeoutMs}ms nicht erreichbar`, 'warn');
    }
}

function scheduleStreamHtml(camera) {
    clearStreamHtmlTimer(camera);
    publishStreamHtmlWhenReady(camera).catch((error) => {
        log(`Stream-HTML Fehler bei ${camera.name}: ${error.message}`, 'warn');
    });
}

function cancelSiblingStreamRelink(changedCamera) {
    delete timers[`${changedCamera.base}.siblingRelinkRun`];
}

function getActiveSiblingCameras(changedCamera) {
    return config.cameras.filter((cam) => {
        if (cam.base === changedCamera.base) {
            return false;
        }
        return isStreamEnabled(cam);
    });
}

async function publishSiblingStreamRelink(changedCamera) {
    const siblings = getActiveSiblingCameras(changedCamera);
    if (!siblings.length) {
        return;
    }

    const runId = Date.now();
    timers[`${changedCamera.base}.siblingRelinkRun`] = runId;
    const started = Date.now();
    const relinked = {};

    await sleep(config.streamStartDelayMs);

    while (Date.now() - started < config.streamSiblingRelinkTimeoutMs) {
        if (timers[`${changedCamera.base}.siblingRelinkRun`] !== runId) {
            return;
        }

        for (const cam of siblings) {
            if (!isStreamEnabled(cam)) {
                continue;
            }

            try {
                const uiConfig = await getStreamUiConfig(cam);
                const port = Number(uiConfig.streaming_port);
                const ready = await checkStreamPort(port);
                if (!ready) {
                    continue;
                }

                await updateStreamHtml(cam, true, Date.now(), uiConfig, true);
                if (!relinked[cam.base]) {
                    log(`Stream für ${cam.name} neu verbunden`, 'info');
                    relinked[cam.base] = true;
                }
            } catch (error) {
                log(`Stream-Neuaufbau ${cam.name}: ${error.message}`, 'warn');
            }
        }

        if (siblings.every((cam) => relinked[cam.base] || !isStreamEnabled(cam))) {
            return;
        }

        await sleep(config.streamRetryMs);
    }

    for (const cam of siblings) {
        if (isStreamEnabled(cam) && !relinked[cam.base]) {
            log(`Stream-Neuaufbau für ${cam.name} nach ${config.streamSiblingRelinkTimeoutMs}ms fehlgeschlagen`, 'warn');
        }
    }
}

function scheduleSiblingStreamRelink(changedCamera) {
    if (!config.streamSiblingRelinkTimeoutMs) {
        return;
    }

    cancelSiblingStreamRelink(changedCamera);
    publishSiblingStreamRelink(changedCamera).catch((error) => {
        log(`Stream-Neuaufbau Fehler: ${error.message}`, 'warn');
    });
}

const MODE_ALIASES = {
    off: 'off',
    aus: 'off',
    '0': 'off',
    false: 'off',
    still: 'still',
    ruhig: 'still',
    trigger: 'still',
    sharp: 'sharp',
    scharf: 'sharp',
    armed: 'sharp',
    '1': 'sharp',
    true: 'sharp',
};

const MODE_LABELS = {
    off: 'Aus',
    still: 'Still',
    sharp: 'Scharf',
};

function normalizeMode(value) {
    const key = String(value == null ? '' : value).trim().toLowerCase();
    return MODE_ALIASES[key] || null;
}

function inferModeFromConfig(uiConfig) {
    if (!uiConfig.motion_detection) {
        return 'off';
    }
    if (uiConfig.movies) {
        return 'sharp';
    }
    return 'still';
}

function buildModePatch(camera, mode) {
    const patch = { ...config.modeProfiles[mode] };
    if (mode === 'still' || mode === 'sharp') {
        patch.web_hook_notifications_url = buildWebhookUrl(camera);
    }
    return patch;
}

function quoteParam(value) {
    return encodeURIComponent(value).replace(/[!'()*~]/g, (c) => c);
}

function computeSignature(method, requestPath, body, password) {
    const qIndex = requestPath.indexOf('?');
    const pathname = qIndex >= 0 ? requestPath.slice(0, qIndex) : requestPath;
    const queryString = qIndex >= 0 ? requestPath.slice(qIndex + 1) : '';
    const params = [];

    if (queryString) {
        for (const part of queryString.split('&')) {
            if (!part) {
                continue;
            }
            const eq = part.indexOf('=');
            const name = eq >= 0 ? decodeURIComponent(part.slice(0, eq)) : decodeURIComponent(part);
            const value = eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : '';
            if (name !== '_signature') {
                params.push([name, value]);
            }
        }
    }

    params.sort((a, b) => a[0].localeCompare(b[0]));
    const query = params.map(([name, value]) => `${name}=${quoteParam(value)}`).join('&');
    let path = pathname + (query ? `?${query}` : '');
    path = path.replace(SIGNATURE_REGEX, '-');

    const key = String(password).replace(SIGNATURE_REGEX, '-');
    let bodyStr = body || '';
    if (bodyStr.startsWith('---')) {
        bodyStr = '';
    } else if (bodyStr) {
        bodyStr = bodyStr.replace(SIGNATURE_REGEX, '-');
    }

    const signing = `${method}:${path}:${bodyStr}:${key}`;
    return crypto.createHash('sha1').update(signing, 'utf8').digest('hex').toLowerCase();
}

function httpRequest(port, path, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: config.motionHost,
            port,
            path,
            method,
            timeout: config.requestTimeout,
            headers: { ...headers },
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
        }

        const req = http.request(options, (res) => {
            let responseBody = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { responseBody += chunk; });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    body: responseBody.trim(),
                });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Timeout nach ${config.requestTimeout} ms: ${path}`));
        });
        req.on('error', reject);

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

function motionCall(path, method = 'GET') {
    return httpRequest(config.motionPort, path, method).then((result) => {
        if (result.status >= 400) {
            throw new Error(`Motion HTTP ${result.status}: ${result.body || path}`);
        }
        return result;
    });
}

function motionEyeSignKey(password) {
    if (!password) {
        return '';
    }

    return crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toLowerCase();
}

function motionEyeAuthPath(path, method, body) {
    const username = config.motionEyeUser || 'admin';
    const signKey = motionEyeSignKey(config.motionEyePassword || '');
    const joiner = path.includes('?') ? '&' : '?';
    const unsignedPath = `${path}${joiner}_username=${quoteParam(username)}`;
    const signature = computeSignature(method, unsignedPath, body || '', signKey);
    return `${unsignedPath}&_signature=${signature}`;
}

function motionEyeCall(path, method = 'GET', bodyObj = null) {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const authPath = motionEyeAuthPath(path, method, body);

    return httpRequest(config.motionEyePort, authPath, method, body).then((result) => {
        let data = null;
        if (result.body) {
            try {
                data = JSON.parse(result.body);
            } catch (e) {
                data = result.body;
            }
        }

        if (result.status >= 400 || (data && data.error)) {
            const message = (data && data.error) || result.body || `HTTP ${result.status}`;
            throw new Error(message);
        }

        return { status: result.status, data, body: result.body };
    });
}

async function getCameraList() {
    const result = await motionEyeCall('/config/list', 'GET');
    if (!result.data || !result.data.cameras) {
        throw new Error('config/list: keine Kameras gefunden');
    }

    return result.data.cameras;
}

async function getCameraConfig(cameraId) {
    const cameras = await getCameraList();
    const camera = cameras.find((entry) => entry.id === cameraId);
    if (!camera) {
        throw new Error(`Kamera-ID ${cameraId} nicht in MotionEye gefunden`);
    }
    return camera;
}

async function saveCameraConfig(cameraId, patch) {
    const uiConfig = await getCameraConfig(cameraId);
    let changed = false;

    for (const [key, value] of Object.entries(patch)) {
        if (uiConfig[key] !== value) {
            uiConfig[key] = value;
            changed = true;
        }
    }

    if (!changed) {
        return { changed: false, data: null };
    }

    const result = await motionEyeCall(`/config/${cameraId}/set/`, 'POST', uiConfig);
    return { changed: true, data: result.data };
}

async function applyInitialConfig(camera) {
    const uiConfig = await getCameraConfig(camera.id);

    if (!config.useMotionEyeConfig) {
        await updateStreamHtml(camera, !!uiConfig.video_streaming);
        return;
    }

    const patch = {};

    if (config.applyMediaSettingsOnStart) {
        Object.assign(patch, config.mediaSettings);
    }

    const modeState = getState(`${camera.base}.mode`);
    const mode = normalizeMode(modeState && modeState.val) || config.defaultMode;
    Object.assign(patch, buildModePatch(camera, mode));

    if (config.disableStreamOnStart) {
        patch.video_streaming = false;
    }

    const result = await saveCameraConfig(camera.id, patch);
    await setText(camera, '.status', `Modus=${MODE_LABELS[mode]}`);
    await setStateAsync(`${camera.base}.mode`, mode, true);
    await setStateAsync(`${camera.base}.stream`, !!patch.video_streaming, true);
    await updateStreamHtml(camera, !!patch.video_streaming);

    if (result.changed) {
        await setText(camera, '.lastAction', 'config/set initial');
        log(`Start-Konfiguration für ${camera.name} gesetzt`, 'info');
        if (result.data && result.data.restart) {
            log(`Motion startet neu (${camera.name}) – Kamera kurz offline, ca. 5–15 s`, 'info');
        }
    }
}

async function applyMediaSettings(camera) {
    if (!config.useMotionEyeConfig || !config.applyMediaSettingsOnStart) {
        return;
    }

    const result = await saveCameraConfig(camera.id, config.mediaSettings);
    if (!result.changed) {
        log(`Medien-Einstellungen für ${camera.name} bereits korrekt`, 'debug');
        return;
    }

    await setText(camera, '.lastAction', 'config/set media profile');
    log(`Snapshot-Grundprofil für ${camera.name} gesetzt`, 'info');

    if (result.data && result.data.restart) {
        log(`MotionEye startet Motion für ${camera.name} neu …`, 'info');
    }
}

async function setMode(camera, mode, fromPoll = false) {
    const normalized = normalizeMode(mode);
    if (!normalized || !config.modeProfiles[normalized]) {
        throw new Error(`Unbekannter Modus: ${mode}`);
    }

    if (!config.useMotionEyeConfig) {
        const action = normalized === 'off' ? 'pause' : 'start';
        const result = await motionCall(`/${camera.id}/detection/${action}`);
        await setText(camera, '.status', result.body);
        await setText(camera, '.lastAction', `detection/${action} (Modus ${normalized}, ohne UI-Sync)`);
        if (!fromPoll) {
            await setStateAsync(`${camera.base}.mode`, normalized, true);
        }
        return;
    }

    const result = await saveCameraConfig(camera.id, buildModePatch(camera, normalized));
    await setText(camera, '.status', `Modus=${MODE_LABELS[normalized]}`);

    if (result.changed) {
        await setText(camera, '.lastAction', `config/set mode=${normalized}`);
        log(`Modus für ${camera.name}: ${MODE_LABELS[normalized]}`, 'info');
        if (result.data && result.data.restart) {
            log(`Motion startet neu (${camera.name}) – Kamera kurz offline, ca. 5–15 s`, 'info');
        }
    }

    if (!fromPoll) {
        await setStateAsync(`${camera.base}.mode`, normalized, true);
    }
}

async function applyModeFromState(camera) {
    const state = getState(`${camera.base}.mode`);
    const mode = normalizeMode(state && state.val) || config.defaultMode;
    await setMode(camera, mode);
}

function clearStreamTimer(camera) {
    const timerId = `${camera.base}.stream`;
    if (timers[timerId]) {
        clearTimeout(timers[timerId]);
        delete timers[timerId];
    }
}

function scheduleStreamOff(camera) {
    if (!config.streamAutoOffMs) {
        return;
    }

    clearStreamTimer(camera);
    timers[`${camera.base}.stream`] = setTimeout(async () => {
        try {
            await setStream(camera, false);
            log(`Stream für ${camera.name} automatisch ausgeschaltet`, 'info');
        } catch (error) {
            log(`Stream Auto-Off Fehler bei ${camera.name}: ${error.message}`, 'warn');
        }
    }, config.streamAutoOffMs);
}

async function setStream(camera, enabled, fromPoll = false, autoOff = false) {
    if (!config.useMotionEyeConfig) {
        if (!fromPoll) {
            await setStateAsync(`${camera.base}.stream`, !!enabled, true);
        }
        log(`Stream-Steuerung für ${camera.name} benötigt useMotionEyeConfig=true`, 'warn');
        return;
    }

    if (!enabled) {
        clearStreamHtmlTimer(camera);
    }

    const result = await saveCameraConfig(camera.id, { video_streaming: !!enabled });
    await setText(camera, '.lastAction', `config/set video_streaming=${!!enabled}`);

    if (result.changed) {
        log(`Videostream für ${camera.name}: ${enabled ? 'an' : 'aus'}`, 'info');
        if (result.data && result.data.restart) {
            log(`Motion startet neu (${camera.name}) – Kamera kurz offline, ca. 5–15 s`, 'info');
        }
    }

    if (enabled) {
        if (result.changed) {
            await setStreamLoadingHtml(camera);
            scheduleStreamHtml(camera);
        } else {
            try {
                const uiConfig = await getStreamUiConfig(camera);
                await updateStreamHtml(camera, true, Date.now(), uiConfig);
            } catch (error) {
                await setStreamLoadingHtml(camera);
                scheduleStreamHtml(camera);
            }
        }
        if (autoOff) {
            scheduleStreamOff(camera);
        } else {
            clearStreamTimer(camera);
        }
    } else {
        clearStreamTimer(camera);
        await setStreamPausedHtml(camera);
    }

    if (!fromPoll) {
        await setStateAsync(`${camera.base}.stream`, !!enabled, true);
        scheduleSiblingStreamRelink(camera);
    }
}

async function pulseStream(camera) {
    await setStream(camera, true, false, true);
}

async function applyStreamOnStart(camera) {
    const uiConfig = await getCameraConfig(camera.id);

    if (config.disableStreamOnStart && uiConfig.video_streaming) {
        await setStream(camera, false);
        return;
    }

    await setStateAsync(`${camera.base}.stream`, !!uiConfig.video_streaming, true);
    if (uiConfig.video_streaming) {
        try {
            await updateStreamHtml(
                camera,
                true,
                Date.now(),
                { streaming_port: uiConfig.streaming_port || (9080 + camera.id) },
            );
        } catch (error) {
            scheduleStreamHtml(camera);
        }
    } else {
        await setStreamPausedHtml(camera);
    }
}

async function ensureStates() {
    for (const camera of config.cameras) {
        camera.key = safe(camera.name);
        camera.base = `${config.basePath}.${camera.key}`;

        await cleanupObsoleteStates(camera);

        await createStateAsync(`${camera.base}.motion`, false, {
            name: `${camera.name} Bewegung erkannt`,
            type: 'boolean',
            role: 'sensor.motion',
            read: true,
            write: true,
            def: false,
        });
        await createStateAsync(`${camera.base}.mode`, config.defaultMode, {
            name: `${camera.name} Modus`,
            type: 'string',
            role: 'level.mode',
            read: true,
            write: true,
            def: config.defaultMode,
            states: {
                off: 'Aus',
                still: 'Still (nur Trigger)',
                sharp: 'Scharf (Trigger + Video)',
            },
        });
        await createStateAsync(`${camera.base}.snapshot`, false, {
            name: `${camera.name} Snapshot auslösen`,
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            def: false,
        });
        await createStateAsync(`${camera.base}.status`, '', {
            name: `${camera.name} Status`,
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: '',
        });
        await createStateAsync(`${camera.base}.lastAction`, '', {
            name: `${camera.name} letzte Aktion`,
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: '',
        });
        await createStateAsync(`${camera.base}.webhookUrl`, '', {
            name: `${camera.name} Webhook-URL`,
            type: 'string',
            role: 'url',
            read: true,
            write: false,
            def: '',
        });
        await createStateAsync(`${camera.base}.stream`, false, {
            name: `${camera.name} Videostream`,
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            def: false,
        });
        await createStateAsync(`${camera.base}.streamPulse`, false, {
            name: `${camera.name} Stream kurz aktivieren`,
            type: 'boolean',
            role: 'button',
            read: true,
            write: true,
            def: false,
        });
        await createStateAsync(`${camera.base}.streamUrl`, '', {
            name: `${camera.name} inventwo HTML (komplett)`,
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            def: '',
        });
        await setText(camera, '.webhookUrl', buildWebhookUrl(camera));
        await setStreamPausedHtml(camera);
    }
}

async function setText(camera, suffix, text) {
    await setStateAsync(`${camera.base}${suffix}`, text, true);
}

async function takeSnapshot(camera) {
    const result = await motionCall(`/${camera.id}/action/snapshot`);
    await setText(camera, '.lastAction', `action/snapshot: ${result.body}`);
}

async function pollStatus(camera) {
    try {
        if (config.useMotionEyeConfig) {
            const uiConfig = await getCameraConfig(camera.id);
            const mode = inferModeFromConfig(uiConfig);
            await setText(camera, '.status', `Modus=${MODE_LABELS[mode]}`);
            await setStateAsync(`${camera.base}.mode`, mode, true);
            await setStateAsync(`${camera.base}.stream`, !!uiConfig.video_streaming, true);
            return;
        }

        const result = await motionCall(`/${camera.id}/detection/status`);
        const mode = /active/i.test(result.body) ? 'still' : 'off';
        await setText(camera, '.status', result.body);
        await setStateAsync(`${camera.base}.mode`, mode, true);
    } catch (error) {
        await setText(camera, '.status', `error: ${error.message}`);
        log(`MotionEye Statusfehler bei ${camera.name}: ${error.message}`, 'warn');
    }
}

function resetMotion(camera) {
    const stateId = `${camera.base}.motion`;
    if (timers[stateId]) {
        clearTimeout(timers[stateId]);
    }
    timers[stateId] = setTimeout(() => {
        setState(stateId, false, true);
        delete timers[stateId];
    }, config.motionResetMs);
}

function registerHandlers(camera) {
    on({ id: `${camera.base}.mode`, change: 'ne' }, async (obj) => {
        if (obj.state.ack) {
            return;
        }
        const mode = normalizeMode(obj.state.val);
        if (!mode) {
            log(`Ungültiger Modus bei ${camera.name}: ${obj.state.val}`, 'warn');
            await pollStatus(camera);
            return;
        }
        try {
            await setMode(camera, mode);
        } catch (error) {
            log(`MotionEye Modus-Fehler bei ${camera.name}: ${error.message}`, 'error');
            await pollStatus(camera);
        }
    });

    on({ id: `${camera.base}.snapshot`, change: 'ne' }, async (obj) => {
        if (obj.state.ack || obj.state.val !== true) {
            return;
        }
        try {
            await takeSnapshot(camera);
        } catch (error) {
            log(`MotionEye snapshot Fehler bei ${camera.name}: ${error.message}`, 'error');
        }
        await setStateAsync(`${camera.base}.snapshot`, false, true);
    });

    on({ id: `${camera.base}.stream`, change: 'ne' }, async (obj) => {
        if (obj.state.ack) {
            return;
        }
        try {
            await setStream(camera, !!obj.state.val);
        } catch (error) {
            log(`Stream Fehler bei ${camera.name}: ${error.message}`, 'error');
            await pollStatus(camera);
        }
    });

    on({ id: `${camera.base}.streamPulse`, change: 'ne' }, async (obj) => {
        if (obj.state.ack || obj.state.val !== true) {
            return;
        }
        try {
            await pulseStream(camera);
        } catch (error) {
            log(`Stream-Pulse Fehler bei ${camera.name}: ${error.message}`, 'error');
        }
        await setStateAsync(`${camera.base}.streamPulse`, false, true);
    });

    on({ id: `${camera.base}.motion`, change: 'ne' }, async (obj) => {
        if (obj.state.ack || obj.state.val !== true) {
            return;
        }
        resetMotion(camera);
        await setStateAsync(`${camera.base}.motion`, true, true);
        await setText(camera, '.lastAction', 'motion webhook');
    });
}

async function init() {
    try {
        await ensureStates();

        for (const camera of config.cameras) {
            registerHandlers(camera);
            await applyInitialConfig(camera);
            await pollStatus(camera);
        }

        schedule('*/5 * * * *', async () => {
            for (const camera of config.cameras) {
                await pollStatus(camera);
            }
        });

        log(`MotionEye ioBroker Script gestartet (${config.scriptVersion})`, 'info');
    } catch (error) {
        const hint = String(error.message).toLowerCase().includes('unauthorized')
            ? ' — Admin-Benutzer/Passwort in MotionEye und motionEyePassword im Script prüfen'
            : '';
        log(`MotionEye Script Startfehler: ${error.message}${hint}`, 'error');
    }
}

init();
