![Logo](../../admin/motioneye.png)

### ioBroker-Adapter für MotionEye

## Dokumentation

- [Einstellungen](settings.md)
- [Kameras](cameras.md)
- [Kameramodi](modes.md)
- [Schutzstufe (VIS)](alert-level.md)
- [Datenpunkte](datapoints.md)
- [Livestream in VIS](vis-stream.md)
- [Hilfe & FAQ](faq.md)

#### ioBroker-Voraussetzungen

1. Node.js 22 oder neuer
2. js-controller 6.0.11 oder neuer
3. Admin-Adapter 7.6.20 oder neuer

#### MotionEye-Voraussetzungen

1. MotionEye mit Config-API auf Port **8765** (Standard)
2. **MotionEye 0.44+:** Adapter **0.5.0** oder neuer (Session-Login) — siehe [FAQ](faq.md#motioneye-044-adapter-050)

## Schnellstart

- Pro MotionEye-Server eine Adapter-Instanz anlegen.
- Unter **Einstellungen**: MotionEye-Host, Zugangsdaten und **Webhook-Host** setzen (ioBroker-IP, von MotionEye aus erreichbar).
- Unter **Kameras**: Kameras eintragen oder **Kameras aus MotionEye laden**, speichern und Instanz neu starten.
- `motioneye.<Instanz>._info.connection` prüfen — sollte `true` sein, wenn MotionEye erreichbar ist.
- Livebild in VIS: HTML-Widget mit Binding auf `<kamera>.streamUrl` (siehe [Livestream in VIS](vis-stream.md)).
