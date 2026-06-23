![Logo](../../admin/motioneye.png)

[Back to documentation index](README.md)

## Camera modes

| Mode | Motion detection | Video recording | Webhook to ioBroker |
|------|------------------|-----------------|---------------------|
| `off` | no | no | no |
| `still` | yes | no | yes |
| `sharp` | yes | motion-triggered MP4 | yes |

Set mode via datapoint `<camera>.mode` or from scripts. The adapter writes the corresponding MotionEye config when **Control MotionEye via config API** is enabled.
