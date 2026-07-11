![Logo](../../admin/motioneye.png)

[Back to documentation index](README.md)

## Alert level (`alertLevel`)

Per-camera **alert level** combines MotionEye mode and Telegram-on-motion in one writable datapoint — ideal for a single VIS dropdown.

| `alertLevel` | MotionEye `mode` | `motion` trigger | Telegram on motion |
|--------------|------------------|------------------|--------------------|
| `off` | `off` | no | no |
| `motion` | `still` | yes | no |
| `notify` | `still` | yes | yes (text/image per Notifications tab) |
| `record` | `sharp` | yes | no |
| `full` | `sharp` | yes | yes |

Path: `motioneye.<instance>.<camera>.alertLevel` (same level as `mode`).

### VIS usage

Bind your dropdown to **`alertLevel`** instead of `mode`. The adapter applies the profile and keeps **`mode`** in sync (`still` / `sharp` / `off`).

Aliases (case-insensitive): `aus`, `bewegung`, `alarm`, `aufnahme`, `vollschutz`, or `0`–`4`.

### Legacy `mode` control

Writing **`mode`** directly still works (existing VIS/scripts). Telegram then follows the **Notifications** tab config; **`alertLevel`** is updated to the closest matching level for display.

Writing **`alertLevel`** takes priority for Telegram-on-motion until **`mode`** is written again.

### Persistence

The selected level is stored in the **`alertLevel`** state and reapplied on adapter restart.

Manual **`snapshot`** and per-camera **On snapshot** Telegram settings are independent.
