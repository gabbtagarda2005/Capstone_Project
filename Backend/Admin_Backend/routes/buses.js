const express = require("express");
const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const GpsHistory = require("../models/GpsHistory");
const SecurityLog = require("../models/SecurityLog");
const { broadcastLocationUpdate, broadcastCommandAlert, broadcastBusAttendantOffline } = require("../sockets/socket");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireTicketIssuerJwt } = require("../middleware/requireTicketIssuerJwt");
const { normalizeBusId, healthStatusFromTicketCount } = require("../services/busMaintenance");
const {
  buildOperatorBusQuery,
  ingestAttendantGps,
  ingestDeviceGps,
} = require("../services/attendantGpsIngest");
const { getFreeEtaMinutes, resolveNextTerminalForBus } = require("../services/freeEtaEngine");
const { getPortalSettingsLean } = require("../services/adminPortalSettingsService");

function normalizePlateForApi(raw) {
  const s = raw == null ? "" : String(raw).trim();
  if (!s || s === "—" || s === "-" || s === "–") return null;
  return s;
}

function mapBus(b) {
  if (!b) return null;
  let driverName = null;
  let driverLicense = null;
  if (b.driverId && typeof b.driverId === "object" && b.driverId.firstName) {
    driverName = `${b.driverId.firstName} ${b.driverId.lastName}`.trim();
    driverLicense = b.driverId.licenseNumber || null;
  }
  let attendantName = null;
  if (b.operatorPortalUserId && typeof b.operatorPortalUserId === "object") {
    const op = b.operatorPortalUserId;
    attendantName =
      `${op.firstName != null ? String(op.firstName) : ""} ${op.lastName != null ? String(op.lastName) : ""}`.trim() ||
      (op.email != null ? String(op.email) : null);
  }
  return {
    id: b._id.toString(),
    busId: b.busId,
    busNumber: b.busNumber || b.busId,
    imei: b.imei || null,
    plateNumber: normalizePlateForApi(b.plateNumber),
    // operatorId is the attendant identifier used by the frontend:
    // - numeric string when ticketing/MySQL is used
    // - ObjectId string when Mongo-only onboarding is used
    operatorId:
      b.operatorMysqlId != null
        ? String(b.operatorMysqlId)
        : b.operatorPortalUserId
          ? typeof b.operatorPortalUserId === "object" && b.operatorPortalUserId._id
            ? String(b.operatorPortalUserId._id)
            : String(b.operatorPortalUserId)
          : null,
    attendantName,
    driverId: b.driverId && typeof b.driverId === "object" && b.driverId._id ? String(b.driverId._id) : b.driverId ? String(b.driverId) : null,
    driverName,
    driverLicense,
    route: b.route || null,
    strictPickup: b.strictPickup === true,
    status: b.status,
    healthStatus: b.healthStatus || healthStatusFromTicketCount(b.ticketsIssued || 0),
    ticketsIssued: b.ticketsIssued ?? 0,
    lastUpdated: b.lastUpdated || b.updatedAt || null,
    lastSeenAt: b.lastSeenAt || null,
    createdAt: b.createdAt || null,
    seatCapacity: typeof b.seatCapacity === "number" && Number.isFinite(b.seatCapacity) && b.seatCapacity > 0 ? b.seatCapacity : 50,
  };
}

const IMEI_RE = /^\d{15}$/;

