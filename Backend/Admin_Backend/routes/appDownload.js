/**
 * Serves the built Bus Attendant Android APK — the "Download the Attendant App" card on the
 * admin landing page and its QR code both point here. The APK itself isn't committed to git
 * (data/app-downloads/ is gitignored, same pattern as daily-ops-snapshots/); it's rebuilt and
 * copied in as attendant-app-latest.apk whenever a new version ships.
 *
 * IMPORTANT — always pass the production API/socket URLs, or the built app silently falls
 * back to http://localhost:4001 (which is the *phone itself* on a real device, so login just
 * fails with "No connection to http://localhost:4001"). From Frontend/BusAttendant_Frontend:
 *
 *   flutter build apk --release \
 *     --dart-define=API_BASE_URL=https://smartscreensystem.online \
 *     --dart-define=ADMIN_SOCKET_URL=https://smartscreensystem.online
 *
 * (smartscreensystem.online serves both the web frontend and Admin_Backend's /api and
 * /socket.io routes at the same origin — confirm that's still true before reusing this URL
 * if the deployment topology ever changes.) Then copy build/app/outputs/flutter-apk/
 * app-release.apk to data/app-downloads/attendant-app-latest.apk on this server.
 */
const express = require("express");
const path = require("path");
const fs = require("fs");

const APK_PATH = path.join(__dirname, "..", "data", "app-downloads", "attendant-app-latest.apk");

function createAppDownloadRouter() {
  const r = express.Router();

  r.get("/attendant-app", (_req, res) => {
    if (!fs.existsSync(APK_PATH)) {
      return res.status(404).json({ error: "Attendant app build not available yet." });
    }
    res.download(APK_PATH, "BukidnonBusAttendant.apk", (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Could not send APK" });
      }
    });
  });

  return r;
}

module.exports = { createAppDownloadRouter };
