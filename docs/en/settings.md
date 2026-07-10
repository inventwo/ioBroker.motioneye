![Logo](../../admin/motioneye.png)

[Back to documentation index](README.md)

## Settings tab

| Option | Default | Description |
|--------|---------|-------------|
| MotionEye host | *(required)* | IP or hostname of the MotionEye server |
| MotionEye config API port | `8765` | Mode, webhooks, stream control, snapshots |
| MotionEye username | `admin` | Web login user |
| MotionEye password | *(empty)* | Re-enter after adapter update if log shows `unauthorized` |
| Control MotionEye via config API | `true` | Leave enabled for normal operation |
| Webhook host | *(required)* | ioBroker IP/hostname **as reachable from MotionEye** |
| Webhook port | `8090` | Built-in webhook listener; allow inbound on ioBroker |
| Motion auto-reset (ms) | `15000` | How long `.motion` stays true after webhook |
| Status poll interval (s) | `300` | MotionEye status poll |
| Disable video stream on start | `true` | Turn off streams when adapter starts |
| Stream pulse auto-off (ms) | `120000` | Duration for `streamPulse` |

### motionHost vs webhookHost

- **motionHost** — ioBroker **connects to** MotionEye (config API, port 8765).
- **webhookHost** — MotionEye **connects to** ioBroker (webhooks, port 8090).

Both directions must work on your network. In Docker setups the addresses seen from a PC browser may differ from what containers need.
