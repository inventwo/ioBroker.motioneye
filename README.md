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
- `0_info.connection` — instance shows when MotionEye is unreachable
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
| `streamUrl` | text | yes | no | HTML `<img>` for html widget |
| `status` | text | yes | no | Last sync status |
| `lastAction` | text | yes | no | Last API action |
| `webhookUrl` | url | yes | no | URL written to MotionEye |
| `motionEyeId` | value | yes | no | MotionEye camera ID |
| `motionEyeName` | text | yes | no | Original name in MotionEye |

### Instance (`motioneye.0.0_info.*`)

The `0_info` folder sorts above camera channels (digits before letters in the object tree).

| State | Type | Description |
|-------|------|-------------|
| `0_info.connection` | boolean | MotionEye reachable |
| `0_info.camerasOnline` | number | Enabled cameras found in MotionEye |
| `0_info.lastSync` | text | Last status poll timestamp |
| `0_info.motionEyeVersion` | text | MotionEye server version |
| `0_info.motionVersion` | text | Motion daemon version |

## Installation

1. Install the adapter from the ioBroker admin interface (or clone this repo and use the dev-server)
2. Create a new instance
3. Configure **Settings**: MotionEye host, ports, credentials (optional), webhook host
4. Add cameras on the **Cameras** tab (display name, MotionEye ID, optional media folder)
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
| `useMotionEyeConfig` | `true` | Write mode, webhook URLs, and stream on/off to MotionEye (leave enabled for normal use) |

Per camera (Cameras tab): optional **Media folder** name under `/var/lib/motioneye` (e.g. `Bambu` instead of default `Camera8`). Applied on adapter start when config sync is enabled. Does not rename existing folders on disk.

## Support

If you like our work and would like to support us, we appreciate any donation.
(This link leads to our PayPal account and is not affiliated with ioBroker.)

[![Donate](img/support.png)](https://www.paypal.com/donate?hosted_button_id=7W6M3TFZ4W9LW)

## Changelog

<!--
  ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
- (skvarel) Optional per-camera media folder name under `/var/lib/motioneye` (written to MotionEye on adapter start)
- (skvarel) Admin: **Load cameras from MotionEye** button (merges `/config/list` into camera table)
- (skvarel) Admin: **Help** tab with setup guide, modes, datapoints, and stream/inventwo notes

### 0.1.2 (2026-06-21)
- (skvarel) Clarified admin help for useMotionEyeConfig (required for mode, webhooks, and stream control — not only MotionEye web UI)

### 0.1.1 (2026-06-21)
- (skvarel) Renamed info folder from `_info` to `0_info` so it sorts above camera channels in the object tree
- (skvarel) Migrate legacy `info` and `_info` states to `0_info` on adapter start

### 0.1.0 (2026-06-21)
- (skvarel) Added states for motionEyeVersion and motionVersion

### 0.0.1 (2026-06-21)
- (skvarel) Initial development release

## Older changes
- [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

## License

MIT License

Copyright (c) 2026 skvarel <skvarel@inventwo.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
