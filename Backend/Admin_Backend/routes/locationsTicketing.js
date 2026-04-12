const express = require("express");
const mongoose = require("mongoose");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const RouteCoverage = require("../models/RouteCoverage");
const TicketLocation = require("../models/TicketLocation");
const { syncRouteCoverageToRtdb, removeRouteCoverageFromRtdb } = require("../services/hybridRtdbSync");

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `undefined` = leave unchanged (updates only); `null` = clear; number = set (>=1). */
function normalizeTerminalInboundSequence(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "terminalInboundSequence")) return undefined;
  const raw = body.terminalInboundSequence;
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const v = Math.floor(Number(raw));
  if (!Number.isFinite(v) || v < 1) return null;
  return v;
}

/** `undefined` = leave unchanged on update; `null` = clear; else enum value. */
function normalizePreTerminalStopFarePolicy(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "preTerminalStopFarePolicy")) return undefined;
  const v = String(body.preTerminalStopFarePolicy || "").trim();
  if (v === "distance_only" || v === "matrix_plus_corridor_delta") return v;
  if (v === "" || v === "null") return null;
  return undefined;
}

function buildStopsArray(rawStops) {
  const arr = Array.isArray(rawStops) ? rawStops : [];
  return arr
    .map((s, idx) => {
      const row = {
        name: String(s?.name || "").trim(),
        latitude: Number(s?.latitude),
        longitude: Number(s?.longitude),
        sequence: Number.isFinite(Number(s?.sequence)) ? Number(s.sequence) : idx + 1,
        geofenceRadiusM: Number.isFinite(Number(s?.geofenceRadiusM)) ? Number(s.geofenceRadiusM) : 100,
        pickupOnly: s?.pickupOnly !== false,
      };
      if (s && Object.prototype.hasOwnProperty.call(s, "kilometersFromStart")) {
        const raw = s.kilometersFromStart;
        if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
          const km = Number(raw);
          if (Number.isFinite(km) && km >= 0) row.kilometersFromStart = km;
        }
      }
      return row;
    })
    .filter((s) => s.name && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
}

function mergeTerminalForSave(bodyTerminal, existingTerminal) {
  const terminalName = String(bodyTerminal?.name || "").trim();
  const termLat = Number(bodyTerminal?.latitude);
  const termLng = Number(bodyTerminal?.longitude);
  const termRadius = Number(bodyTerminal?.geofenceRadiusM || 500);
  const terminalPickupOnly = bodyTerminal?.pickupOnly !== false;
  const out = {
    name: terminalName,
    latitude: termLat,
    longitude: termLng,
    geofenceRadiusM: Number.isFinite(termRadius) ? termRadius : 500,
    pickupOnly: terminalPickupOnly,
  };
  if (bodyTerminal && Object.prototype.hasOwnProperty.call(bodyTerminal, "kilometersFromStart")) {
    const raw = bodyTerminal.kilometersFromStart;
    if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
      const km = Number(raw);
      if (Number.isFinite(km) && km >= 0) out.kilometersFromStart = km;
    }
  } else if (
    existingTerminal &&
    Object.prototype.hasOwnProperty.call(existingTerminal, "kilometersFromStart") &&
    Number.isFinite(Number(existingTerminal.kilometersFromStart))
  ) {
    out.kilometersFromStart = Number(existingTerminal.kilometersFromStart);
  }
  return out;
}

