#!/usr/bin/env bash
# Deploy from your PC: ./server/deploy/deploy.sh root@<hetzner-ip> [--web]
set -euo pipefail
HOST="${1:?usage: deploy.sh user@host [--web]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
rsync -az --delete --exclude node_modules --exclude data --exclude .env "$ROOT/server/" "$HOST:/srv/agentic-os/server/"
if [[ "${2:-}" == "--web" ]]; then
  (cd "$ROOT" && npm run build)
  rsync -az --delete "$ROOT/www/" "$HOST:/srv/agentic-os/www/"
fi
ssh "$HOST" 'set -e
  cd /srv/agentic-os/server
  npm ci --omit=dev
  chown -R agentic:agentic /srv/agentic-os
  sudo -u agentic env $(grep -v "^#" /etc/agentic-os.env | xargs) node --experimental-sqlite --disable-warning=ExperimentalWarning src/migrate.js
  cp deploy/agentic-os.service /etc/systemd/system/agentic-os.service
  cp deploy/Caddyfile /etc/caddy/Caddyfile
  systemctl daemon-reload && systemctl enable --now agentic-os && systemctl restart agentic-os
  systemctl reload caddy
  sleep 2 && curl -fsS http://127.0.0.1:8787/api/health && echo " deployed"'
