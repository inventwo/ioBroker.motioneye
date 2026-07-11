# Older changes

_No released versions yet._
## 0.9.0 (2026-07-05)
- (skvarel) Per-camera storage stats under `storage.*`: snapshot count, video count, and occupied space in MB (`storage.snapshotCount`, `storage.videoCount`, `storage.usedSpaceMb`, `storage.lastRefresh`), refreshed on demand via `storage.refresh`
- (skvarel) New **Storage** config tab: global auto-refresh on/off switch + interval (`storagePollEnabled`, `storagePollIntervalSec`, off by default), a per-camera "Exclude from auto-refresh" checkbox to skip unimportant cameras, and a button to refresh all listed cameras immediately

## 0.8.0 (2026-07-04)
- (skvarel) New **Overlay** config tab: preset `overlay.*` (enabled/leftText/rightText/customLeftText/customRightText/textScale) per camera in a table, with a button to apply the table to already-running cameras immediately; values only ever flow from the config table to the datapoints, never back, so live datapoint changes are never overwritten on a restart

## 0.7.0 (2026-07-03)
- (skvarel) Per-camera text overlay under `overlay.*`: read and control overlay on/off, left/right text mode (camera name / timestamp / custom text / disabled), custom text strings, and text size (`overlay.enabled`, `overlay.leftText`, `overlay.rightText`, `overlay.customLeftText`, `overlay.customRightText`, `overlay.textScale`); `leftText`/`rightText` and their custom text are always saved together, in any order
- (skvarel) Fixed a race condition where setting two `settings.*` datapoints for the same camera at nearly the same time could silently drop one of the changes ("lost update"); config writes per camera are now serialized

## 0.6.1 (2026-07-03)
- (skvarel) Fixed privacy mask regions not surviving adapter restarts/updates: mask lines are now persisted to the settings channel's native config instead of only in memory

## 0.6.0 (2026-07-02)
- (skvarel) Per-camera device settings under `settings.*`: read and control framerate, resolution, rotation, auto brightness and privacy mask (`settings.framerate`, `settings.resolution`, `settings.availableResolutions`, `settings.rotation`, `settings.autoBrightness`, `settings.privacyMask`); resolution is validated against the camera's supported list

## 0.5.0 (2026-07-01)
- (skvarel) MotionEye 0.44+ support: session login via POST /login (auto-fallback when URL signature auth fails); keeps 0.43.x signature auth

## 0.4.3 (2026-06-30)
- (skvarel) Fixed italian translation for `streamReadyTimeoutMs_help` (repository review E5606)

## 0.4.2 (2026-06-30)
- (skvarel) FAQ: connection test button, SSH node path on ioBroker host, GitHub install, web-login vs API troubleshooting
- (skvarel) Trim MotionEye host/user/password before API calls; admin button 'Test connection'
- (skvarel) Verbose unauthorized hints: web login URL and simple-password troubleshooting

## 0.4.1 (2026-06-28)
- (skvarel) Added Logs / Logging tab with optional verbose diagnostic logging for troubleshooting (e.g. unauthorized)

## 0.4.0 (2026-06-28)
- (ioBroker-Bot) Adapter requires admin >= 7.8.23 now.
- (skvarel) Repository review fixes: timer value capping, self-scheduling status poll, removed unused help i18n keys, stream timing settings in expert mode

## 0.3.5 (2026-06-25)
- (skvarel) Fixed object roles for repository review: `_info` as channel, camera `mode` role `level.effect`, `motion` read-only (`sensor.motion`)

## 0.3.4 (2026-06-25)
- (skvarel) Fixed object structure for ioBroker repository review: `_info` as channel, `mode` role `value`, `motion` read-only (`sensor.motion`)

## 0.3.3 (2026-06-23)
- (skvarel) Redesigned help tab: short intro, quickstart, and links to GitHub documentation
- (skvarel) Added GitHub documentation in `docs/en/` and `docs/de/` (settings, cameras, modes, datapoints, VIS stream, FAQ)
- (skvarel) Help tab shows one documentation link per admin language (DE or EN) plus direct FAQ link; external links open in a new tab

## 0.3.2 (2026-06-22)
- (skvarel) Modified config/help

## 0.3.1 (2026-06-22)
- (skvarel) Changed repo icon

## 0.3.0 (2026-06-22)
- (skvarel) Camera channel folders are now lowercase (e.g. `innenhof_ii` instead of `Innenhof_II`) — aligned with other ioBroker adapters
- (skvarel) Info states moved from `0_info` to `_info`
- (skvarel) Existing datapoint values are migrated automatically on adapter start — please check VIS, scripts, and automations that use fixed state paths

## 0.2.1 (2026-06-22)
- (skvarel) Fixed adapter checker errors and warnings

## 0.2.0 (2026-06-22)
- (skvarel) Added optional per-camera media folder name under `/var/lib/motioneye` (written to MotionEye on adapter start)
- (skvarel) Added camera load from MotionEye (merges `/config/list` into camera table)
- (skvarel) Added Help-Tab with setup guide, modes, datapoints, and stream/inventwo notes

## 0.1.2 (2026-06-21)
- (skvarel) Clarified admin help for useMotionEyeConfig (required for mode, webhooks, and stream control — not only MotionEye web UI)

## 0.1.1 (2026-06-21)
- (skvarel) Renamed info folder from `_info` to `0_info` so it sorts above camera channels in the object tree

## 0.1.0 (2026-06-21)
- (skvarel) Added states for motionEyeVersion and motionVersion

## 0.0.1 (2026-06-21)
- (skvarel) Initial development release
