#!/usr/bin/env bash
# Installe un timer systemd utilisateur qui lance scheduler/unix/run-sync.sh.
# Usage : install-systemd.sh [--interval 2] [--start 7] [--end 21] | --uninstall
# Pour tourner sans session ouverte : sudo loginctl enable-linger "$USER"
set -eu

INTERVAL=2 START=7 END=21 UNINSTALL=0
die() { echo "Erreur : $*" >&2; exit 1; }
int() { case "$2" in '' | *[!0-9]*) die "$1 doit être un entier (reçu : '$2')" ;; esac; }

while [ $# -gt 0 ]; do
  case "$1" in
    --interval) [ $# -ge 2 ] || die "--interval attend une valeur"; INTERVAL=$2; shift 2 ;;
    --start) [ $# -ge 2 ] || die "--start attend une valeur"; START=$2; shift 2 ;;
    --end) [ $# -ge 2 ] || die "--end attend une valeur"; END=$2; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) die "option inconnue : $1" ;;
  esac
done

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
NAME=cesibridge-sync

command -v systemctl >/dev/null 2>&1 || die "systemctl introuvable (pas de systemd ? utiliser install-cron.sh)"

if [ "$UNINSTALL" -eq 1 ]; then
  systemctl --user disable --now "$NAME.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$NAME.timer" "$UNIT_DIR/$NAME.service"
  systemctl --user daemon-reload
  echo "Timer $NAME supprimé."
  exit 0
fi

int --interval "$INTERVAL"; int --start "$START"; int --end "$END"
[ "$INTERVAL" -ge 1 ] || die "--interval doit être >= 1"
[ "$START" -ge 0 ] && [ "$END" -le 23 ] && [ "$START" -le "$END" ] || die "il faut 0 <= --start <= --end <= 23"
INTERVAL=$((10#$INTERVAL)); START=$((10#$START)); END=$((10#$END))

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
RUNNER="$ROOT/scheduler/unix/run-sync.sh"
[ -f "$RUNNER" ] || die "introuvable : $RUNNER"
NODE=${NODE_BIN:-$(command -v node || true)}
[ -n "$NODE" ] && [ -x "$NODE" ] || die "node introuvable : définir NODE_BIN ou l'ajouter au PATH"

# Valeurs entre guillemets (espaces) : \ et " échappés, % doublé (spécificateurs systemd).
esc_env() { printf '%s' "$1" | sed -e 's/%/%%/g' -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
# ExecStart développe aussi les variables : $ y est en plus doublé.
esc_exec() { esc_env "$1" | sed -e 's/\$/$$/g'; }

if [ "$START" -eq "$END" ] || [ "$INTERVAL" -gt $((END - START)) ]; then
  CAL=$(printf '*-*-* %02d:00:00' "$START")
else
  # Liste explicite des heures (07,09,…) : la syntaxe plage/pas n'est pas gérée par tous les systemd.
  HOURS=$(seq "$START" "$INTERVAL" "$END" | awk '{ printf "%s%02d", (NR > 1 ? "," : ""), $1 }')
  CAL="*-*-* $HOURS:00:00"
fi

mkdir -p "$UNIT_DIR"
cat >"$UNIT_DIR/$NAME.service" <<EOF
[Unit]
Description=CESIBridge : synchronisation de l'emploi du temps
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
# Pas de WorkingDirectory : run-sync.sh se place lui-même à la racine du dépôt.
Environment="NODE_BIN=$(esc_env "$NODE")"
ExecStart="$(esc_exec "$RUNNER")"
TimeoutStartSec=15min
EOF

cat >"$UNIT_DIR/$NAME.timer" <<EOF
[Unit]
Description=CESIBridge : planning de synchronisation

[Timer]
OnCalendar=$CAL
OnStartupSec=2min
Persistent=true
Unit=$NAME.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$NAME.timer"

echo "Timer installé : OnCalendar=$CAL + 2 min après le démarrage."
echo "Tester     : systemctl --user start $NAME.service"
echo "Statut     : systemctl --user list-timers $NAME.timer"
echo "Journal    : $ROOT/data/logs/sync.log (journalctl --user -u $NAME.service)"
echo "Sans session ouverte : sudo loginctl enable-linger \"$USER\""
