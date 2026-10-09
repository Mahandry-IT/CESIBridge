#!/bin/sh
# Lance `scripts/sync.js` en tâche planifiée (Linux, macOS, BSD).
# Journal : data/logs/sync.log (rotation à ~1 Mo). Une seule exécution à la fois.
# Variable optionnelle : NODE_BIN (chemin absolu de node ; PATH minimal sous cron/launchd).
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd)
LOG_DIR="$ROOT/data/logs"
LOG="$LOG_DIR/sync.log"
LOCK="$LOG_DIR/sync.lock"
MAX_BYTES=1048576

mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"
}

# Rotation simple : sync.log -> sync.log.1 (l'ancien est écrasé).
if [ -f "$LOG" ]; then
  size=$(wc -c <"$LOG" | tr -d ' ')
  if [ "$size" -gt "$MAX_BYTES" ]; then
    mv -f "$LOG" "$LOG.1"
  fi
fi

NODE=${NODE_BIN:-}
if [ -z "$NODE" ]; then
  NODE=$(command -v node || true)
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  log "ERREUR node introuvable : définir NODE_BIN (chemin absolu) ou ajouter node au PATH"
  echo "node introuvable : définir NODE_BIN ou ajouter node au PATH" >&2
  exit 127
fi

# Verrou : flock si disponible, sinon répertoire créé atomiquement.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  if ! flock -n 9; then
    log "SKIP une exécution est déjà en cours"
    exit 0
  fi
else
  LOCK_DIR="$LOCK.d"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    old_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      log "SKIP une exécution est déjà en cours (pid $old_pid)"
      exit 0
    fi
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
  fi
  echo "$$" >"$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
  trap 'exit 130' INT TERM HUP
fi

OUT=$(mktemp "${TMPDIR:-/tmp}/cesibridge-sync.XXXXXX")
cleanup_out() { rm -f "$OUT"; }
if [ -n "${LOCK_DIR:-}" ]; then
  trap 'rm -f "$OUT"; rm -rf "$LOCK_DIR"' EXIT
else
  trap cleanup_out EXIT
fi

log "DEBUT sync (node $NODE)"
cd "$ROOT"
rc=0
CESI_HEADLESS=true "$NODE" --env-file-if-exists=.env scripts/sync.js >"$OUT" 2>&1 || rc=$?

while IFS= read -r line || [ -n "$line" ]; do
  log "  $line"
done <"$OUT"
log "FIN sync (code $rc)"

exit "$rc"
