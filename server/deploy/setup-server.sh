#!/usr/bin/env bash
# One-time setup on a fresh Hetzner Ubuntu/Debian server. Run as root.
set -euo pipefail
apt-get update
apt-get install -y curl ca-certificates gnupg sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
# Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
# user + folders
id agentic >/dev/null 2>&1 || useradd --system --home /srv/agentic-os --shell /usr/sbin/nologin agentic
mkdir -p /srv/agentic-os/server/data /srv/agentic-os/www /srv/agentic-os/backups
chown -R agentic:agentic /srv/agentic-os
# firewall
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades
echo "Now: put /etc/agentic-os.env in place (see server/.env.example), then run deploy.sh from your PC."
