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
5. **MotionEye config API port** is **8765** — not 7999 (Motion HTTP) and not a reverse-proxy web port unless the API is forwarded there too.

**Success:** `_info.connection` = `true`, no `unauthorized` warnings in the log.

#### Web login works, adapter still shows `unauthorized`

If the browser login succeeds but the adapter logs `GET /config/list → HTTP 403: unauthorized`, it is usually **not** a wrong host but **different credentials** or the **wrong API URL**:

1. **Same port as the adapter:** Web login must work at `http://<motionHost>:8765/` — not only at `:7999`, `:80`, `:443`, or another URL.
2. **Same user:** **MotionEye username** must match the MotionEye admin user exactly (case-sensitive, often `admin`).
3. **Password in ioBroker:** Clear the field completely → **Save** → restart instance → type the password **manually** (do not paste) → **Save** → restart. Fixes broken encryption or invisible whitespace.
4. **Two separate servers:** ioBroker and MotionEye on different VMs/LXCs (e.g. Proxmox) is fine — SSH tests and `node` must run on the **ioBroker host**, not on the MotionEye container.
5. **MotionEye 0.44 or newer:** From MotionEye **0.44** the API uses **session login** instead of URL signatures. You need adapter **0.5.0** or newer — with **0.4.x** you still get `unauthorized` even when web login works. See [MotionEye 0.44+](#motioneye-044-adapter-050).

---

### MotionEye 0.44+ (adapter 0.5.0+)

From **MotionEye 0.44** onwards, API authentication changed: instead of `_username` / `_signature` in the URL, the client signs in via **`POST /login`** and uses a session cookie ([release notes](https://github.com/motioneye-project/motioneye/releases/tag/0.44.0)).

| MotionEye | Adapter | Result |
|-----------|---------|--------|
| **0.43.x** | 0.4.x or **0.5.0+** | works (URL signature) |
| **0.44+** | 0.4.x | `unauthorized` — even if web login on port 8765 works |
| **0.44+** | **0.5.0+** | works (session login, automatic fallback) |
| **0.43.x** | **0.5.0+** | still works (backward compatible upgrade) |

**Check version:** MotionEye web UI, `http://<host>:8765/version`, or datapoint `motioneye.<instance>._info.motionEyeVersion`.

**Upgrade:** Update the adapter to **0.5.0** or newer (npm or ioBroker Admin). No camera or MotionEye config changes required — host, username, and password stay the same.

---

### Device settings (`settings.*`)

From adapter **0.6.0** onwards, camera parameters live under `motioneye.<instance>.<camera>.settings.*` (e.g. `framerate`, `resolution`, `rotation`, `autoBrightness`, `privacyMask`). Values are read during the status poll and can be written via datapoints.

**Privacy mask (`settings.privacyMask`):**

1. Draw the **mask regions** once in the MotionEye web UI (Video Device → Privacy mask).
2. **Enable/disable** preferably only via the ioBroker datapoint `settings.privacyMask` — the adapter caches the drawn regions and re-sends them when enabling.
3. If you turn the mask **off directly in MotionEye**, MotionEye discards the regions. Then you must redraw the mask in MotionEye, wait for a poll (or restart the instance) so the adapter caches the lines again.
4. **Brightness/contrast/saturation/hue** are only available in MotionEye for local USB/v4l2 cameras, not for network (RTSP) cameras — therefore no datapoints in the adapter.

---

### Test connection (admin UI)

From the GitHub build / version **0.4.2** onwards, **Settings** includes a **Test connection** button. It checks host, port, username, and the **saved** password against `/config/list` — no SSH required.

**Requirements:**

- Adapter instance is **running**
- Settings saved (password must be stored in the instance)

**Steps:**

1. **Settings** → verify host, port `8765`, username, password → **Save**
2. Click **Test connection**
3. Result appears in the admin UI; details (camera count, MotionEye version) are written to the adapter log

| Result | Meaning |
|--------|---------|
| Success | API and credentials are OK — after an instance restart, `_info.connection` should become `true` |
| `unauthorized` | Saved password or username does not match the API — repeat the steps under `unauthorized` |

Optional: **Logs** tab → enable **detailed diagnostic logging** for API paths and HTTP status in the log (no password).

---

### API test via SSH (ioBroker host)

Isolates whether MotionEye accepts the credentials — independent of ioBroker password storage.

**Important:** Run the command on the **ioBroker host** (SSH into the ioBroker VM/LXC), **not** on the Proxmox host or MotionEye LXC. There `node` is often missing (`node: command not found`).

ioBroker ships its own Node — full path:

```bash
/opt/iobroker/node/bin/node -e "const {createMotionEyeApi}=require('/opt/iobroker/node_modules/iobroker.motioneye/lib/motionEyeApi');createMotionEyeApi({host:'192.168.1.10',motionEyePort:8765,username:'admin',password:'YOUR_PASSWORD',requestTimeoutMs:10000,listCacheMs:0}).getCameraList().then(c=>console.log('OK',c.length)).catch(e=>console.error('FAIL',e.message));"
```

Replace `192.168.1.10` and `YOUR_PASSWORD` (type the password manually).

| Output | Meaning |
|--------|---------|
| `OK 1` (or another number) | API + credentials are OK → problem is the **ioBroker instance** (encryption). Delete instance, create anew, type password manually |
| `FAIL unauthorized` | Web login is probably **not** on port **8765** with the same data — check the browser address bar when logging in |

**Docker ioBroker:** Run the command **inside the ioBroker container** (`docker exec -it <iobroker-container> bash`), adjust paths if needed.

---

### Install latest GitHub version

For fixes before the npm release (e.g. **Test connection**, trimming host/username/password):

```bash
cd /opt/iobroker
npm install inventwo/ioBroker.motioneye
iobroker upload motioneye
```

Then restart the adapter instance. The startup log line should show a current Git commit (not an old `#41a69ae` hash).

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
