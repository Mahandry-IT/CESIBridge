# Planification du sync

Lance `npm run sync` (en `CESI_HEADLESS=true`) toutes les 2 h de 7 h à 21 h inclus, plus une fois à l'ouverture de session / au démarrage. Journal : `data/logs/sync.log` (horodaté, rotation à ~1 Mo vers `sync.log.1`). Deux exécutions simultanées sont empêchées (la seconde est ignorée).

Options des installeurs : `--interval 2 --start 7 --end 21` (Windows : `-IntervalHours -StartHour -EndHour`) ; `0 <= start <= end <= 23`, `interval >= 1`.

| Système                        | Installer                                                                     | Désinstaller                                     | Test immédiat                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Windows                        | `powershell -ExecutionPolicy Bypass -File scheduler\windows\install-task.ps1` | `... install-task.ps1 -Uninstall`                | `scheduler\windows\run-sync.bat` ou `Start-ScheduledTask -TaskName 'CESIBridge Sync'` |
| Linux (systemd)                | `scheduler/linux/install-systemd.sh`                                          | `scheduler/linux/install-systemd.sh --uninstall` | `systemctl --user start cesibridge-sync.service`                                      |
| Linux sans systemd, BSD (cron) | `scheduler/linux/install-cron.sh`                                             | `scheduler/linux/install-cron.sh --uninstall`    | `scheduler/unix/run-sync.sh`                                                          |
| macOS (launchd)                | `scheduler/macos/install-launchd.sh`                                          | `scheduler/macos/install-launchd.sh --uninstall` | `launchctl kickstart -k gui/$(id -u)/fr.cesibridge.sync`                              |

Journal : `data/logs/sync.log` sur tous les systèmes (macOS : sorties launchd dans `data/logs/launchd.log`).

## Prérequis

- Docker démarré, service PostgreSQL up (`docker compose up -d db`).
- `.env` rempli (`CESI_EMAIL`, `CESI_PASSWORD`, `DATABASE_URL`, ...).
- Session ENT valide une première fois via `npm run sync` ; le login ADFS n'est rejoué que si la session a expiré.
- Windows : la tâche ne s'exécute que session ouverte (Docker Desktop tourne en session). Linux : `sudo loginctl enable-linger "$USER"` pour tourner sans session.
- `node` est détecté à l'installation ; `NODE_BIN=/chemin/node` pour forcer (PATH minimal sous cron/launchd).
