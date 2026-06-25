![Logo](../../admin/motioneye.png)

[zurück zur Dokumentations-Übersicht](README.md)

## Datenpunkte

### Pro Kamera (`motioneye.<Instanz>.<kanal>.*`)

Kanalnamen in Kleinbuchstaben (z. B. `garten`, `innenhof_ii`).

| Datenpunkt | Lesen | Schreiben | Beschreibung |
|------------|-------|-----------|--------------|
| `mode` | ja | ja | `off` / `still` / `sharp` |
| `motion` | ja | nein | Bewegung erkannt (Auto-Reset) |
| `snapshot` | nein | ja | Snapshot auslösen (Button) |
| `stream` | ja | ja | Live-MJPEG-Stream ein/aus |
| `streamPulse` | nein | ja | Kurzer Stream-Impuls (Button) |
| `streamUrl` | ja | nein | Fertiges HTML für HTML-Widgets |
| `status` | ja | nein | Letzte Sync-Meldung / Fehler |
| `webhookUrl` | ja | nein | In MotionEye geschriebene URL |

### Instanz-Info (`motioneye.<Instanz>._info.*`)

| Datenpunkt | Beschreibung |
|------------|--------------|
| `_info.connection` | `true`, wenn MotionEye Config-API erreichbar |
| `_info.camerasOnline` | Aktive Kameras in MotionEye gefunden |
| `_info.lastSync` | Zeitstempel letzter Poll |
| `_info.motionEyeVersion` | MotionEye-Version |
| `_info.motionVersion` | Motion-Daemon-Version |
