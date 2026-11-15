#!/usr/bin/env bash
# Nightly SQLite backup. Keeps 14 days. Works for both setups:
#   Docker on the shared box (current):  15 3 * * * ~/agentic-os/server/deploy/backup.sh
#   Dedicated server (systemd, /srv):    15 3 * * * /srv/agentic-os/server/deploy/backup.sh
# Override with AOS_ROOT=/path if the app lives somewhere else.
set -euo pipefail
if [ -n "${AOS_ROOT:-}" ]; then ROOT="$AOS_ROOT"
elif [ -f "$HOME/agentic-os/data/agentic.db" ]; then ROOT="$HOME/agentic-os"
else ROOT=/srv/agentic-os; fi
# Docker keeps the database in ~/agentic-os/data, the systemd setup in /srv/agentic-os/server/data.
if [ -f "$ROOT/data/agentic.db" ]; then DATA="$ROOT/data"; else DATA="$ROOT/server/data"; fi
DEST="$ROOT/backups"
OUT="$DEST/agentic-$(date +%F).db"
mkdir -p "$DEST"
[ -f "$DATA/agentic.db" ] || { echo "backup: no database at $DATA/agentic.db" >&2; exit 1; }

if command -v sqlite3 >/dev/null; then
  sqlite3 "$DATA/agentic.db" ".backup '$OUT'"
elif docker inspect agentic-os >/dev/null 2>&1; then
  # No sqlite3 on the host: let the container's Node write a consistent copy into its /data volume, then move it.
  rm -f "$DATA/.backup-tmp.db"
  docker exec agentic-os node --experimental-sqlite --disable-warning=ExperimentalWarning -e \
    "new (require('node:sqlite').DatabaseSync)('/data/agentic.db').exec(\"VACUUM INTO '/data/.backup-tmp.db'\")"
  mv "$DATA/.backup-tmp.db" "$OUT"
else
  echo "backup: needs sqlite3 on the host or the agentic-os container running" >&2; exit 1
fi
find "$DEST" -name 'agentic-*.db' -mtime +14 -delete
echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"
# Optional off-site copy to a Hetzner Storage Box:
# rsync -e 'ssh -p 23' -a "$DEST/" u123456@u123456.your-storagebox.de:agentic-os/
