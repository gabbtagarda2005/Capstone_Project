const express = require("express");
const mongoose = require("mongoose");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const RouteCoverage = require("../models/RouteCoverage");
const CorridorRoute = require("../models/CorridorRoute");
const { syncCorridorRouteToRtdb, removeCorridorRouteFromRtdb } = require("../services/hybridRtdbSync");

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function createCorridorRoutesRouter() {
  const router = express.Router();

  router.get("/builder-context", requireAdminJwt, async (_req, res) => {
    try {
      const docs = await RouteCoverage.find().sort({ locationName: 1 }).lean();
      const terminals = docs
        .filter((d) => d.pointType === "terminal")
        .map((d) => ({
          _id: String(d._id),
          locationName: d.locationName,
          type: "terminal",
          terminal: d.terminal,
        }));

      const stops = [];
      for (const d of docs) {
        const locName = d.locationName;
        const cid = String(d._id);
        for (const s of d.stops || []) {
          stops.push({
            _id: `${cid}:${s.sequence}`,
            coverageId: cid,
            locationName: locName,
            pointType: d.pointType,
            sequence: s.sequence,
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            geofenceRadiusM: s.geofenceRadiusM ?? 100,
          });
        }
      }

      res.json({ terminals, stops });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/", requireAdminJwt, async (_req, res) => {
    try {
      const items = await CorridorRoute.find()
        .sort({ updatedAt: -1 })
        .populate("originCoverageId", "locationName terminal pointType")
        .populate("destinationCoverageId", "locationName terminal pointType")
        .populate("viaCoverageIds", "locationName terminal pointType")
        .lean();

      const hubLabel = (doc) => {
        if (!doc || typeof doc !== "object") return "?";
        return doc.terminal?.name || doc.locationName || "?";
      };

      const shaped = items.map((r) => {
        const o = r.originCoverageId;
        const dest = r.destinationCoverageId;
        const vias = Array.isArray(r.viaCoverageIds) ? r.viaCoverageIds : [];
        const originLabel = hubLabel(o);
        const destLabel = hubLabel(dest);
        return {
          _id: String(r._id),
          displayName: r.displayName || `${originLabel} → ${destLabel}`,
          originCoverageId: o && typeof o === "object" ? String(o._id) : String(r.originCoverageId),
          destinationCoverageId:
            dest && typeof dest === "object" ? String(dest._id) : String(r.destinationCoverageId),
          originLabel,
          destLabel,
          viaCoverageIds: vias.map((v) => (v && typeof v === "object" ? String(v._id) : String(v))),
          viaLabels: vias.map((v) => hubLabel(v)),
          authorizedStops: r.authorizedStops || [],
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });

      res.json({ items: shaped });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", requireAdminJwt, async (req, res) => {
    const body = req.body || {};
    const originId = String(body.originCoverageId || "").trim();
    const destId = String(body.destinationCoverageId || "").trim();
    const rawStops = Array.isArray(body.authorizedStops) ? body.authorizedStops : [];
    const rawVia = Array.isArray(body.viaCoverageIds) ? body.viaCoverageIds : [];

    if (!isOid(originId) || !isOid(destId)) {
      return res.status(400).json({ error: "Valid originCoverageId and destinationCoverageId are required" });
    }
    if (originId === destId) {
      return res.status(400).json({ error: "Origin and destination terminals must differ" });
    }

    const [origin, destination] = await Promise.all([
      RouteCoverage.findById(originId).lean(),
      RouteCoverage.findById(destId).lean(),
    ]);

    if (!origin || origin.pointType !== "terminal") {
      return res.status(400).json({ error: "Origin must be a saved location classified as a terminal" });
    }
    if (!destination || destination.pointType !== "terminal") {
      return res.status(400).json({ error: "Destination must be a saved location classified as a terminal" });
    }

    const viaSeen = new Set();
    const viaIds = [];
    for (const raw of rawVia) {
      const vid = String(raw || "").trim();
      if (!isOid(vid)) continue;
      if (vid === originId || vid === destId) {
        return res.status(400).json({ error: "Via locations must differ from start and destination" });
      }
      if (viaSeen.has(vid)) continue;
      viaSeen.add(vid);
      const vCov = await RouteCoverage.findById(vid).lean();
      if (!vCov || vCov.pointType !== "terminal") {
        return res.status(400).json({ error: `Invalid via location: ${vid}` });
      }
      viaIds.push(new mongoose.Types.ObjectId(vid));
    }

    const resolvedStops = [];
    for (const row of rawStops) {
      const cid = String(row.coverageId || "").trim();
      const seq = Number(row.sequence);
      if (!isOid(cid) || !Number.isFinite(seq)) continue;

      if (cid !== originId && cid !== destId) {
        return res.status(400).json({
          error: "Each authorized stop must belong to the origin or destination coverage hub",
        });
      }

      const cov = await RouteCoverage.findById(cid).lean();
      if (!cov || !Array.isArray(cov.stops)) continue;
      const hit = cov.stops.find((s) => Number(s.sequence) === seq);
      if (!hit) {
        return res.status(400).json({
          error: `Invalid stop: no stop with sequence ${seq} under coverage ${cid}`,
        });
      }
      resolvedStops.push({
        coverageId: cid,
        sequence: hit.sequence,
        name: hit.name,
        latitude: hit.latitude,
        longitude: hit.longitude,
        geofenceRadiusM: hit.geofenceRadiusM ?? 100,
      });
    }

    let displayName = String(body.displayName || "").trim();
    if (!displayName) {
      displayName = `${origin.terminal?.name || origin.locationName} → ${destination.terminal?.name || destination.locationName}`;
    }

    const doc = await CorridorRoute.create({
      displayName,
      originCoverageId: originId,
      destinationCoverageId: destId,
      viaCoverageIds: viaIds,
      authorizedStops: resolvedStops,
    });

    res.status(201).json({
      _id: String(doc._id),
      displayName: doc.displayName,
      originCoverageId: String(doc.originCoverageId),
      destinationCoverageId: String(doc.destinationCoverageId),
      viaCoverageIds: (doc.viaCoverageIds || []).map(String),
      authorizedStops: doc.authorizedStops,
    });
  });

  router.delete("/:id", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    const id = String(req.params.id || "");
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await CorridorRoute.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ error: "Not found" });
    try {
      await removeCorridorRouteFromRtdb(id);
    } catch (e) {
      console.warn("[hybrid-sync] Firebase RTDB route remove failed:", e.message);
    }
    res.status(204).send();
  });

  return router;
}

module.exports = { createCorridorRoutesRouter };
