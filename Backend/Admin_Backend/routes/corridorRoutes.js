const express = require("express");
const mongoose = require("mongoose");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const RouteCoverage = require("../models/RouteCoverage");
const CorridorRoute = require("../models/CorridorRoute");
const { syncCorridorRouteToRtdb, removeCorridorRouteFromRtdb } = require("../services/hybridRtdbSync");
const { upsertFareRouteMirrorFromCorridorDoc, removeFareRouteMirror } = require("../services/fareRouteMirror");

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Shared create/update payload: validates terminals, vias, and authorized stops.
 * @returns {{ ok: true, displayName, originId, destId, viaObjectIds, resolvedStops } | { ok: false, error: string }}
 */
async function resolveCorridorRoutePayload(body) {
  const originId = String(body.originCoverageId || "").trim();
  const destId = String(body.destinationCoverageId || "").trim();
  const rawStops = Array.isArray(body.authorizedStops) ? body.authorizedStops : [];
  const rawVia = Array.isArray(body.viaCoverageIds) ? body.viaCoverageIds : [];

  if (!isOid(originId) || !isOid(destId)) {
    return { ok: false, error: "Valid originCoverageId and destinationCoverageId are required" };
  }
  if (originId === destId) {
    return { ok: false, error: "Origin and destination terminals must differ" };
  }

  const [origin, destination] = await Promise.all([
    RouteCoverage.findById(originId).lean(),
    RouteCoverage.findById(destId).lean(),
  ]);

  if (!origin || origin.pointType !== "terminal") {
    return { ok: false, error: "Origin must be a saved location classified as a terminal" };
  }
  if (!destination || destination.pointType !== "terminal") {
    return { ok: false, error: "Destination must be a saved location classified as a terminal" };
  }

  const viaSeen = new Set();
  const viaObjectIds = [];
  for (const raw of rawVia) {
    const vid = String(raw || "").trim();
    if (!isOid(vid)) continue;
    if (vid === originId || vid === destId) {
      return { ok: false, error: "Via locations must differ from start and destination" };
    }
    if (viaSeen.has(vid)) continue;
    viaSeen.add(vid);
    const vCov = await RouteCoverage.findById(vid).lean();
    if (!vCov || vCov.pointType !== "terminal") {
      return { ok: false, error: `Invalid via location: ${vid}` };
    }
    viaObjectIds.push(new mongoose.Types.ObjectId(vid));
  }

  const resolvedStops = [];
  for (const row of rawStops) {
    const cid = String(row.coverageId || "").trim();
    const seq = Number(row.sequence);
    if (!isOid(cid) || !Number.isFinite(seq)) continue;

    if (cid !== originId && cid !== destId) {
      return {
        ok: false,
        error: "Each authorized stop must belong to the origin or destination coverage hub",
      };
    }

    const cov = await RouteCoverage.findById(cid).lean();
    if (!cov || !Array.isArray(cov.stops)) continue;
    const hit = cov.stops.find((s) => Number(s.sequence) === seq);
    if (!hit) {
      return {
        ok: false,
        error: `Invalid stop: no stop with sequence ${seq} under coverage ${cid}`,
      };
    }
    resolvedStops.push({
      coverageId: cid,
      sequence: hit.sequence,
      name: hit.name,
      latitude: hit.latitude,
      longitude: hit.longitude,
      geofenceRadiusM: hit.geofenceRadiusM ?? 100,
      pickupOnly: hit.pickupOnly !== false,
    });
  }

  let displayName = String(body.displayName || "").trim();
  if (!displayName) {
    displayName = `${origin.terminal?.name || origin.locationName} → ${destination.terminal?.name || destination.locationName}`;
  }

  return {
    ok: true,
    displayName,
    originId,
    destId,
    viaObjectIds,
    resolvedStops,
  };
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
          locationPoint: d.locationPoint || null,
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
            pickupOnly: s.pickupOnly !== false,
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

      const hubPin = (doc, label, kind) => {
        if (!doc || typeof doc !== "object" || !doc.terminal) return null;
        const { latitude, longitude } = doc.terminal;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return { latitude, longitude, label, kind };
      };

      const shaped = items.map((r) => {
        const o = r.originCoverageId;
        const dest = r.destinationCoverageId;
        const vias = Array.isArray(r.viaCoverageIds) ? r.viaCoverageIds : [];
        const originLabel = hubLabel(o);
        const destLabel = hubLabel(dest);
        const corridorHubPins = [];
        const op = hubPin(o, originLabel, "origin");
        if (op) corridorHubPins.push(op);
        for (const v of vias) {
          const vp = hubPin(v, hubLabel(v), "via");
          if (vp) corridorHubPins.push(vp);
        }
        const dp = hubPin(dest, destLabel, "destination");
        if (dp) corridorHubPins.push(dp);
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
          corridorHubPins,
          authorizedStops: r.authorizedStops || [],
          suspended: r.suspended === true,
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
    const resolved = await resolveCorridorRoutePayload(req.body || {});
    if (!resolved.ok) return res.status(400).json({ error: resolved.error });

    const doc = await CorridorRoute.create({
      displayName: resolved.displayName,
      originCoverageId: resolved.originId,
      destinationCoverageId: resolved.destId,
      viaCoverageIds: resolved.viaObjectIds,
      authorizedStops: resolved.resolvedStops,
    });
    try {
      await upsertFareRouteMirrorFromCorridorDoc(doc);
    } catch (e) {
      console.warn("[fare-routes] mirror upsert after create failed:", e.message);
    }

    res.status(201).json({
      _id: String(doc._id),
      displayName: doc.displayName,
      originCoverageId: String(doc.originCoverageId),
      destinationCoverageId: String(doc.destinationCoverageId),
      viaCoverageIds: (doc.viaCoverageIds || []).map(String),
      authorizedStops: doc.authorizedStops,
    });
  });

  router.patch("/:id", requireAdminJwt, async (req, res) => {
    const id = String(req.params.id || "");
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });
    const body = req.body || {};
    const $set = {};
    if (body.suspended !== undefined) $set.suspended = Boolean(body.suspended);

    const wantsCorridorBody =
      body.displayName !== undefined ||
      body.originCoverageId !== undefined ||
      body.destinationCoverageId !== undefined ||
      body.viaCoverageIds !== undefined ||
      body.authorizedStops !== undefined;

    if (wantsCorridorBody) {
      const resolved = await resolveCorridorRoutePayload(body);
      if (!resolved.ok) return res.status(400).json({ error: resolved.error });
      $set.displayName = resolved.displayName;
      $set.originCoverageId = resolved.originId;
      $set.destinationCoverageId = resolved.destId;
      $set.viaCoverageIds = resolved.viaObjectIds;
      $set.authorizedStops = resolved.resolvedStops;
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: "No supported fields to update" });
    }
    try {
      const doc = await CorridorRoute.findByIdAndUpdate(id, { $set }, { new: true }).lean();
      if (!doc) return res.status(404).json({ error: "Not found" });
      try {
        await syncCorridorRouteToRtdb(doc);
      } catch (e) {
        console.warn("[hybrid-sync] Firebase RTDB corridor patch sync failed:", e.message);
      }
      try {
        await upsertFareRouteMirrorFromCorridorDoc(doc);
      } catch (e) {
        console.warn("[fare-routes] mirror upsert after patch failed:", e.message);
      }
      res.json({
        _id: String(doc._id),
        displayName: doc.displayName,
        suspended: doc.suspended === true,
        originCoverageId: String(doc.originCoverageId),
        destinationCoverageId: String(doc.destinationCoverageId),
        viaCoverageIds: (doc.viaCoverageIds || []).map(String),
        authorizedStops: doc.authorizedStops || [],
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    const id = String(req.params.id || "");
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await CorridorRoute.findByIdAndDelete(id);
    if (!r) return res.status(404).json({ error: "Not found" });
    try {
      await removeFareRouteMirror(id);
    } catch (e) {
      console.warn("[fare-routes] mirror delete failed:", e.message);
    }
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
