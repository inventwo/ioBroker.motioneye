![Logo](../../admin/motioneye.png)

### ioBroker-Adapter für MotionEye

[zurück zur Dokumentations-Übersicht](README.md)

## Hilfe & FAQ

Typische Fragen und Log-Meldungen aus dem Alpha-Test.

---

### Log zeigt `unauthorized`

MotionEye ist erreichbar, aber Login oder API-Signatur schlägt fehl.

**Prüfen:**

1. Instanz-Einstellungen öffnen, **MotionEye-Benutzer** und **Passwort** neu eintragen, **Speichern**, Instanz neu starten.
2. Seit Adapter-Update 0.2.1 wird das Passwort verschlüsselt gespeichert — ein alter Klartext-Wert funktioniert ggf. erst nach erneutem Speichern wieder.
3. Hat MotionEye **kein Passwort**, Feld leer lassen (keine Leerzeichen).
4. Benutzername exakt wie in MotionEye (oft `admin`).

**Erfolg:** `_info.connection` = `true`, keine `unauthorized`-Warnungen im Log.

---

### Log zeigt `EHOSTUNREACH` oder `ECONNREFUSED` (Docker / Unraid)

Der ioBroker-Container erreicht `motionHost:8765` auf Netzwerkebene nicht — **kein** Passwort-Problem.

**Prüfen:**

1. Vom **ioBroker-Container** aus testen, nicht vom PC:

   ```bash
   docker exec -it <iobroker-container> sh
   wget -O- http://<motionHost>:8765/ 2>&1 | head
   ```

2. **motionHost** muss vom **ioBroker-Container** aus erreichbar sein:
   - Gleiches Docker-Custom-Network → Container-Name (z. B. `motioneye`)
   - Sonst Unraid/Host-IP, wenn vom Container geroutet
   - `192.168.x.x` im PC-Browser garantiert nicht Erreichbarkeit aus dem Container

3. MotionEye-Docker-Template: Port **8765** published?
4. **webhookHost** ist getrennt — MotionEye muss ioBroker auf Port **8090** für Bewegungs-Webhooks erreichen.

---

### `_info.connection` bleibt `false`

- Falscher **motionHost** oder **motionEyePort** (8765, nicht 7999)
- Firewall zwischen ioBroker und MotionEye
- MotionEye läuft nicht
- Docker/Netzwerk-Problem (siehe oben)

---

### Kein Stream-Bild in VIS

1. `<kamera>.stream` auf `true` setzen (oder `streamPulse` auslösen).
2. HTML-Widget mit Binding, z. B. `{motioneye.0.garten.streamUrl}` — Kanalordner in Kleinbuchstaben.
3. Nach Stream-Einschalten kurz warten.
4. **HTTPS in VIS + HTTP bei MotionEye:** Browser kann Mixed Content blockieren.

Schritt-für-Schritt: [Livestream in VIS](vis-stream.md).

---

### Bewegung in ioBroker, aber nicht in MotionEye (oder umgekehrt)

**MotionEye über Config-API steuern** aktiviert lassen. Der Adapter schreibt Modus, Webhooks und Stream nach MotionEye. Wenn deaktiviert, empfängt ioBroker nur Webhooks ohne Config-Sync.

---

### Wo finde ich ausführliche Logs?

Log-Level der Instanz auf **Debug** setzen, Fehler reproduzieren, unter **Log** in ioBroker Admin prüfen. Für Forum-Posts `_info.connection` und die erste Fehlerzeile mitschicken.