function createBusesRouter(io) {
  const router = express.Router();

  /** Operator JWT: bus assigned to this attendant in Management Console */
  router.get("/assignment/me", requireTicketIssuerJwt, async (req, res) => {
    const q = buildOperatorBusQuery(req.ticketingUser?.sub);
    if (!q) {
      return res.status(400).json({ error: "Could not resolve operator id from token" });
    }
    try {
      const b = await Bus.findOne(q)
        .populate("driverId", "firstName lastName driverId licenseNumber")
        .lean();
      const inactive = Boolean(b && String(b.status || "").trim() === "Inactive");
      res.json({
        assigned: !!(b && !inactive),
        bus: b && !inactive ? mapBus(b) : null,
        ...(inactive ? { busDeactivated: true } : {}),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Operator JWT: stream GPS for the bus assigned to this attendant (no device secret).
   * Body: { latitude, longitude, speedKph?, heading? }
   */
  router.post("/attendant-ping", requireTicketIssuerJwt, async (req, res) => {
    try {
      await ingestAttendantGps(io, broadcastLocationUpdate, req.ticketingUser, req.body || {});
      res.status(204).send();
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 400 && code < 500) {
        console.warn("[gps-ingest attendant-ping]", req.ticketingUser?.sub, e.message);
      }
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message });
    }
  });

  /** Alias for attendant-ping — same body and auth (product docs: /api/live-location). */
  router.post("/live-location", requireTicketIssuerJwt, async (req, res) => {
    try {
      await ingestAttendantGps(io, broadcastLocationUpdate, req.ticketingUser, req.body || {});
      res.status(204).send();
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 400 && code < 500) {
        console.warn("[gps-ingest live-location]", req.ticketingUser?.sub, e.message);
      }
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message });
    }
  });

  /**
   * Store-and-forward: apply queued points in order (same fields as live-location + optional clientRecordedAt).
   * Body: { points: [ { latitude, longitude, ... }, ... ] } — max 40 per request.
   */
  router.post("/live-location/batch", requireTicketIssuerJwt, async (req, res) => {
    const pts = req.body?.points;
    if (!Array.isArray(pts) || pts.length === 0) {
      return res.status(400).json({ error: "points array required" });
    }
    const cap = Math.min(pts.length, 40);
    try {
      for (let i = 0; i < cap; i++) {
        await ingestAttendantGps(io, broadcastLocationUpdate, req.ticketingUser, pts[i] || {});
      }
      res.json({ ok: true, applied: cap });
    } catch (e) {
      const code = e.statusCode || 500;
      if (code >= 400 && code < 500) {
        console.warn("[gps-ingest live-location/batch]", req.ticketingUser?.sub, e.message);
      }
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message });
    }
  });

  /**
   * Operator JWT: drop this attendant's bus from live map (gps_logs) + notify admins.
   * Use on sign-out / end shift so View Location does not show a stale "active" pin for minutes.
   */
  router.post("/live-session/end", requireTicketIssuerJwt, async (req, res) => {
    try {
      await clearAttendantLiveSession(io, broadcastBusAttendantOffline, req.ticketingUser);
      res.status(204).send();
    } catch (e) {
      const code = e.statusCode || 500;
      console.warn("[gps live-session/end]", req.ticketingUser?.sub, e.message);
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message });
    }
  });

  /**
   * Operator JWT: SOS — GPS + assigned bus to Command Center.
   * Body: { latitude, longitude, level?: 'normal'|'medium'|'emergency', note?: string }
   */
  router.post("/attendant-sos", requireTicketIssuerJwt, async (req, res) => {
    const q = buildOperatorBusQuery(req.ticketingUser?.sub);
    if (!q) {
      return res.status(400).json({ error: "Could not resolve operator id from token" });
    }
    const { latitude, longitude } = req.body || {};
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "latitude, longitude required" });
    }
    const rawLevel = String(req.body?.level ?? req.body?.alertLevel ?? "emergency")
      .trim()
      .toLowerCase();
    const level = ["normal", "medium", "emergency"].includes(rawLevel) ? rawLevel : "emergency";
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 2000) : "";
    const levelLabel = { normal: "Normal", medium: "Medium", emergency: "Emergency" }[level];
    const severity = { normal: "info", medium: "warning", emergency: "critical" }[level];
    const priority = { normal: "low", medium: "medium", emergency: "high" }[level];
    try {
      const b = await Bus.findOne(q)
        .populate("driverId", "firstName lastName")
        .select("busId plateNumber route")
        .lean();
      if (!b?.busId) {
        return res.status(403).json({ error: "No bus assignment for this operator" });
      }
      const busId = String(b.busId);
      const plate = b.plateNumber != null ? String(b.plateNumber) : "—";
      let driverDisplayName = "—";
      if (b.driverId && typeof b.driverId === "object" && b.driverId.firstName != null) {
        driverDisplayName = `${String(b.driverId.firstName || "").trim()} ${String(b.driverId.lastName || "").trim()}`.trim() || "—";
      }
      const attendantEmail = req.ticketingUser?.email != null ? String(req.ticketingUser.email).trim() : null;
      const attendantDisplayName = attendantEmail || "Attendant";
      const noteSuffix = note ? ` — ${note}` : "";
      const message = `SOS (${levelLabel}) — Attendant alert | Bus ${busId} | Plate ${plate} | Driver ${driverDisplayName}${noteSuffix}`;
      const doc = await SecurityLog.create({
        type: "attendant_sos",
        busId,
        message,
        severity,
        latitude: Number(latitude),
        longitude: Number(longitude),
        assignedRoute: b.route != null ? String(b.route) : null,
        source: "attendant_app",
        attendantDisplayName,
        attendantEmail,
        driverDisplayName,
        plateNumber: plate !== "—" ? plate : null,
      });
      const alertPayload = {
        kind: "sos",
        id: String(doc._id),
        busId,
        plateNumber: plate,
        driverName: driverDisplayName,
        attendantName: attendantDisplayName,
        attendantEmail,
        latitude: Number(latitude),
        longitude: Number(longitude),
        assignedRoute: b.route != null ? String(b.route) : null,
        severity,
        priority,
        level,
        note: note || null,
        message,
        createdAt: doc.createdAt.toISOString(),
      };
      broadcastCommandAlert(io, alertPayload);
      res.status(201).json({ ok: true, id: String(doc._id) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Operator JWT: quick incident report (accident / mechanical / traffic).
   * Body: { category, latitude, longitude, note? }
   */
  router.post("/attendant-incident", requireTicketIssuerJwt, async (req, res) => {
    const q = buildOperatorBusQuery(req.ticketingUser?.sub);
    if (!q) {
      return res.status(400).json({ error: "Could not resolve operator id from token" });
    }
    const { latitude, longitude, note } = req.body || {};
    let category = String(req.body?.category || "").trim().toLowerCase();
    const allowed = new Set(["accident", "mechanical", "traffic"]);
    if (!allowed.has(category)) {
      return res.status(400).json({ error: "category must be accident, mechanical, or traffic" });
    }
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "latitude, longitude required" });
    }
    try {
      const b = await Bus.findOne(q).select("busId plateNumber route").lean();
      if (!b?.busId) {
        return res.status(403).json({ error: "No bus assignment for this operator" });
      }
      const busId = String(b.busId);
      const plate = b.plateNumber != null ? String(b.plateNumber) : "—";
      const noteStr = note != null && String(note).trim() ? String(note).trim() : "";
      const message = `Incident report (${category}) — Bus ${busId} | Plate ${plate}${noteStr ? ` | ${noteStr}` : ""}`;
      const doc = await SecurityLog.create({
        type: "attendant_incident",
        busId,
        message,
        severity: "warning",
        latitude: Number(latitude),
        longitude: Number(longitude),
        assignedRoute: b.route != null ? String(b.route) : null,
        source: "attendant_app",
      });
      const alertPayload = {
        kind: "incident",
        id: String(doc._id),
        category,
        busId,
        plateNumber: plate,
        latitude: Number(latitude),
        longitude: Number(longitude),
        message,
        createdAt: doc.createdAt.toISOString(),
      };
      broadcastCommandAlert(io, alertPayload);
      res.status(201).json({ ok: true, id: String(doc._id) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Latest positions for admin / passenger maps */
  router.get("/live", async (_req, res) => {
    try {
      const inactiveRows = await Bus.find({ status: "Inactive" })
        .select("busId")
        .lean()
        .catch(() => []);
      const inactiveBusIds = new Set(
        (inactiveRows || []).map((r) => String(r.busId || "").trim()).filter(Boolean)
      );
      const settings = await getPortalSettingsLean().catch(() => null);
      const delayThreshold = [8, 10, 12].includes(Number(settings?.delayThresholdMinutes))
        ? Number(settings.delayThresholdMinutes)
        : 10;
      const logs = await GpsLog.find().sort({ busId: 1 }).lean();
      const items = await Promise.all(
        logs.map(async (doc) => {
          const terminal = await resolveNextTerminalForBus(String(doc.busId)).catch(() => null);
          const etaMinutes =
            terminal &&
            Number.isFinite(Number(doc.latitude)) &&
            Number.isFinite(Number(doc.longitude))
              ? getFreeEtaMinutes(
                  Number(doc.latitude),
                  Number(doc.longitude),
                  Number(terminal.latitude),
                  Number(terminal.longitude),
                  Number(doc.speedKph)
                )
              : null;
          return {
          busId: String(doc.busId),
          latitude: Number(doc.latitude),
          longitude: Number(doc.longitude),
          speedKph: doc.speedKph != null ? Number(doc.speedKph) : null,
          heading: doc.heading != null ? Number(doc.heading) : null,
          signal:
            doc.signal != null && ["strong", "weak", "offline"].includes(String(doc.signal))
              ? String(doc.signal)
              : null,
          source: doc.source != null ? String(doc.source) : "staff",
          sourceFlag: String(doc.source) === "hardware" ? "hardware" : "mobile",
          net: doc.network != null ? String(doc.network) : null,
          signalStrength:
            doc.signalStrength != null && Number.isFinite(Number(doc.signalStrength))
              ? Number(doc.signalStrength)
              : null,
          voltage: doc.voltage != null && Number.isFinite(Number(doc.voltage)) ? Number(doc.voltage) : null,
          etaMinutes,
          etaTargetIso:
            etaMinutes != null ? new Date(Date.now() + Number(etaMinutes) * 60_000).toISOString() : null,
          nextTerminal: terminal?.name || null,
          trafficDelay: etaMinutes != null && etaMinutes > delayThreshold,
          delayThresholdMinutes: delayThreshold,
          recordedAt: doc.recordedAt ? new Date(doc.recordedAt).toISOString() : new Date().toISOString(),
          };
        })
      );
      const filtered = items.filter(
        (x) =>
          Number.isFinite(x.latitude) &&
          Number.isFinite(x.longitude) &&
          !inactiveBusIds.has(String(x.busId || "").trim())
      );
      res.json({ items: filtered });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Admin-only: write one GPS sample (same as device ping) to verify map + /api/buses/live.
   * Body: { latitude, longitude, busId? } — busId defaults to lexicographically first fleet bus.
   */
  router.post("/admin/test-gps", requireAdminJwt, async (req, res) => {
    try {
      const body = req.body || {};
      let busId = body.busId != null ? String(body.busId).trim() : "";
      const { latitude, longitude } = body;
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: "latitude and longitude required" });
      }
      if (!busId) {
        const first = await Bus.findOne().sort({ busId: 1 }).select("busId").lean();
        if (!first?.busId) {
          return res.status(400).json({ error: "No buses in fleet registry" });
        }
        busId = String(first.busId);
      } else {
        const exists = await Bus.findOne({ busId }).select("_id").lean();
        if (!exists) {
          return res.status(404).json({ error: "Unknown busId" });
        }
      }
      await ingestDeviceGps(io, broadcastLocationUpdate, busId, { latitude, longitude });
      res.json({ ok: true, busId });
    } catch (e) {
      const code = e.statusCode || 500;
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message });
    }
  });

  router.get("/", requireAdminJwt, async (_req, res) => {
    try {
      const buses = await Bus.find()
        .populate("driverId", "firstName lastName driverId licenseNumber")
        .populate("operatorPortalUserId", "firstName lastName email")
        .sort({ busId: 1 })
        .lean();
      res.json({ items: buses.map(mapBus) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id", requireAdminJwt, async (req, res) => {
    const raw = decodeURIComponent(String(req.params.id || "").trim());
    if (!raw) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      let b = null;
      if (mongoose.isValidObjectId(raw)) {
        b = await Bus.findById(raw)
          .populate("driverId", "firstName lastName driverId licenseNumber")
          .populate("operatorPortalUserId", "firstName lastName email")
          .lean();
      }
      if (!b) {
        b = await Bus.findOne({ busId: raw })
          .populate("driverId", "firstName lastName driverId licenseNumber")
          .populate("operatorPortalUserId", "firstName lastName email")
          .lean();
      }
      const out = mapBus(b);
      if (!out) return res.status(404).json({ error: "Not found" });
      const latestGps = await GpsLog.findOne({ busId: String(out.busId) }).sort({ recordedAt: -1 }).lean();
      const latestGpsDto =
        latestGps && Number.isFinite(Number(latestGps.latitude)) && Number.isFinite(Number(latestGps.longitude))
          ? {
              latitude: Number(latestGps.latitude),
              longitude: Number(latestGps.longitude),
              speedKph: latestGps.speedKph != null ? Number(latestGps.speedKph) : null,
              heading: latestGps.heading != null ? Number(latestGps.heading) : null,
              recordedAt: latestGps.recordedAt ? new Date(latestGps.recordedAt).toISOString() : null,
            }
          : null;
      res.json({ ...out, latestGps: latestGpsDto });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Partial update: any of `operatorId`, `route`, `driverId` (each optional).
   * - operatorId: string | null — numeric MySQL attendant id, Mongo PortalUser ObjectId, or null to unassign
   * - route: string | null — corridor label
   * - driverId: string | null — Mongo Driver ObjectId or null to unassign
   */
  router.patch("/:id", requireAdminJwt, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const hasOp = body.operatorId !== undefined;
    const hasRoute = body.route !== undefined;
    const hasDriver = body.driverId !== undefined;
    const hasStatus = body.status !== undefined;
    const hasPlate = body.plateNumber !== undefined;
    const hasSeats = body.seatCapacity !== undefined;
    if (!hasOp && !hasRoute && !hasDriver && !hasStatus && !hasPlate && !hasSeats) {
      return res.status(400).json({ error: "Send operatorId, route, driverId, status, plateNumber, and/or seatCapacity" });
    }

    const $set = { lastUpdated: new Date() };

    if (hasOp) {
      let opMysqlId = null;
      let opPortalUserId = null;
      if (body.operatorId != null) {
        const operatorIdStr = String(body.operatorId).trim();
        if (!operatorIdStr) {
          return res.status(400).json({ error: "operatorId cannot be empty" });
        }
        const hasNumericOperatorId = /^\d+$/.test(operatorIdStr);
        const hasPortalUserId = mongoose.isValidObjectId(operatorIdStr);
        if (hasNumericOperatorId) {
          const parsed = Number(operatorIdStr);
          if (!Number.isFinite(parsed) || parsed < 1) {
            return res.status(400).json({ error: "operatorId must be a positive numeric attendant id" });
          }
          opMysqlId = parsed;
        } else if (hasPortalUserId) {
          opPortalUserId = new mongoose.Types.ObjectId(operatorIdStr);
        } else {
          return res.status(400).json({
            error: "operatorId must be a positive numeric MySQL attendant id or a valid MongoDB PortalUser id",
          });
        }
      }
      $set.operatorMysqlId = opMysqlId;
      $set.operatorPortalUserId = opPortalUserId;
    }

    if (hasRoute) {
      $set.route =
        body.route == null || String(body.route).trim() === "" ? null : String(body.route).trim();
    }

    if (hasDriver) {
      if (body.driverId == null || body.driverId === "") {
        $set.driverId = null;
      } else if (mongoose.isValidObjectId(String(body.driverId))) {
        $set.driverId = new mongoose.Types.ObjectId(String(body.driverId));
      } else {
        return res.status(400).json({ error: "driverId must be a valid MongoDB driver id or null" });
      }
    }

    if (hasStatus) {
      const st = String(body.status || "").trim();
      if (!["Active", "Maintenance", "Inactive"].includes(st)) {
        return res.status(400).json({ error: "status must be Active, Maintenance, or Inactive" });
      }
      $set.status = st;
    }

    if (hasPlate) {
      const p = body.plateNumber == null ? "" : String(body.plateNumber).trim();
      $set.plateNumber = p ? p : "—";
    }

    if (hasSeats) {
      const n = Number(body.seatCapacity);
      if (!Number.isFinite(n) || n < 1 || n > 300) {
        return res.status(400).json({ error: "seatCapacity must be between 1 and 300" });
      }
      $set.seatCapacity = Math.round(n);
    }

    try {
      const doc = await Bus.findByIdAndUpdate(req.params.id, { $set }, { new: true })
        .populate("driverId", "firstName lastName driverId licenseNumber")
        .lean();
      const out = mapBus(doc);
      if (!out) return res.status(404).json({ error: "Not found" });
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Permanently remove bus from registry and clear GPS rows for this busId.
   * Does not delete MySQL ticket history (if any).
   */
  router.delete("/:id", requireAdminJwt, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      const doc = await Bus.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ error: "Not found" });
      const resolvedBusId = String(doc.busId || "").trim();
      await GpsLog.deleteMany({ busId: resolvedBusId }).catch(() => {});
      await GpsHistory.deleteMany({ busId: resolvedBusId }).catch(() => {});
      await Bus.deleteOne({ _id: req.params.id });
      res.json({ ok: true, deletedId: String(req.params.id), busId: resolvedBusId });
    } catch (e) {
      res.status(500).json({ error: e.message || "Delete failed" });
    }
  });

  router.post("/", requireAdminJwt, async (req, res) => {
    const { busNumber, imei, operatorId, driverId, route, plateNumber, seatCapacity, strictPickup } = req.body || {};
    const idNorm = normalizeBusId(busNumber);
    if (!idNorm) {
      return res.status(400).json({ error: "busNumber is required" });
    }
    const imeiStr = imei != null ? String(imei).replace(/\D/g, "") : "";
    if (!IMEI_RE.test(imeiStr)) {
      return res.status(400).json({ error: "imei must be exactly 15 digits" });
    }
    const operatorIdStr = operatorId != null ? String(operatorId).trim() : "";
    const hasNumericOperatorId = /^\d+$/.test(operatorIdStr);
    const hasPortalUserId = mongoose.isValidObjectId(operatorIdStr);
    let opMysqlId = null;
    let opPortalUserId = null;
    if (operatorIdStr && hasNumericOperatorId) {
      const parsed = Number(operatorIdStr);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return res.status(400).json({ error: "operatorId must be a positive numeric attendant id" });
      }
      opMysqlId = parsed;
    } else if (operatorIdStr && hasPortalUserId) {
      opPortalUserId = new mongoose.Types.ObjectId(operatorIdStr);
    } else {
      return res.status(400).json({ error: "operatorId must be either a positive numeric MySQL attendant id or a valid MongoDB PortalUser id" });
    }
    if (!driverId || !mongoose.isValidObjectId(String(driverId))) {
      return res.status(400).json({ error: "driverId must be a valid MongoDB driver id" });
    }
    const routeStr = String(route || "").trim();
    if (!routeStr) {
      return res.status(400).json({ error: "route is required" });
    }

    let seats = 50;
    if (seatCapacity !== undefined && seatCapacity !== null && seatCapacity !== "") {
      const n = Number(seatCapacity);
      if (!Number.isFinite(n) || n < 1 || n > 300) {
        return res.status(400).json({ error: "seatCapacity must be between 1 and 300" });
      }
      seats = Math.round(n);
    }

    try {
      const doc = await Bus.create({
        busId: idNorm,
        busNumber: idNorm,
        plateNumber: plateNumber != null && String(plateNumber).trim() ? String(plateNumber).trim() : "—",
        seatCapacity: seats,
        imei: imeiStr,
        operatorMysqlId: opMysqlId,
        operatorPortalUserId: opPortalUserId,
        driverId: new mongoose.Types.ObjectId(String(driverId)),
        route: routeStr,
        strictPickup: strictPickup === true,
        status: "Active",
        healthStatus: "Good",
        ticketsIssued: 0,
        lastUpdated: new Date(),
      });
      res.status(201).json(mapBus(doc.toObject()));
    } catch (e) {
      if (e.code === 11000) {
        const msg = String(e.message || "").includes("imei") ? "IMEI already registered" : "Bus number already exists";
        return res.status(409).json({ error: msg });
      }
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * LilyGo / device ping — body: { busId?, imei?, latitude, longitude, speedKph?, heading? }
   * If imei is sent without busId, resolves bus by IMEI.
   * Optional header: x-device-secret matching DEVICE_INGEST_SECRET
   */
  router.post("/ping", async (req, res) => {
    const secret = process.env.DEVICE_INGEST_SECRET;
    if (secret && req.headers["x-device-secret"] !== secret) {
      return res.status(401).json({ error: "Invalid device secret" });
    }

    let { busId, imei, latitude, longitude, speedKph, heading } = req.body || {};
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "latitude, longitude required" });
    }

    let resolvedBusId = busId != null ? String(busId).trim() : "";
    if (!resolvedBusId && imei != null) {
      const imeiClean = String(imei).replace(/\D/g, "");
      if (imeiClean.length === 15) {
        const b = await Bus.findOne({ imei: imeiClean }).select("busId").lean();
        if (b) resolvedBusId = b.busId;
      }
    }
    if (!resolvedBusId) {
      return res.status(400).json({ error: "busId or registered imei required" });
    }

    try {
      await ingestDeviceGps(io, broadcastLocationUpdate, resolvedBusId, req.body || {});
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Hardware telemetry alias for LILYGO trackers.
   * Body: { bus_id, lat, lng, source:'hardware', net:'wifi'|'4g', signal_strength? }
   */
  router.post("/hardware-telemetry", async (req, res) => {
    const secret = process.env.DEVICE_INGEST_SECRET;
    if (secret && req.headers["x-device-secret"] !== secret) {
      return res.status(401).json({ error: "Invalid device secret" });
    }
    const body = req.body || {};
    let busId = body.bus_id != null ? String(body.bus_id).trim() : body.busId != null ? String(body.busId).trim() : "";
    const imei = body.imei != null ? String(body.imei).replace(/\D/g, "") : "";
    const lat = body.lat ?? body.latitude;
    const lng = body.lng ?? body.longitude;
    if ((!busId && !imei) || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "bus_id or imei, plus lat and lng required" });
    }
    if (!busId && imei.length === 15) {
      try {
        const b = await Bus.findOne({ imei }).select("busId").lean();
        if (b?.busId) busId = String(b.busId).trim();
      } catch {
        /* ignore */
      }
    }
    if (!busId) {
      return res.status(404).json({ error: "Unknown IMEI (register this device in Fleet first)" });
    }
    try {
      await ingestDeviceGps(io, broadcastLocationUpdate, busId, {
        latitude: lat,
        longitude: lng,
        speedKph: body.speedKph ?? body.speed ?? null,
        heading: body.heading ?? null,
        net: body.net ?? body.network ?? "unknown",
        signal_strength: body.signal_strength ?? body.signalStrength ?? body.rssi ?? null,
        voltage: body.voltage ?? body.vbat ?? body.batteryVoltage ?? null,
      });
      res.status(204).send();
    } catch (e) {
      const code = e.statusCode || 500;
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message || "hardware telemetry failed" });
    }
  });

  return router;
}

module.exports = { createBusesRouter };
