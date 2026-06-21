# ioBroker Adapter „MotionEye“ – Planungsdokument

> **Stand:** 2026-06-19  
> **Ausgangslage:** Funktionierender Prototyp in [`test.js`](../test.js) (JavaScript-Adapter + VIS2/inventwo)  
> **Ziel dieses Dokuments:** Recherche & Strukturplan für einen echten ioBroker-Adapter — **noch keine Implementierung**  
> **Stil-Vorlagen (Adapter Creator, sauber):** [enpal](https://github.com/inventwo/ioBroker.enpal), [tidy](https://github.com/inventwo/ioBroker.tidy), [foxesscloud](https://github.com/inventwo/ioBroker.foxesscloud)  
> **Nicht als Vorlage:** [life360ng](https://github.com/inventwo/ioBroker.life360ng) — Fork-Umbau eines alten Adapters, kann Legacy-Muster enthalten
> **Fortsetzung:** Neuer Chat mit Verweis auf diese Datei

---

## 1. Zielbild

Ein ioBroker-Adapter `ioBroker.motioneye`, mit dem der Nutzer **nur Kameras im Adapter anlegt** (Anzeigename, MotionEye-Zuordnung) — der Rest läuft automatisch:

| Bereich | Adapter übernimmt |
|---|---|
| Datenpunkte | Anlegen, Rollen, Beschriftung |
| MotionEye-API | Modus, Stream, Snapshot, Webhook-URL in MotionEye setzen |
| Webhook | Bewegung → `.motion` (ohne simple-api-Pflicht) |
| Stream-HTML | `streamUrl` für inventwo/VIS-Widgets inkl. Neuverbindung |
| Sync | Periodischer Abgleich MotionEye ↔ ioBroker |
| Namen | **Frei wählbar in ioBroker**, unabhängig vom MotionEye-Kameranamen |

**Nicht im Scope (v1):** Ton in Aufnahmen, MotionEye-Kameras anlegen/löschen, Medienbrowser-UI, Ersatz für MotionEye-Web-UI.

---

## 2. Ist-Analyse: Prototyp `test.js` (v2026-06-20o)

### 2.1 Funktionen (bewährt in Produktion)

- **Modi** über MotionEye Config-API (8765): `off` / `still` / `sharp`
- **UI-Sync** mit MotionEye-Schaltern (`motion_detection`, `movies`, Webhook)
- **Snapshot** über Motion-API (7999)
- **Livestream** ein/aus (`video_streaming`), MJPEG-Ports 908x
- **`streamUrl`** — fertiges HTML (`<img src="http://host:908x/?t=…">`) für inventwo-Widgets
- **Sibling-Relink** — andere aktive Streams nach VIS-Neuaufbau automatisch neu verbinden
- **Webhook** → `simple-api` → `.motion` (15 s Auto-Reset)
- **Status-Polling** alle 5 Min. (`/config/list`)
- **Obsolete States** beim Start entfernen (`armed`, `record`, `streamSrc`, …)

### 2.2 APIs & Protokolle

| API | Port | Zweck |
|---|---|---|
| MotionEye Config | 8765 | `GET /config/list`, `POST /config/{id}/set/` mit Signatur-Auth |
| Motion HTTP | 7999 | `/{id}/action/snapshot`, optional `detection/status` |
| MJPEG Stream | 9080+id | Livebild (kein MotionEye-Login nötig wenn Auth aus) |

**Auth MotionEye 0.43.x:** `_username` + `_signature` (SHA1 über Pfad/Body/Passwort-Hash) — Implementierung in `test.js` → `lib/motionEyeApi.js` portieren.

### 2.3 Bekannte Stolpersteine (in Adapter berücksichtigen)

| Thema | Erkenntnis |
|---|---|
| Motion-Neustart | Nach `config/set` 5–15 s offline → Stream-HTML verzögert + Port-Polling |
| VIS-Neuaufbau | Änderung eines `streamUrl` kann andere Widgets kurz schwarz machen → Sibling-Relink |
| Filmformat | `mp4:h264_omx` scheitert oft → bei `sharp` **`mp4` ohne OMX** setzen |
| Kein Ton | Motion/MotionEye — kein natives Audio, kein versteckter Schalter |
| `.thumb`-Dateien | MotionEye-seitig, nicht abschaltbar — optional Hinweis/Doku |
| Passwörter | Nur in Adapter-Instanz (`native`), nie im Repo |

### 2.4 Externe Abhängigkeiten heute

- **simple-api** (Web-Adapter) für Webhooks — im Adapter **ersetzbar** durch eigenen HTTP-Endpunkt
- **JavaScript-Adapter** für Logik — entfällt mit eigenem Adapter
- Kein offizieller **ioBroker.motioneye**-Adapter bekannt (Forum: Webhook + Script ist üblich)

---

## 3. Warum ein eigener Adapter?

| JavaScript-Script | ioBroker-Adapter |
|---|---|
| Code manuell in ioBroker kopieren | Installation/Update über npm/GitHub |
| `0_userdata.0.MotionEye.*` manuell | Strukturierte Objekte unter `motioneye.0.*` |
| simple-api für Webhooks nötig | Eigener Webhook-Listener möglich |
| Keine Admin-UI für Kameras | Tabellarische Kamera-Verwaltung |
| Kein offizielles Channel/Device-Modell | VIS/material automatisch nutzbar |

---

## 4. Adapter-Struktur (inventwo-Konvention)

### 4.1 Technischer Stack

```
npx @iobroker/create-adapter
```

| Option | Empfehlung (wie enpal / tidy / foxesscloud) |
|---|---|
| Sprache | **Plain JavaScript** in `main.js` — kein TS-Build-Schritt |
| Typen | JSDoc + `lib/adapter-config.d.ts`; lokaler Check: `npm run check` |
| Runtime | `@iobroker/adapter-core` ^3.3, **Node ≥ 22** |
| Admin-UI | **jsonConfig** (`admin/jsonConfig.json`), kein React-Tab in v1 |
| dev-server | ja (`npm run dev-server:start`) |
| Release | `@alcalzone/release-script` 5.2.x + `.releaseconfig.json` |
| Cursor | `.cursor/iobroker-adapter.mdc` + `.cursor/rules/` |

> **Abweichung vom create-adapter-Default:** TypeScript-`src/` weglassen — alle inventwo-Adapter nutzen `main.js` + `lib/*.js` (siehe [tidy/main.test.js](https://github.com/inventwo/ioBroker.tidy/blob/main/main.test.js) als Muster für testbare Logik in `main.js`).

### 4.2 Verzeichnisstruktur

```
iobroker.motioneye/
├── .cursor/
│   ├── iobroker-adapter.mdc       # Projekt-Kontext, Git, Changelog (alwaysApply)
│   └── rules/
│       ├── admin-ui.mdc
│       ├── code-quality.mdc
│       ├── docs-release.mdc
│       ├── testing.mdc
│       └── motioneye-patterns.mdc # Signatur, Stream, Webhook
├── .github/workflows/
│   ├── test-and-release.yml       # ioBroker/testing-action-*
│   └── automerge-dependabot.yml
├── admin/
│   ├── motioneye.png / motioneye-logo.png
│   ├── jsonConfig.json            # Instanz + Kamera-Tabelle
│   ├── adapter-config.d.ts
│   └── i18n/                      # de/en (+ optional weitere)
├── lib/
│   ├── adapter-config.d.ts
│   ├── motionEyeApi.js            # Auth, list, get, set (aus test.js)
│   ├── motionApi.js               # Snapshot, detection/status
│   ├── modeProfiles.js            # off/still/sharp Patches
│   ├── streamManager.js           # HTML, Port-Check, Sibling-Relink
│   ├── webhookServer.js           # HTTP POST/GET für Motion-Events
│   └── cameraRegistry.js          # Mapping ioBroker-Name ↔ MotionEye-ID
├── test/
│   ├── mocha.setup.js
│   ├── mocharc.custom.json
│   ├── package.js                 # tests.packageFiles()
│   ├── integration.js             # tests.integration() + defineAdditionalTests
│   └── tsconfig.json
├── main.js                        # Adapter-Lebenszyklus, State-Handler
├── main.test.js                   # Unit-Tests (oder lib/*.test.js)
├── .releaseconfig.json
├── CHANGELOG_OLD.md
├── io-package.json
└── package.json
```

### 4.3 Modul-Verantwortung

| Modul | Aufgabe |
|---|---|
| `motionEyeApi` | Signatur, `/config/list`, `/config/{id}/set/`, Cache (15 s) |
| `motionApi` | Snapshots Port 7999 |
| `modeProfiles` | `buildModePatch()`, inkl. Webhook-URL + `movie_format: 'mp4'` |
| `streamManager` | `publishStreamHtmlWhenReady`, `publishSiblingStreamRelink` |
| `webhookServer` | Minimaler HTTP-Server (z. B. Port 8090) oder Integration ioBroker-HTTP |
| `cameraRegistry` | CRUD Kamera-Liste aus `native.cameras[]` |
| `main.js` | `onStateChange`, Polling, `onStop`, Instanz-Init |

### 4.4 inventwo-Wiedererkennung (Pflicht bei Repo-Start)

Beim Anlegen des Repos **1:1 von tidy oder enpal kopieren** und anpassen.

> **Nur diese drei Repos als Vorlage** — alle sauber mit `@iobroker/create-adapter` angelegt.  
> **life360ng nicht kopieren** (Fork-Umbau, mögliche Altlasten).

| Bereich | Muster-Repo | Was übernehmen |
|---|---|---|
| `package.json` scripts | [enpal](https://github.com/inventwo/ioBroker.enpal) | `test`, `test:js`, `test:package`, `check`, `lint`, `release-*`, `dev-server:*` |
| CI | [tidy](https://github.com/inventwo/ioBroker.tidy) | `.github/workflows/test-and-release.yml` |
| Cursor-Regeln | [foxesscloud](https://github.com/inventwo/ioBroker.foxesscloud) | `.cursor/rules/testing.mdc`, `docs-release.mdc`, `code-quality.mdc` |
| Unit-Tests | [tidy](https://github.com/inventwo/ioBroker.tidy) | `main.test.js` — reine Logik ohne Harness |
| Integration | [foxesscloud](https://github.com/inventwo/ioBroker.foxesscloud) | `test/integration.js` mit `defineAdditionalTests` |
| README-Kopf | enpal / tidy / foxesscloud | Logo, Badges, Maintainer, AI-assisted, PayPal |
| Changelog | enpal / tidy / foxesscloud | WIP-Block, `(skvarel)`-Einträge, `CHANGELOG_OLD.md` |

**Git-Regel (Cursor):** Nie `git commit` / `git push` / Release — nur wenn du es explizit verlangst. Releases lokal via `npm run release-patch|minor|major`.

---

## 5. Objektmodell (Channels)

### 5.1 Namespace

```
motioneye.<instance>.<channel>.<state>
```

Beispiel Instanz `0`, Kamera-Anzeigename **Auffahrt**:

```
motioneye.0.Auffahrt.mode
motioneye.0.Auffahrt.motion
motioneye.0.Auffahrt.snapshot
motioneye.0.Auffahrt.stream
motioneye.0.Auffahrt.streamPulse
motioneye.0.Auffahrt.streamUrl
motioneye.0.Auffahrt.status
motioneye.0.Auffahrt.lastAction
motioneye.0.Auffahrt.webhookUrl      # read-only Info
motioneye.0.Auffahrt.motionEyeId     # read-only: numerische ME-ID
motioneye.0.Auffahrt.motionEyeName   # read-only: Name in MotionEye
```

**Kanalname = vom Nutzer gewählter Name** (ASCII-safe: Leerzeichen → `_`, Sonderzeichen bereinigt — Logik aus `safe()` in `test.js`).

### 5.2 State-Definitionen (aus Prototyp)

| State | Typ | Rolle | R/W | Beschreibung |
|---|---|---|---|---|
| `mode` | string | `level.mode` | rw | `off` / `still` / `sharp` |
| `motion` | boolean | `sensor.motion` | rw | Bewegung (Webhook + Auto-Reset) |
| `snapshot` | boolean | `button` | w | Snapshot auslösen |
| `stream` | boolean | `switch` | rw | Videostream MotionEye |
| `streamPulse` | boolean | `button` | w | Stream kurz an (Auto-Off) |
| `streamUrl` | string | `text` | r | HTML für inventwo-Widget |
| `status` | string | `text` | r | Letzter Sync-Status |
| `lastAction` | string | `text` | r | Letzte API-Aktion |
| `webhookUrl` | string | `url` | r | In MotionEye einzutragende URL |
| `motionEyeId` | number | `value` | r | Zuordnung MotionEye |
| `motionEyeName` | string | `text` | r | Originalname MotionEye |

### 5.3 Instanz-States (optional)

```
motioneye.0.info.connection          # boolean — MotionEye erreichbar
motioneye.0.info.camerasOnline       # number
motioneye.0.info.lastSync            # string / timestamp
```

### 5.4 io-package.json — `objects` vs. dynamisch

**Empfehlung:** Kameras **dynamisch** bei Instanz-Start aus `native.cameras` anlegen (wie Zigbee-Geräte), nicht statisch in `io-package.json`.  
Vorteil: Hinzufügen/Entfernen in Admin ohne Adapter-Neuinstallation.

---

## 6. Kamera-Verwaltung (Kernfeature)

### 6.1 Datenmodell `native.cameras[]`

```json
{
  "cameras": [
    {
      "id": "auffahrt",
      "name": "Auffahrt",
      "motionEyeId": 1,
      "enabled": true,
      "defaultMode": "off"
    }
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `id` | Interner Schlüssel (stable, für Webhook-Pfad) |
| `name` | **Anzeigename** → Channel-Name in ioBroker |
| `motionEyeId` | Numerische ID in MotionEye (`/config/list`) |
| `enabled` | Kanal aktiv / States anlegen |
| `defaultMode` | Modus nach Adapter-Start |

**Name in MotionEye** (`motionEyeName`) wird bei Discovery gelesen, ist aber **nicht** der ioBroker-Name.

### 6.2 Admin-UI Workflow

1. Instanz anlegen: Host, Ports, User, Passwort (optional leer)
2. Button **„Kameras von MotionEye laden“** → Dropdown mit unzugeordneten IDs
3. Nutzer wählt MotionEye-Kamera, gibt **eigenen Namen** ein → Speichern
4. Adapter legt States an, schreibt Webhook + Grundkonfiguration nach MotionEye

### 6.3 Discovery vs. manuell

| Modus | Wann |
|---|---|
| **Discovery** | Standard — `GET /config/list`, Liste in Admin |
| **Manuell** | `motionEyeId` eintippen (falls API gesperrt) |

Kein automatisches Anlegen aller MotionEye-Kameras ohne Zustimmung (8 Kameras, davon Laptop disabled → Nutzer soll wählen).

### 6.4 Was beim Speichern / Start passiert

Pro aktivierter Kamera:

1. States anlegen (oder aktualisieren)
2. `webhookUrl` berechnen und in MotionEye setzen (wenn Modus still/sharp)
3. Optional: `mediaSettings` (Snapshots manuell, …)
4. Optional: `disableStreamOnStart`
5. `defaultMode` anwenden
6. `movie_format: mp4` (kein OMX) bei `sharp`

---

## 7. Webhook-Architektur

### 7.1 Problem heute

```
MotionEye → http://ioBroker:8087/set/0_userdata.../motion?value=true  (simple-api)
```

### 7.2 Ziel im Adapter

**Variante A (empfohlen):** Eigener HTTP-Listener im Adapter

```
MotionEye → http://<ioBroker-IP>:<webhookPort>/motioneye.0/webhook/<cameraId>?value=true
```

- Port in Instanz konfigurierbar (Default z. B. 8090)
- Kein simple-api nötig
- `cameraId` = interner Schlüssel (`auffahrt`), nicht MotionEye-ID

**Variante B:** Weiter simple-api nutzen — weniger Code, aber Zusatz-Adapter und feste URL-Struktur.

**Empfehlung:** Variante A für v1, Variante B in Doku als Fallback.

### 7.3 Motion-Reset

Timer pro Kamera: `.motion` nach `motionResetMs` (Default 15000) → `false` (aus `test.js`).

---

## 8. Stream-Manager (aus `test.js` portieren)

Logik 1:1 übernehmen:

- `checkStreamPort()` vor HTML-Setzen
- `streamPausedHtml` = leer beim Aus
- `publishSiblingStreamRelink()` — Polling bis 60 s
- Konfigurierbare Delays in `native` (nicht hardcoded)

**Hinweis Doku:** VIS bindet pro Widget nur **eigenes** `streamUrl`; mehrere Streams pro View → kurzer schwarzer Moment möglich.

---

## 9. Instanz-Konfiguration (`native`)

```json
{
  "motionHost": "192.168.130.240",
  "motionPort": 7999,
  "motionEyePort": 8765,
  "motionEyeUser": "admin",
  "motionEyePassword": "",
  "useMotionEyeConfig": true,
  "webhookPort": 8090,
  "webhookBind": "0.0.0.0",
  "motionResetMs": 15000,
  "statusPollIntervalSec": 300,
  "requestTimeoutMs": 45000,
  "disableStreamOnStart": true,
  "applyMediaSettingsOnStart": true,
  "streamAutoOffMs": 120000,
  "streamStartDelayMs": 3000,
  "streamReadyTimeoutMs": 45000,
  "streamRetryMs": 2000,
  "streamSiblingRelinkTimeoutMs": 60000,
  "defaultMode": "off",
  "cameras": []
}
```

---

## 10. Modus-Profile (scharf erweitern)

Aus `test.js`, für Adapter ergänzen:

```javascript
// lib/modeProfiles.js
sharp: {
  motion_detection: true,
  movies: true,
  recording_mode: 'motion-triggered',
  movie_format: 'mp4',              // kein OMX
  web_hook_notifications_enabled: true,
  web_hook_notifications_http_method: 'GET',
}
```

Optional später: `max_movie_length`, `minimum_motion_frames` als pro-Kamera-Optionen.

---

## 11. Migration vom JavaScript-Script

| Alt (`0_userdata.0.MotionEye.*`) | Neu (`motioneye.0.*`) |
|---|---|
| `Auffahrt.mode` | `Auffahrt.mode` (Channel-Name gleich wenn gewünscht) |
| `…streamUrl` | `…streamUrl` |
| Script stoppen | Adapter-Instanz starten |
| simple-api Webhook | Adapter-Webhook-URL in MotionEye |

**Migrations-Script (später):** Einmalig States lesen, Adapter konfigurieren, alte `0_userdata`-States löschen.

**VIS-Bindings:** `{motioneye.0.Auffahrt.streamUrl}` statt `{0_userdata.0.MotionEye.Auffahrt.streamUrl}`.

---

## 12. Entwicklungs-Roadmap

### Phase 0 — Vorbereitung (1–2 Tage)

- [ ] Repo `inventwo/ioBroker.motioneye` mit `create-adapter` anlegen (JS, jsonConfig)
- [ ] inventwo-Boilerplate kopieren: `.cursor/`, `.github/`, `test/`, `.releaseconfig.json`
- [ ] `lib/motionEyeApi.js` aus `test.js` portieren + `lib/motionEyeApi.test.js` (Signatur)
- [ ] README-Skelett mit Badges + WIP-Changelog anlegen
- [ ] Dev-Server gegen echten MotionEye-Server (192.168.130.240)

### Phase 1 — MVP (1–2 Wochen)

- [ ] Instanz-Konfiguration (Host, Auth)
- [ ] Kamera-Tabelle in jsonConfig (manuell + Discovery)
- [ ] States: `mode`, `motion`, `status`, `lastAction`, `webhookUrl`
- [ ] `setMode()` → MotionEye Config-API
- [ ] Webhook-Server + Motion-Reset
- [ ] Polling `/config/list`

### Phase 2 — Stream & Snapshot (1 Woche)

- [ ] `snapshot`, `stream`, `streamPulse`, `streamUrl`
- [ ] Stream-Manager inkl. Sibling-Relink
- [ ] `disableStreamOnStart`, `streamAutoOffMs` nur für Pulse

### Phase 3 — Polish (1 Woche)

- [ ] i18n de/en (`admin/i18n/`, `translate-adapter`)
- [ ] Fehler-States / `info.connection` Info
- [ ] README vollständig (siehe Abschnitt 13)
- [ ] `npm run test` + CI grün (lint-first)
- [ ] npm / GitHub Release (`npm run release-patch`)
- [ ] Optional: ioBroker Forum Vorstellung

### Phase 4 — Optional (backlog)

- [ ] VIS/material Widget oder Icon-Set
- [ ] Automatische `.thumb`-Aufräum-Hinweis (Link zu Linux-Control)
- [ ] Speicherplatz-State via SSH/HTTP (du -sm) — eher separater Adapter
- [ ] MotionPlus / Audio — nur wenn Motion-Projekt mitspielt
- [ ] Mehrere MotionEye-Server (multi-host) — eine Instanz pro Server reicht v1

---

## 13. README-Vorlage (inventwo-Stil)

Struktur wie [enpal](https://github.com/inventwo/ioBroker.enpal) / [tidy](https://github.com/inventwo/ioBroker.tidy) — englisch, klar gegliedert:

```markdown
![Logo](admin/motioneye-logo.svg)

# ioBroker adapter for MotionEye

![Number of Installations](https://iobroker.live/badges/motioneye-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/motioneye-stable.svg)
[![NPM Version](https://nodei.co/npm/iobroker.motioneye.svg?style=shields&data=v,u,d&color=orange)](...)
[![Downloads](https://img.shields.io/npm/dm/iobroker.motioneye.svg)](...)

[![COMMUNITY](https://img.shields.io/badge/community%20-ioBroker%20|%20forum-blue.svg)](...)
[![MAINTAINER](https://img.shields.io/badge/maintainer-skvarel%20@%20inventwo-yellowgreen.svg)](...)
[![AI](https://img.shields.io/badge/ai%20assisted-cursor-blue.svg)](...)

[![Paypal Donation](https://img.shields.io/badge/paypal-donate%20|%20spenden-green.svg)](...)

---

## What this adapter does

- Connect MotionEye cameras to ioBroker for motion detection, snapshots, and live streams
- Control detection modes (`off` / `still` / `sharp`) from ioBroker or VIS
- Provide `streamUrl` HTML for inventwo/VIS2 widgets — no simple-api required for webhooks

## Features

- User-defined camera names in ioBroker (independent of MotionEye labels)
- Dynamic channels under `motioneye.0.<Name>.*`
- Built-in webhook server — no simple-api dependency
- MotionEye Config API sync (modes, webhooks, stream on/off)
- `info.connection` — instance turns red when MotionEye is unreachable
- Stream sibling relink after VIS re-render (multi-camera dashboards)

## Data Points

### Per camera (`motioneye.0.<Name>.*`)

| State | Type | Read | Write | Description |
|-------|------|------|-------|-------------|
| `mode` | value | yes | yes | `off` / `still` / `sharp` |
| `motion` | indicator | yes | yes | Motion detected (auto-reset) |
| `snapshot` | button | no | yes | Trigger snapshot |
| `stream` | switch | yes | yes | Live MJPEG stream on/off |
| `streamPulse` | button | no | yes | Stream on briefly (auto-off) |
| `streamUrl` | text | yes | no | HTML `<img>` for inventwo widget |
| `status` | text | yes | no | Last sync status |
| `lastAction` | text | yes | no | Last API action |
| `webhookUrl` | url | yes | no | URL configured in MotionEye |
| `motionEyeId` | value | yes | no | MotionEye camera ID |
| `motionEyeName` | text | yes | no | Original name in MotionEye |

### Instance (`motioneye.0.info.*`)

| State | Type | Description |
|-------|------|-------------|
| `info.connection` | boolean | MotionEye reachable |
| `info.camerasOnline` | number | Enabled cameras responding |
| `info.lastSync` | date | Last status poll |

## Installation

1. Install the adapter from the ioBroker admin interface
2. Create a new instance
3. Configure **Settings**: MotionEye host, ports, credentials (optional)
4. Add cameras on the **Cameras** tab (display name + MotionEye ID)
5. Save and start — webhook URLs are written to MotionEye automatically

### Camera modes

| Mode | Motion detection | Video recording | Webhook |
|------|------------------|-----------------|---------|
| `off` | no | no | no |
| `still` | yes | no | yes |
| `sharp` | yes | motion-triggered MP4 | yes |

> **Note:** For `sharp` mode use `mp4` without OMX hardware encoding — OMX often fails on Raspberry Pi.

## VIS / inventwo Integration

Bind the inventwo HTML widget to:

```
{motioneye.0.<Name>.streamUrl}
```

- Use the **HTML** field — not the Image widget
- Each widget binds only its own camera's `streamUrl`
- Brief black flash possible when toggling another stream (VIS re-render) — adapter relinks automatically

## Privacy & Data Handling

- Connects only to your **local MotionEye server** — no cloud
- Credentials stored encrypted in the ioBroker database
- Webhook listener binds to configured port on the ioBroker host

## Changelog

<!--
  ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (skvarel) …

### 0.1.0 (YYYY-MM-DD)
- (skvarel) Initial release

## Older changes
- [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

## License
MIT — Copyright (c) 2026 skvarel <skvarel@inventwo.com>
```

**Changelog-Regeln** (wie in `.cursor/rules/docs-release.mdc`):

- Während der Entwicklung nur unter `### **WORK IN PROGRESS**` eintragen
- Veröffentlichte Versionen **nicht** manuell editieren — `release-script` verschiebt WIP
- Format: `- (skvarel) Added/Fixed/Modified/Replaced/Removed …` — keine `**FIXED**`-Tags
- Nur nutzerrelevante Änderungen (erscheint im ioBroker-Update-Dialog)

---

## 14. Tests (inventwo-Konvention)

### 14.1 Test-Stack

| Tool | Zweck |
|---|---|
| `@iobroker/testing` | Package-Validierung + Integration-Harness |
| mocha + chai + sinon-chai + chai-as-promised | Unit-Tests |
| `test/mocha.setup.js` | Chai-Plugins, unhandledRejection → throw |

**CI läuft standardmäßig:** `npm run test` = `test:js` + `test:package`  
**Nicht in CI:** `npm run test:integration` — lokal mit dev-server + echtem MotionEye

### 14.2 Dateien (von enpal/tidy kopieren)

```
test/
├── mocha.setup.js          # chai + sinon-chai
├── mocharc.custom.json     # require: mocha.setup.js
├── package.js              # tests.packageFiles('..')
└── integration.js          # tests.integration('..', { defineAdditionalTests })
```

`package.json` scripts (identisch zu enpal):

```json
"test:js": "mocha --config test/mocharc.custom.json \"{!(node_modules|test)/**/*.test.js,*.test.js,test/**/test!(PackageFiles|Startup).js}\"",
"test:package": "mocha test/package --exit",
"test:integration": "mocha test/integration --exit",
"test": "npm run test:js && npm run test:package"
```

### 14.3 Unit-Tests (ohne Harness) — Priorität Phase 0

Vorbild: [tidy/main.test.js](https://github.com/inventwo/ioBroker.tidy/blob/main/main.test.js)

| Datei | Was testen | Mock? |
|---|---|---|
| `lib/motionEyeApi.test.js` | SHA1-Signatur (leer + Passwort), URL-Pfad-Encoding | ja — kein HTTP |
| `lib/modeProfiles.test.js` | `off`/`still`/`sharp` Patches, `movie_format: 'mp4'` | nein |
| `lib/cameraRegistry.test.js` | `safe(name)`, ID ↔ Channel-Mapping | nein |
| `lib/streamManager.test.js` | HTML-Generierung, Port-URL, leeres `streamPausedHtml` | HTTP mock |
| `main.test.js` | Webhook-Pfad-Parsing, Motion-Reset-Timer-Logik | sinon fake timers |

**Regel:** Reine Hilfsfunktionen in `lib/` extrahieren und dort testen — nicht alles in `main.js` belassen.

### 14.4 Integration-Tests (lokal, dev-server)

Vorbild: [foxesscloud/testing.mdc](https://github.com/inventwo/ioBroker.foxesscloud/blob/main/.cursor/rules/testing.mdc)

```javascript
tests.integration(path.join(__dirname, '..'), {
  defineAdditionalTests({ suite }) {
    suite('MotionEye adapter', (getHarness) => {
      let harness;
      before(() => { harness = getHarness(); });

      it('should create camera states on start', function () {
        return new Promise(async (resolve, reject) => {
          await harness.changeAdapterConfigAsync({
            native: { motionHost: '127.0.0.1', cameras: [{ id: 'test', name: 'Test', motionEyeId: 1, enabled: true }] }
          });
          await harness.startAdapterAndWait();
          const ids = await harness.states.getStateIDsAsync();
          expect(ids).to.include('motioneye.0.Test.mode');
          resolve();
        });
      }).timeout(40000);
    });
  }
});
```

**Regeln:**

- Konfiguration via `harness.changeAdapterConfigAsync()` / `harness.objects.setObject()`
- Start via `harness.startAdapterAndWait()`
- Prüfung via `harness.states.getState()` / `getStateIDs()`
- **Nie** MotionEye-API-URLs direkt im Integrationstest aufrufen
- MotionEye-HTTP in Unit-Tests mocken (z. B. `nock` oder stub auf `fetch`)

### 14.5 CI (test-and-release.yml)

Wie tidy/enpal — Matrix:

- Node **22.x** und **24.x**
- OS: **ubuntu**, **windows**, **macos**
- Jobs: `check-and-lint` → `adapter-tests` → `deploy` (nur bei Version-Tags)

Lokal vor Commit: `npm run lint` → `npm run test`

### 14.6 Test-Matrix MotionEye-spezifisch

| Test | Art | CI? |
|---|---|---|
| Signatur-Auth (leer + Passwort) | Unit (`lib/motionEyeApi.test.js`) | ja |
| `buildModePatch` off/still/sharp | Unit | ja |
| `safe()` Channel-Namen | Unit | ja |
| `streamUrl` HTML-Format | Unit | ja |
| Package + io-package + jsonConfig | `test:package` | ja |
| Adapter start → States angelegt | Integration | lokal |
| Webhook → `motion` true → Reset 15 s | Integration | lokal |
| `setMode` → MotionEye Config-API | Integration + MotionEye | manuell |
| Stream an → Port-Polling → `streamUrl` | Integration + MotionEye | manuell |
| Carport aus → Auffahrt Relink | Manuell (VIS) | nein |
| Motion-Neustart Timeout | Manuell | nein |

---

## 15. Offene Entscheidungen (für nächsten Chat)

1. **Adapter-Name:** `motioneye` vs. `motion-eye` (npm-Namensverfügbarkeit prüfen); Repo: `inventwo/ioBroker.motioneye`
2. **Webhook-Port:** Fester 8090 vs. dynamisch — Firewall-Hinweis nötig?
3. **Channel-Namen:** Nur `safe(name)` oder Unicode (ä/ö/ü) erlauben?
4. **Gelöschte Kamera in Admin:** States löschen oder behalten?
5. **MotionEye-Kamera disabled:** Adapter-Kanal trotzdem anzeigen?
6. **Alte `0_userdata`-Pfad:** Migrations-Assistent im Admin?
7. **Licence:** MIT (ioBroker-Standard)
8. **Maintainer:** Solo vs. GitHub-Org

---

## 16. Referenzen

| Ressource | URL |
|---|---|
| **inventwo Referenz-Adapter** (nur diese drei) | |
| ioBroker.enpal | https://github.com/inventwo/ioBroker.enpal |
| ioBroker.tidy | https://github.com/inventwo/ioBroker.tidy |
| ioBroker.foxesscloud | https://github.com/inventwo/ioBroker.foxesscloud |
| **ioBroker / MotionEye** | |
| ioBroker Adapter Creator | https://www.iobroker.dev/create-adapter |
| Adapter Dev Docs | https://iobroker.github.io/dev-docs/ |
| @iobroker/testing | https://github.com/ioBroker/testing |
| MotionEye Config API | MotionEye 0.43.x auf Port 8765 |
| Prototyp-Script | [`test.js`](../test.js) |
| MotionEye Audio (nicht v1) | https://github.com/DeadEnded/MotionEyeAudio |

---

## 17. Zusammenfassung für neuen Chat

**Auftrag:** ioBroker-Adapter `inventwo/ioBroker.motioneye` gemäß diesem Plan implementieren — start mit Phase 0/1.

**Stil:** Wie enpal / tidy / foxesscloud — Plain JS, jsonConfig, `@iobroker/testing`, README/Changelog/CI daraus kopieren (nicht life360ng).

**Kernidee:** Nutzer pflegt nur eine **Kamera-Tabelle** (eigener Name + MotionEye-ID). Adapter erledigt API, States, Webhooks, Stream-HTML.

**Prototyp:** `test.js` ist die funktionale Spezifikation — insbesondere `motionEyeApi`, `modeProfiles`, `streamManager`, `publishSiblingStreamRelink`.

**Wichtigste UX-Lektion aus dem Projekt:** Namen entkoppeln, `sharp` = Video + `mp4` ohne OMX, Webhook ohne simple-api, Stream-HTML mit Relink für Multi-Stream-VIS.
