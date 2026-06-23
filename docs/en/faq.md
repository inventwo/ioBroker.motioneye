![Logo](../../admin/motioneye.png)

### ioBroker adapter for MotionEye

[Back to documentation index](README.md)

## Help & FAQ

Typical questions and log messages from alpha testers.

---

### Log shows `unauthorized`

MotionEye is reachable, but login or API signature failed.

**Check:**

1. Open the instance settings and re-enter **MotionEye username** and **password**, then **Save** and restart the instance.
2. After adapter updates since 0.2.1 the password is stored encrypted — an old plain-text value may no longer work until you save it again.
3. If MotionEye has **no password**, leave the field empty (no spaces).
4. Username must match MotionEye exactly (often `admin`).

**Success:** `_info.connection` = `true`, no `unauthorized` warnings in the log.

---

### Log shows `EHOSTUNREACH` or `ECONNREFUSED` (Docker / Unraid)

The ioBroker container cannot reach `motionHost:8765` at the network level — this is **not** a password issue.

**Check:**

1. Test from **inside the ioBroker container**, not from your PC:

   ```bash
   docker exec -it <iobroker-container> sh
   wget -O- http://<motionHost>:8765/ 2>&1 | head
   ```

2. **motionHost** must be the address reachable **from the ioBroker container**:
   - Same Docker custom network → container name (e.g. `motioneye`)
   - Otherwise Unraid/host IP, if routed from the container
   - `192.168.x.x` from a PC browser does not guarantee the container can reach it

3. MotionEye Docker template: port **8765** published?
4. **webhookHost** is separate — MotionEye must reach ioBroker on port **8090** for motion webhooks.

---

### `_info.connection` stays `false`

- Wrong **motionHost** or **motionEyePort** (8765, not 7999)
- Firewall between ioBroker and MotionEye
- MotionEye not running
- Docker/network issue (see above)

---

### No stream image in VIS

1. Set `<camera>.stream` to `true` (or trigger `streamPulse`).
2. HTML widget with binding, e.g. `{motioneye.0.garten.streamUrl}` — use lowercase channel folder name.
3. Wait a few seconds after enabling the stream.
4. **HTTPS VIS + HTTP MotionEye:** browser may block mixed content.

See [Live stream in VIS](vis-stream.md) for step-by-step instructions.

---

### Motion works in ioBroker but not in MotionEye UI (or vice versa)

Leave **Control MotionEye via config API** enabled. The adapter writes mode, webhooks, and stream state to MotionEye. If disabled, ioBroker only receives webhooks and does not sync config.

---

### Where to find detailed logs?

Set the instance log level to **debug**, reproduce the issue, and check **Logs** in ioBroker Admin. Include `_info.connection` and the first error line when asking in the forum.
