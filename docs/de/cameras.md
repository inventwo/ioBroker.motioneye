![Logo](../../admin/motioneye.png)

[zurück zur Dokumentations-Übersicht](README.md)

## Tab Kameras

| Spalte | Beschreibung |
|--------|--------------|
| Anzeigename | Anzeige in ioBroker; Kanalordner in **Kleinbuchstaben** (z. B. `Garten` → `garten`) |
| MotionEye-ID | Numerische ID aus MotionEye Web-UI → Videogerät → Kamera-ID, oder `/config/list` |
| Interne ID | Stabiler Webhook-Schlüssel (z. B. `auffahrt`); leer = aus Anzeigename abgeleitet |
| Medien-Ordner | Optional unter `/var/lib/motioneye`; wird beim Adapterstart gesetzt |
| Aktiv | Deaktivieren, um Kamera zu überspringen |

### Kameras aus MotionEye laden

Die Instanz muss **laufen**. Der Button führt `/config/list` in die Tabelle ein, ohne bestehende Zeilen zu löschen. Nach dem Hinzufügen speichern und neu starten.

Nach dem Neustart legt der Adapter Datenpunkte an und schreibt Webhook-URLs nach MotionEye.