/** Case-insensitive exact match on trimmed location name (Mongo string field). */
function locationNameExactRegex(name) {
  const t = String(name || "").trim();
  if (!t) return null;
  return new RegExp(`^${escapeRegex(t)}$`, "i");
}

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
    const locPointLat = Number(body.locationPoint?.latitude);
    const locPointLng = Number(body.locationPoint?.longitude);
    const locationPoint =
      Number.isFinite(locPointLat) && Number.isFinite(locPointLng)
        ? {
            name: String(body.locationPoint?.name || locationName || "").trim() || locationName,
            latitude: locPointLat,
            longitude: locPointLng,
          }
        : null;
    const rawStops = Array.isArray(body.stops) ? body.stops : [];
    const coverageIdRaw = body.coverageId != null ? String(body.coverageId).trim() : "";
    const coverageId =
      coverageIdRaw && mongoose.Types.ObjectId.isValid(coverageIdRaw) ? coverageIdRaw : null;
    const terminalInboundSeq = normalizeTerminalInboundSequence(body);
    const preTerminalPolicy = normalizePreTerminalStopFarePolicy(body);

    if (!locationName || !terminalName) {
      return res.status(400).json({ error: "locationName and terminal.name are required" });
    }
    if (!Number.isFinite(termLat) || !Number.isFinite(termLng)) {
      return res.status(400).json({ error: "terminal coordinates are required" });
    }

    const stops = buildStopsArray(rawStops);

    const nameRe = locationNameExactRegex(locationName);
    if (!nameRe) {
      return res.status(400).json({ error: "locationName is invalid" });
    }

    const duplicateOtherThan = async (excludeId) => {
      const q = { locationName: nameRe };
      if (excludeId) q._id = { $ne: new mongoose.Types.ObjectId(String(excludeId)) };
      return RouteCoverage.findOne(q).lean();
    };

    if (coverageId) {
      const existing = await RouteCoverage.findById(coverageId).lean();
      if (!existing) {
        return res.status(404).json({ error: "Coverage not found" });
      }
      const dup = await duplicateOtherThan(coverageId);
      if (dup) {
        return res.status(409).json({
          error:
            "Another hub already uses this location name. Choose a different name or edit that hub instead.",
        });
      }
      const $set = {
        locationName,
        pointType,
        terminal: mergeTerminalForSave(body.terminal, existing.terminal),
        locationPoint,
        stops,
      };
      if (terminalInboundSeq !== undefined) {
        if (terminalInboundSeq === null) $set.terminalInboundSequence = null;
        else $set.terminalInboundSequence = terminalInboundSeq;
      }
      if (preTerminalPolicy !== undefined) {
        if (preTerminalPolicy === null) $set.preTerminalStopFarePolicy = null;
        else $set.preTerminalStopFarePolicy = preTerminalPolicy;
      }
      const doc = await RouteCoverage.findByIdAndUpdate(coverageId, { $set }, { new: true }).lean();
      try {
        await syncRouteCoverageToRtdb(doc);
      } catch (e) {
        console.warn("[hybrid-sync] Firebase RTDB coverage mirror failed:", e.message);
      }
      return res.status(200).json(doc);
    }

    const dup = await duplicateOtherThan(null);
    if (dup) {
      return res.status(409).json({
        error:
          "This location already exists. Edit the existing hub from the deployed list or use a different name.",
      });
    }

    const createPayload = {
      locationName,
      pointType,
      terminal: mergeTerminalForSave(body.terminal, null),
      locationPoint,
      stops,
    };
    if (terminalInboundSeq !== undefined && terminalInboundSeq !== null) {
      createPayload.terminalInboundSequence = terminalInboundSeq;
    }
    if (preTerminalPolicy !== undefined && preTerminalPolicy !== null) {
      createPayload.preTerminalStopFarePolicy = preTerminalPolicy;
    }
    const created = await RouteCoverage.create(createPayload);
    const doc = created.toObject();
    try {
      await syncRouteCoverageToRtdb(doc);
    } catch (e) {
      console.warn("[hybrid-sync] Firebase RTDB coverage mirror failed:", e.message);
    }

    res.status(201).json(doc);
  });

  /** Partial update: `geofenceRadiusM` (50–50000 m) and/or `pickupOnly` on terminal. */
  router.patch("/coverage/:id", requireAdminJwt, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid coverage id" });
      }
      const { geofenceRadiusM, pickupOnly } = req.body || {};
      const $set = {};
      if (geofenceRadiusM !== undefined) {
        const r = Number(geofenceRadiusM);
        if (!Number.isFinite(r) || r < 50 || r > 50000) {
          return res.status(400).json({ error: "geofenceRadiusM must be between 50 and 50000" });
        }
        $set["terminal.geofenceRadiusM"] = r;
      }
      if (pickupOnly !== undefined) {
        $set["terminal.pickupOnly"] = Boolean(pickupOnly);
      }
      if (Object.keys($set).length === 0) {
        return res.status(400).json({ error: "Send geofenceRadiusM and/or pickupOnly" });
      }
      const doc = await RouteCoverage.findByIdAndUpdate(id, { $set }, { new: true }).lean();
      if (!doc) return res.status(404).json({ error: "Coverage not found" });
      try {
        await syncRouteCoverageToRtdb(doc);
      } catch (e) {
        console.warn("[hybrid-sync] Firebase RTDB coverage mirror failed:", e.message);
      }
      res.json(doc);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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
    try {
      const rows = await TicketLocation.find().sort({ sequence: 1, name: 1 }).lean();
      res.json({
        items: rows.map((r) => ({
          id: String(r._id),
          locationName: r.name,
          name: r.name,
          latitude: r.latitude,
          longitude: r.longitude,
          sequence: r.sequence,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", requireAdminJwt, async (req, res) => {
    const name = String(req.body?.locationName || req.body?.name || "").trim();
    const lat = Number(req.body?.latitude ?? req.body?.lat);
    const lng = Number(req.body?.longitude ?? req.body?.lng ?? req.body?.lon);
    const seq = Number(req.body?.sequence);
    if (!name) return res.status(400).json({ error: "locationName (or name) required" });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "latitude and longitude are required" });
    }
    if (!Number.isFinite(seq) || seq < 1) {
      return res.status(400).json({ error: "sequence must be a positive number" });
    }
    try {
      const doc = await TicketLocation.create({ name, latitude: lat, longitude: lng, sequence: Math.floor(seq) });
      res.status(201).json({
        id: String(doc._id),
        locationName: doc.name,
        name: doc.name,
        latitude: doc.latitude,
        longitude: doc.longitude,
        sequence: doc.sequence,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    const id = String(req.params.id || "");
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const doc = await TicketLocation.findByIdAndDelete(id).lean();
      if (!doc) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createLocationsTicketingRouter };
