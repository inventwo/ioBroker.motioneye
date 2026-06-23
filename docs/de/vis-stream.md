![Logo](../../admin/motioneye.png)

[zurück zur Dokumentations-Übersicht](README.md)

## Livestream in VIS (VIS1 / VIS2)

Empfohlen: **HTML-Widget** mit **Binding** auf `streamUrl`. Der Adapter schreibt dort ein fertiges `<img>`-Snippet — keine MotionEye-URL manuell eintragen.

### Schritte

1. **Stream einschalten** — `<kamera>.stream` auf `true` setzen oder `<kamera>.streamPulse` für Vorschau auslösen.
2. **HTML-Widget** in der VIS-View platzieren.
3. **Binding im HTML-Feld**, z. B.:

   ```
   {motioneye.0.garten.streamUrl}
   ```

   `0` durch Instanznummer und `garten` durch den Kamerakanal ersetzen (Kleinbuchstaben, siehe Objekte-Tab).

4. Nach Stream-Einschalten kurz warten — `streamUrl` aktualisiert sich, wenn der MJPEG-Port bereit ist.
5. **Optional:** Schalter-Widget auf `<kamera>.stream` binden.

### Hinweise

- `streamUrl` ist schreibgeschützt und aktualisiert sich automatisch.
- **HTTPS in VIS + HTTP bei MotionEye:** Browser kann Mixed Content blockieren.
- Multi-Kamera-Dashboards: Der Adapter kann Geschwister-Streams nach VIS-Neurendern neu verknüpfen.
