const express = require("express");
const SecurityLog = require("../models/SecurityLog");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");

function createSecurityLogsRouter() {
  const router = express.Router();
  router.use(requireAdminJwt);

  router.post("/", async (req, res) => {
    try {
      const {
        type = "geofence_breach",
        busId,
        message,
        severity = "critical",
        latitude,
        longitude,
        assignedRoute,
        currentTerminal,
        source = "admin_portal",
      } = req.body ?? {};
      if (!busId || typeof busId !== "string") {
        return res.status(400).json({ error: "busId is required" });
      }
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }
      const doc = await SecurityLog.create({
        type,
        busId,
        message,
        severity,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
        assignedRoute: assignedRoute ?? null,
        currentTerminal: currentTerminal ?? null,
        source,
      });
      res.status(201).json({ ok: true, id: String(doc._id) });
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to write security log" });
    }
  });

  return router;
}

module.exports = { createSecurityLogsRouter };
