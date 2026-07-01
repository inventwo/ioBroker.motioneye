![Logo](../../admin/motioneye.png)

### ioBroker adapter for MotionEye

## Documentation

- [Settings](settings.md)
- [Cameras](cameras.md)
- [Camera modes](modes.md)
- [Datapoints](datapoints.md)
- [Live stream in VIS](vis-stream.md)
- [Help & FAQ](faq.md)

#### ioBroker requirements

1. Node.js 22 or newer
2. js-controller 6.0.11 or newer
3. Admin adapter 7.6.20 or newer

#### MotionEye requirements

1. MotionEye with config API on port **8765** (default)
2. Motion HTTP API on port **7999** for snapshots (default)
3. In `motion.conf`: `webcontrol_localhost off` if MotionEye and ioBroker run on different hosts
4. **MotionEye 0.44+:** adapter **0.5.0** or newer (session login) — see [FAQ](faq.md#motioneye-044-adapter-050)

## Quick start

- Create one adapter instance per MotionEye server.
- On **Settings**: set MotionEye host, credentials, and **webhook host** (ioBroker IP as reachable from MotionEye).
- On **Cameras**: add cameras or use **Load cameras from MotionEye**, then save and restart the instance.
- Check `motioneye.<instance>._info.connection` — should be `true` when MotionEye is reachable.
- For live video in VIS: HTML widget with binding to `<camera>.streamUrl` (see [Live stream in VIS](vis-stream.md)).
