#!/usr/bin/env bash
# Installe des lignes crontab (distributions sans systemd, BSD) pour scheduler/unix/run-sync.sh.
# Usage : install-cron.sh [--interval 2] [--start 7] [--end 21] | --uninstall
# Les lignes gérées portent le marqueur "# cesibridge-sync" ; les autres lignes sont conservées.
set -eu

INTERVAL=2 START=7 END=21 UNINSTALL=0
MARK='# cesibridge-sync'
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

command -v crontab >/dev/null 2>&1 || die "crontab introuvable"

# Crontab actuel sans nos lignes (crontab -l échoue s'il est vide).
current=$(crontab -l 2>/dev/null | grep -vF "$MARK" || true)

if [ "$UNINSTALL" -eq 1 ]; then
  printf '%s\n' "$current" | sed '/^$/d' | crontab -
  echo "Lignes cesibridge-sync supprimées du crontab."
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

# Quote pour sh (apostrophes) puis échappe % (spécial dans crontab).
shq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
cq() { printf '%s' "$1" | sed 's/%/\\%/g'; }

if [ "$START" -eq "$END" ] || [ "$INTERVAL" -gt $((END - START)) ]; then
  HOURS="$START"
elif [ "$INTERVAL" -eq 1 ]; then
  HOURS="$START-$END"
else
  HOURS="$START-$END/$INTERVAL"
fi

CMD="NODE_BIN=$(shq "$NODE") $(shq "$RUNNER") >/dev/null 2>&1"
{
  [ -n "$current" ] && printf '%s\n' "$current"
  printf '0 %s * * * %s %s\n' "$HOURS" "$(cq "$CMD")" "$MARK"
  printf '@reboot sleep 120 && %s %s\n' "$(cq "$CMD")" "$MARK"
} | crontab -

echo "Crontab mis à jour : à 0 min des heures $HOURS + 2 min après le démarrage."
echo "Tester     : NODE_BIN=$(shq "$NODE") $(shq "$RUNNER")"
echo "Vérifier   : crontab -l | grep cesibridge-sync"
echo "Journal    : $ROOT/data/logs/sync.log"
