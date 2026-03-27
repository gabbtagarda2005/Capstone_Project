const express = require("express");
const mongoose = require("mongoose");
const { getMysqlPool } = require("../db/mysqlPool");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const RouteCoverage = require("../models/RouteCoverage");
const { syncRouteCoverageToRtdb, removeRouteCoverageFromRtdb } = require("../services/hybridRtdbSync");

function createLocationsTicketingRouter() {
  const router = express.Router();

  router.get("/coverage", requireAdminJwt, async (_req, res) => {
    try {
      const items = await RouteCoverage.find().sort({ updatedAt: -1 }).lean();
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/coverage", requireAdminJwt, async (req, res) => {
    const body = req.body || {};
    const locationName = String(body.locationName || "").trim();
    const terminalName = String(body.terminal?.name || "").trim();
    const pointType = body.pointType === "stop" ? "stop" : "terminal";
    const termLat = Number(body.terminal?.latitude);
    const termLng = Number(body.terminal?.longitude);
    const termRadius = Number(body.terminal?.geofenceRadiusM || 500);
    const terminalPickupOnly = body.terminal?.pickupOnly !== false; // default true
    const rawStops = Array.isArray(body.stops) ? body.stops : [];

    if (!locationName || !terminalName) {
      return res.status(400).json({ error: "locationName and terminal.name are required" });
    }
    if (!Number.isFinite(termLat) || !Number.isFinite(termLng)) {
      return res.status(400).json({ error: "terminal coordinates are required" });
    }

    const stops = rawStops
      .map((s, idx) => ({
        name: String(s?.name || "").trim(),
        latitude: Number(s?.latitude),
        longitude: Number(s?.longitude),
        sequence: Number.isFinite(Number(s?.sequence)) ? Number(s.sequence) : idx + 1,
        geofenceRadiusM: Number.isFinite(Number(s?.geofenceRadiusM)) ? Number(s.geofenceRadiusM) : 100,
        pickupOnly: s?.pickupOnly !== false, // default true
      }))
      .filter((s) => s.name && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));

    const doc = await RouteCoverage.findOneAndUpdate(
      { locationName },
      {
        $set: {
          locationName,
          pointType,
          terminal: {
            name: terminalName,
            latitude: termLat,
            longitude: termLng,
            geofenceRadiusM: Number.isFinite(termRadius) ? termRadius : 500,
            pickupOnly: terminalPickupOnly,
          },
          stops,
        },
      },
      { upsert: true, new: true }
    ).lean();

    try {
      await syncRouteCoverageToRtdb(doc);
    } catch (e) {
      console.warn("[hybrid-sync] Firebase RTDB coverage mirror failed:", e.message);
    }

    res.status(201).json(doc);
  });

  router.delete("/coverage/:id", requireAdminJwt, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid coverage id" });
      }
      const doc = await RouteCoverage.findByIdAndDelete(id).lean();
      if (!doc) return res.status(404).json({ error: "Coverage not found" });
      try {
        await removeRouteCoverageFromRtdb(id);
      } catch (e) {
        console.warn("[hybrid-sync] Firebase RTDB coverage remove failed:", e.message);
      }
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/", requireAdminJwt, async (_req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    try {
      const [rows] = await pool.query(
        "SELECT id, location_name FROM locations ORDER BY location_name ASC"
      );
      res.json({
        items: rows.map((r) => ({ id: r.id, locationName: r.location_name })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", requireAdminJwt, async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const name = String(req.body?.locationName || "").trim();
    if (!name) return res.status(400).json({ error: "locationName required" });
    try {
      const [result] = await pool.query("INSERT INTO locations (location_name) VALUES (?)", [name]);
      res.status(201).json({ id: result.insertId, locationName: name });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Location already exists" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [result] = await pool.query("DELETE FROM locations WHERE id = ?", [id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createLocationsTicketingRouter };
