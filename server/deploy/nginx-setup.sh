#!/usr/bin/env bash
# One-time, on the shared Hetzner box: sudo bash ~/agentic-os/nginx-setup.sh
# Adds the nginx site for agentic-os.serviweb.ch and gets a Let's Encrypt cert. Touches nothing else.
set -euo pipefail
SITE=agentic-os.serviweb.ch
SRC="$(dirname "$0")/nginx-agentic-os.conf"
cp "$SRC" /etc/nginx/sites-available/$SITE
ln -sf /etc/nginx/sites-available/$SITE /etc/nginx/sites-enabled/$SITE
nginx -t
systemctl reload nginx
certbot --nginx -d $SITE --non-interactive --agree-tos --redirect --keep-until-expiring
nginx -t && systemctl reload nginx
curl -fsS https://$SITE/api/health && echo "  <- $SITE is live"
