![Logo](admin/motioneye-logo.svg)

# ioBroker adapter for MotionEye

![Number of Installations](https://iobroker.live/badges/motioneye-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/motioneye-stable.svg)
[![NPM Version](https://nodei.co/npm/iobroker.motioneye.svg?style=shields&data=v,u,d&color=orange)](https://www.npmjs.com/package/iobroker.motioneye)
[![Downloads](https://img.shields.io/npm/dm/iobroker.motioneye.svg)](https://www.npmjs.com/package/iobroker.motioneye)

[![COMMUNITY](https://img.shields.io/badge/community%20-ioBroker%20|%20forum-blue.svg)](https://forum.iobroker.net/)
[![MAINTAINER](https://img.shields.io/badge/maintainer-skvarel%20@%20inventwo-yellowgreen.svg)](https://github.com/skvarel)
[![AI](https://img.shields.io/badge/ai%20assisted-cursor-blue.svg)](https://github.com/inventwo/ioBroker.motioneye/blob/main/.cursor/iobroker-adapter.mdc)

[![Paypal Donation](https://img.shields.io/badge/paypal-donate%20|%20spenden-green.svg)](https://www.paypal.com/donate/?hosted_button_id=7W6M3TFZ4W9LW)

---

## What this adapter does

Connect MotionEye cameras to ioBroker for motion detection, snapshots, and live streams. Control detection modes (`off` / `still` / `sharp`) from ioBroker or VIS and provide `streamUrl` HTML for inventwo/VIS2 widgets — no simple-api required for webhooks.

> **Status:** Phase 2 — snapshot, stream, streamPulse, and `streamUrl` HTML for inventwo/VIS widgets. Phase 1 covers modes, webhooks, and MotionEye sync.

## Features

- User-defined camera names in ioBroker (independent of MotionEye labels)
- Dynamic channels under `motioneye.0.<Name>.*`
- Built-in webhook server — no simple-api dependency
- MotionEye Config API sync for modes and webhook URLs
- `info.connection` — instance shows when MotionEye is unreachable
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
| `webhookUrl` | url | yes | no | URL written to MotionEye |
| `motionEyeId` | value | yes | no | MotionEye camera ID |
| `motionEyeName` | text | yes | no | Original name in MotionEye |

### Instance (`motioneye.0.info.*`)

| State | Type | Description |
|-------|------|-------------|
| `info.connection` | boolean | MotionEye reachable |
| `info.camerasOnline` | number | Enabled cameras found in MotionEye |
| `info.lastSync` | text | Last status poll timestamp |

## Installation

1. Install the adapter from the ioBroker admin interface (or clone this repo and use the dev-server)
2. Create a new instance
3. Configure **Settings**: MotionEye host, ports, credentials (optional), webhook host
4. Add cameras on the **Cameras** tab (display name + MotionEye ID)
5. Save and restart the instance — datapoints are created and webhook URLs are written to MotionEye

### Camera modes

| Mode | Motion detection | Video recording | Webhook |
|------|------------------|-----------------|---------|
| `off` | no | no | no |
| `still` | yes | no | yes |
| `sharp` | yes | motion-triggered MP4 | yes |


## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `motionHost` | *(empty)* | MotionEye server hostname or IP (required) |
| `motionPort` | `7999` | Motion HTTP API (snapshots) |
| `motionEyePort` | `8765` | MotionEye config API |
| `motionEyeUser` | `admin` | MotionEye login user |
| `motionEyePassword` | *(empty)* | MotionEye password (plain text, stored encrypted) |
| `webhookHost` | *(required)* | ioBroker host IP or hostname reachable from MotionEye (used in webhook URLs) |
| `webhookPort` | `8090` | Built-in webhook listener port |
| `motionResetMs` | `15000` | Auto-reset for `.motion` after webhook |
| `statusPollIntervalSec` | `300` | MotionEye status poll interval |

## Changelog

<!--
  ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (skvarel) Added snapshot, stream, streamPulse, and streamUrl datapoints with Motion API and stream HTML manager
- (skvarel) Clarified admin help for webhookHost — IP must be set manually for MotionEye webhooks
- (skvarel) Phase 1 MVP: camera table in admin, dynamic channels and states (`mode`, `motion`, `status`, `webhookUrl`, …)
- (skvarel) Built-in webhook HTTP server on configurable port (no simple-api)
- (skvarel) Mode control via MotionEye Config API with `off` / `still` / `sharp` profiles
- (skvarel) Status polling, `info.connection`, and MotionEye name sync
- (skvarel) Initial adapter scaffold with inventwo boilerplate (CI, tests, Cursor rules)
- (skvarel) Ported MotionEye Config API client (`lib/motionEyeApi.js`) with SHA1 signature auth and unit tests
- (skvarel) Dev-server defaults targeting MotionEye at `192.168.130.240`

### 0.0.1 (2026-06-21)
- (skvarel) Initial development release

## Older changes
- [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

## License
MIT — Copyright (c) 2026 skvarel <skvarel@inventwo.com>
