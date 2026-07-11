![Logo](../../admin/motioneye.png)

[zurück zur Dokumentations-Übersicht](README.md)

## Kameramodi

| Modus | Bewegungserkennung | Videoaufnahme | Webhook an ioBroker |
|-------|-------------------|---------------|---------------------|
| `off` | nein | nein | nein |
| `still` | ja | nein | ja |
| `sharp` | ja | MP4 bei Bewegung | ja |

Modus über Datenpunkt `<kamera>.mode` oder Skripte setzen. Der Adapter schreibt die MotionEye-Config, wenn **MotionEye über Config-API steuern** aktiv ist.

Für **ein VIS-Dropdown** inkl. Telegram-bei-Bewegung [`alertLevel`](alert-level.md) nutzen (`off` / `motion` / `notify` / `record` / `full`). Der Datenpunkt `mode` wird mitgeführt.
