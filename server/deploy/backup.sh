#!/usr/bin/env bash
# Nightly SQLite backup (cron: 15 3 * * * /srv/agentic-os/server/deploy/backup.sh). Keeps 14 days.
set -euo pipefail
DATA=/srv/agentic-os/server/data
DEST=/srv/agentic-os/backups
mkdir -p "$DEST"
sqlite3 "$DATA/agentic.db" ".backup '$DEST/agentic-$(date +%F).db'"
find "$DEST" -name 'agentic-*.db' -mtime +14 -delete
# Optional off-site copy to a Hetzner Storage Box:
# rsync -e 'ssh -p 23' -a "$DEST/" u123456@u123456.your-storagebox.de:agentic-os/
