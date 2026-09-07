#!/usr/bin/env bash
# Pulls the latest Admin_Frontend code, rebuilds it, and restarts the live site on the Pi.
#
# Usage (from anywhere on the Pi):
#   bash ~/Capstone_Project/deploy/raspberry-pi/deploy-frontend.sh
# or, after adding the alias from this folder's README, just:
#   deploy-frontend
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

# The backend rewrites this file at runtime, so it always has local, uncommitted drift by the
# time a deploy happens. It's regenerated from live data, so it's always safe to discard —
# without this, `git pull` would abort with a merge conflict on every single deploy.
echo "==> Discarding local runtime-data drift"
git checkout -- Backend/Admin_Backend/data/live-dispatch.json 2>/dev/null || true

echo "==> Pulling latest code"
git pull origin master

echo "==> Building Admin_Frontend"
cd Frontend/Admin_Frontend
npm run build

echo "==> Restarting admin-frontend"
pm2 restart admin-frontend

echo "==> Deploy complete: $(date)"
