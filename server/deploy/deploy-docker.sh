#!/usr/bin/env bash
# Deploy to the shared Hetzner box (nginx + Docker, no sudo): ./server/deploy/deploy-docker.sh [ssh-host]
# Default host is the "hetzner" entry in ~/.ssh/config. Secrets live in ~/agentic-os/.env on the server.
set -euo pipefail
HOST="${1:-hetzner}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/server"
tar czf - --exclude=./node_modules --exclude=./data --exclude=./.env --exclude=./test . \
  | ssh "$HOST" 'set -e; mkdir -p ~/agentic-os/server ~/agentic-os/data ~/agentic-os/backups
      rm -rf ~/agentic-os/server.new && mkdir ~/agentic-os/server.new
      tar xzf - -C ~/agentic-os/server.new
      rm -rf ~/agentic-os/server && mv ~/agentic-os/server.new ~/agentic-os/server'
ssh "$HOST" 'set -e; cd ~/agentic-os
  cp server/deploy/docker-compose.yml server/deploy/nginx-agentic-os.conf server/deploy/nginx-setup.sh .
  test -f .env || { echo "missing ~/agentic-os/.env (see server/.env.example)"; exit 1; }
  chmod 600 .env
  docker compose up -d --build
  for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3160/api/health && echo "  deployed" && exit 0; sleep 1; done
  docker compose logs --tail 40; exit 1'
