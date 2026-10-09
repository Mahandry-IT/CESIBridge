#!/usr/bin/env bash
# Écran virtuel + VNC + noVNC, puis login manuel. Le conteneur s'arrête quand le login se termine.
# ⚠️ VNC sans mot de passe : le port 6080 ne doit être publié que sur 127.0.0.1 (voir compose.yaml).
set -euo pipefail

export DISPLAY=:99
readonly SCREEN="${SCREEN_GEOMETRY:-1280x800x24}"

Xvfb "$DISPLAY" -screen 0 "$SCREEN" -nolisten tcp &

for _ in $(seq 1 50); do
  [ -e /tmp/.X11-unix/X99 ] && break
  sleep 0.1
done
[ -e /tmp/.X11-unix/X99 ] || { echo "Xvfb n'a pas démarré" >&2; exit 1; }

x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -quiet &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &

echo "noVNC prêt : http://localhost:6080/vnc.html" >&2
exec node scripts/login.js
