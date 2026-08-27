/**
 * Serves the built Bus Attendant Android APK — the "Download the Attendant App" card on the
 * admin landing page and its QR code both point here. The APK itself isn't committed to git
 * (data/app-downloads/ is gitignored, same pattern as daily-ops-snapshots/); it's built with
 * `flutter build apk --release` in Frontend/BusAttendant_Frontend and copied in as
 * attendant-app-latest.apk whenever a new version ships.
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
