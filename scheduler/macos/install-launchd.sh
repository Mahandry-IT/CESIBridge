#!/usr/bin/env bash
# Installe un LaunchAgent qui lance scheduler/unix/run-sync.sh.
# Usage : install-launchd.sh [--interval 2] [--start 7] [--end 21] | --uninstall
set -eu

INTERVAL=2 START=7 END=21 UNINSTALL=0
LABEL=fr.cesibridge.sync
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
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

DOMAIN="gui/$(id -u)"
unload() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
}

if [ "$UNINSTALL" -eq 1 ]; then
  unload
  rm -f "$PLIST"
  echo "LaunchAgent $LABEL supprimé."
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

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

mkdir -p "$ROOT/data/logs" "$(dirname "$PLIST")"
LAUNCHD_LOG="$ROOT/data/logs/launchd.log"

{
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$(xml "$RUNNER")</string></array>
  <key>WorkingDirectory</key><string>$(xml "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_BIN</key><string>$(xml "$NODE")</string>
    <key>PATH</key><string>$(xml "$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key>
  <array>
EOF
  h=$START
  while [ "$h" -le "$END" ]; do
    printf '    <dict><key>Hour</key><integer>%d</integer><key>Minute</key><integer>0</integer></dict>\n' "$h"
    h=$((h + INTERVAL))
  done
  cat <<EOF
  </array>
  <key>StandardOutPath</key><string>$(xml "$LAUNCHD_LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LAUNCHD_LOG")</string>
</dict>
</plist>
EOF
} >"$PLIST"

if command -v plutil >/dev/null 2>&1; then plutil -lint "$PLIST" >/dev/null || die "plist invalide : $PLIST"; fi

unload
launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

echo "LaunchAgent installé : $PLIST (heures $START à $END, pas de $INTERVAL, + à l'ouverture de session)."
echo "Tester     : launchctl kickstart -k $DOMAIN/$LABEL"
echo "Journal    : $ROOT/data/logs/sync.log (sorties launchd : $LAUNCHD_LOG)"
