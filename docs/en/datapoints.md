![Logo](../../admin/motioneye.png)

[Back to documentation index](README.md)

## Datapoints

### Per camera (`motioneye.<instance>.<channel>.*`)

Channel names are lowercase (e.g. `garten`, `innenhof_ii`).

| State | Read | Write | Description |
|-------|------|-------|-------------|
| `mode` | yes | yes | `off` / `still` / `sharp` |
| `motion` | yes | no | Motion detected (auto-reset) |
| `snapshot` | no | yes | Trigger snapshot (button) |
| `stream` | yes | yes | Live MJPEG stream on/off |
| `streamPulse` | no | yes | Short stream pulse (button) |
| `streamUrl` | yes | no | Ready-to-use HTML for HTML widgets |
| `status` | yes | no | Last sync / error text |
| `webhookUrl` | yes | no | URL written to MotionEye |

### Instance info (`motioneye.<instance>._info.*`)

| State | Description |
|-------|-------------|
| `_info.connection` | `true` when MotionEye config API is reachable |
| `_info.camerasOnline` | Enabled cameras found in MotionEye |
| `_info.lastSync` | Last poll timestamp |
| `_info.motionEyeVersion` | MotionEye version |
| `_info.motionVersion` | Motion daemon version |
