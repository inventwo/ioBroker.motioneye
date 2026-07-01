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
5. **MotionEye Config-API-Port** ist **8765** — nicht 7999 (Motion-HTTP) und nicht der Port der Weboberfläche hinter einem Reverse-Proxy ohne Weiterleitung der API.

**Erfolg:** `_info.connection` = `true`, keine `unauthorized`-Warnungen im Log.

#### Web-Login klappt, Adapter zeigt trotzdem `unauthorized`

Wenn du dich im Browser anmelden kannst, der Adapter aber `GET /config/list → HTTP 403: unauthorized` meldet, liegt es fast nie an „falschem Host“, sondern an **unterschiedlichen Zugangsdaten** oder **falscher API-Adresse**:

1. **Gleicher Port wie der Adapter:** Web-Login muss unter `http://<motionHost>:8765/` funktionieren — nicht nur unter `:7999`, `:80`, `:443` oder einer anderen URL.
2. **Gleicher Benutzer:** Der Wert unter **MotionEye-Benutzer** muss exakt dem Admin-User in MotionEye entsprechen (Groß/Klein, oft `admin`).
3. **Passwort in ioBroker:** Feld komplett leeren → **Speichern** → Instanz neu starten → Passwort **von Hand** tippen (nicht kopieren) → **Speichern** → neu starten. Hilft bei kaputter Verschlüsselung oder unsichtbaren Leerzeichen.
4. **Zwei verschiedene Server:** ioBroker und MotionEye auf getrennten VMs/LXCs (z. B. Proxmox) ist normal — SSH-Tests und `node` gehören auf den **ioBroker-Host**, nicht auf den MotionEye-Container.
5. **MotionEye 0.44 oder neuer:** Ab MotionEye **0.44** nutzt die API **Session-Login** statt URL-Signatur. Dafür brauchst du Adapter **0.5.0** oder neuer — mit **0.4.x** bleibt `unauthorized`, obwohl der Web-Login klappt. Siehe Abschnitt [MotionEye 0.44+](#motioneye-044-adapter-050).

---

### MotionEye 0.44+ (Adapter 0.5.0+)

Ab **MotionEye 0.44** hat sich die API-Authentifizierung geändert: Statt `_username` / `_signature` in der URL meldet sich der Client per **`POST /login`** an und nutzt ein Session-Cookie ([Release Notes](https://github.com/motioneye-project/motioneye/releases/tag/0.44.0)).

| MotionEye | Adapter | Ergebnis |
|-----------|---------|----------|
| **0.43.x** | 0.4.x oder **0.5.0+** | funktioniert (URL-Signatur) |
| **0.44+** | 0.4.x | `unauthorized` — auch wenn Web-Login auf Port 8765 klappt |
| **0.44+** | **0.5.0+** | funktioniert (Session-Login, automatischer Fallback) |
| **0.43.x** | **0.5.0+** | funktioniert weiterhin (Rückwärtskompatibilität) |

**Version prüfen:** MotionEye-Weboberfläche, `http://<host>:8765/version` oder Datenpunkt `motioneye.<Instanz>._info.motionEyeVersion`.

**Upgrade:** Adapter auf **0.5.0** oder neuer aktualisieren (npm oder ioBroker Admin). Keine Änderung an Kameras oder MotionEye-Config nötig — Host, Benutzer und Passwort bleiben gleich.

---

### Verbindung testen (Admin)

Ab GitHub-Stand / Version **0.4.2** gibt es unter **Einstellungen** den Button **Verbindung testen**. Er prüft Host, Port, Benutzer und das **gespeicherte** Passwort gegen `/config/list` — ohne SSH.

**Voraussetzungen:**

- Adapter-Instanz **läuft**
- Einstellungen gespeichert (Passwort muss in der Instanz hinterlegt sein)

**Ablauf:**

1. **Einstellungen** → Host, Port `8765`, Benutzer, Passwort prüfen → **Speichern**
2. **Verbindung testen** klicken
3. Ergebnis in der Admin-Meldung; Details (Kameraanzahl, MotionEye-Version) stehen im Adapter-Log

| Ergebnis | Bedeutung |
|----------|-----------|
| Erfolg | API und Zugangsdaten stimmen — nach Instanz-Neustart sollte `_info.connection` = `true` werden |
| `unauthorized` | Gespeichertes Passwort oder Benutzer passt nicht zur API — Schritte unter `unauthorized` wiederholen |

Optional: Tab **Protokolle** → **detaillierte Diagnoseprotokollierung** aktivieren — dann siehst du API-Pfade und HTTP-Status im Log (ohne Passwort).

---

### API-Test per SSH (ioBroker-Host)

Isoliert, ob MotionEye die Zugangsdaten akzeptiert — unabhängig von der ioBroker-Passwort-Speicherung.

**Wichtig:** Den Befehl auf dem **ioBroker-Host** ausführen (z. B. per SSH auf die ioBroker-VM/LXC), **nicht** auf Proxmox-Host oder MotionEye-LXC. Dort fehlt `node` oft (`node: command not found`).

ioBroker bringt Node mit — voller Pfad:

```bash
/opt/iobroker/node/bin/node -e "const {createMotionEyeApi}=require('/opt/iobroker/node_modules/iobroker.motioneye/lib/motionEyeApi');createMotionEyeApi({host:'192.168.1.10',motionEyePort:8765,username:'admin',password:'DEIN_PASSWORT',requestTimeoutMs:10000,listCacheMs:0}).getCameraList().then(c=>console.log('OK',c.length)).catch(e=>console.error('FAIL',e.message));"
```

`192.168.1.10` und `DEIN_PASSWORT` anpassen (Passwort von Hand einsetzen).

| Ausgabe | Bedeutung |
|---------|-----------|
| `OK 1` (oder andere Zahl) | API + Zugangsdaten stimmen → Problem liegt an der **ioBroker-Instanz** (Verschlüsselung). Instanz löschen, neu anlegen, Passwort von Hand tippen |
| `FAIL unauthorized` | Web-Login läuft vermutlich **nicht** auf Port **8765** mit denselben Daten — Browser-Adresszeile beim Login prüfen |

**Docker-ioBroker:** Befehl **im ioBroker-Container** ausführen (`docker exec -it <iobroker-container> bash`), Pfade ggf. anpassen.

---

### Aktuelle GitHub-Version installieren

Für Fixes vor dem npm-Release (z. B. **Verbindung testen**, Trim von Host/Benutzer/Passwort):

```bash
cd /opt/iobroker
npm install inventwo/ioBroker.motioneye
iobroker upload motioneye
```

Danach die Adapter-Instanz neu starten. In der Log-Startzeile sollte ein aktueller Git-Commit stehen (nicht mehr ein alter `#41a69ae`-Hash).

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
