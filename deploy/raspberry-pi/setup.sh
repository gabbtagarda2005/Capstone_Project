#!/usr/bin/env bash
# Run ON the Raspberry Pi (SSH in first). Idempotent — safe to re-run.
#
# What this does:
#   1. Installs Node.js 18+ (Admin_Backend's minimum, per package.json "engines").
#   2. Installs npm dependencies for Backend/Admin_Backend.
#   3. Installs Tailscale (for the public HTTPS address via Funnel — see README.md in this folder).
#   4. Installs the admin-backend systemd service so it survives reboots.
#
# What this does NOT do (do these manually first — both are gitignored, so `git clone` won't bring them):
#   - Copy Backend/Admin_Backend/.env to the Pi (scp it from your dev machine).
#   - Copy Backend/Admin_Backend/secrets/*.json (Firebase service account) to the Pi.
#   - `tailscale up` / enable Funnel (needs interactive browser login — see README.md).
#
# Usage: ./setup.sh /path/to/Capstone-Project/Backend/Admin_Backend

set -euo pipefail

BACKEND_DIR="${1:-$HOME/Capstone-Project/Backend/Admin_Backend}"

if [ ! -f "$BACKEND_DIR/package.json" ]; then
  echo "error: $BACKEND_DIR/package.json not found." >&2
  echo "Clone the repo on the Pi first, then pass the Admin_Backend path as arg 1." >&2
  exit 1
fi

echo "==> Backend dir: $BACKEND_DIR"

if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "==> Installing Node.js 20.x (NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "==> Node.js already installed: $(node -v)"
fi

echo "==> Installing npm dependencies…"
(cd "$BACKEND_DIR" && npm install --omit=dev)

if ! command -v tailscale >/dev/null 2>&1; then
  echo "==> Installing Tailscale…"
  curl -fsSL https://tailscale.com/install.sh | sh
else
  echo "==> Tailscale already installed: $(tailscale version | head -n1)"
fi

echo "==> Installing systemd service (admin-backend.service)…"
SERVICE_SRC="$(dirname "$0")/admin-backend.service"
TMP_SERVICE="/tmp/admin-backend.service"
sed \
  -e "s#WorkingDirectory=.*#WorkingDirectory=$BACKEND_DIR#" \
  -e "s#User=.*#User=$(whoami)#" \
  "$SERVICE_SRC" > "$TMP_SERVICE"
sudo mv "$TMP_SERVICE" /etc/systemd/system/admin-backend.service
sudo systemctl daemon-reload
sudo systemctl enable admin-backend

echo ""
echo "==> Done. Remaining manual steps:"
echo "    1. Confirm $BACKEND_DIR/.env and $BACKEND_DIR/secrets/*.json are in place."
echo "    2. sudo systemctl start admin-backend   # then: sudo systemctl status admin-backend"
echo "    3. sudo tailscale up                    # interactive login"
echo "    4. sudo tailscale funnel --bg 4001       # exposes it publicly over HTTPS"
echo "    5. tailscale funnel status               # prints the public https://*.ts.net address"
echo "    See README.md in this folder for details on steps 3-5."
