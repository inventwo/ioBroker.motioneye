# Older changes

_No released versions yet._
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
