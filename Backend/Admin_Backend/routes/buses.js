const express = require("express");
const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const GpsHistory = require("../models/GpsHistory");
const { broadcastLocationUpdate } = require("../sockets/socket");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { normalizeBusId, healthStatusFromTicketCount } = require("../services/busMaintenance");

function mapBus(b) {
  if (!b) return null;
  let driverName = null;
  let driverLicense = null;
  if (b.driverId && typeof b.driverId === "object" && b.driverId.firstName) {
    driverName = `${b.driverId.firstName} ${b.driverId.lastName}`.trim();
    driverLicense = b.driverId.licenseNumber || null;
  }
  return {
    id: b._id.toString(),
    busId: b.busId,
    busNumber: b.busNumber || b.busId,
    imei: b.imei || null,
    plateNumber: b.plateNumber || null,
    // operatorId is the attendant identifier used by the frontend:
    // - numeric string when ticketing/MySQL is used
    // - ObjectId string when Mongo-only onboarding is used
    operatorId: b.operatorMysqlId != null ? String(b.operatorMysqlId) : b.operatorPortalUserId ? String(b.operatorPortalUserId) : null,
    driverId: b.driverId && typeof b.driverId === "object" && b.driverId._id ? String(b.driverId._id) : b.driverId ? String(b.driverId) : null,
    driverName,
    driverLicense,
    route: b.route || null,
    strictPickup: b.strictPickup !== false,
    status: b.status,
    healthStatus: b.healthStatus || healthStatusFromTicketCount(b.ticketsIssued || 0),
    ticketsIssued: b.ticketsIssued ?? 0,
    lastUpdated: b.lastUpdated || b.updatedAt || null,
    lastSeenAt: b.lastSeenAt || null,
    createdAt: b.createdAt || null,
  };
}

const IMEI_RE = /^\d{15}$/;

function createBusesRouter(io) {
  const router = express.Router();

  /** Latest positions for admin / passenger maps */
  router.get("/live", async (_req, res) => {
    try {
      const logs = await GpsLog.find().lean();
      res.json({ items: logs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/", requireAdminJwt, async (_req, res) => {
    try {
      const buses = await Bus.find()
        .populate("driverId", "firstName lastName driverId licenseNumber")
        .sort({ busId: 1 })
        .lean();
      res.json({ items: buses.map(mapBus) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", requireAdminJwt, async (req, res) => {
    const { busNumber, imei, operatorId, driverId, route, plateNumber, strictPickup } = req.body || {};
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

    try {
      const doc = await Bus.create({
        busId: idNorm,
        busNumber: idNorm,
        plateNumber: plateNumber != null && String(plateNumber).trim() ? String(plateNumber).trim() : "—",
        imei: imeiStr,
        operatorMysqlId: opMysqlId,
        operatorPortalUserId: opPortalUserId,
        driverId: new mongoose.Types.ObjectId(String(driverId)),
        route: routeStr,
        strictPickup: strictPickup !== false,
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

    const recordedAt = new Date();

    try {
      await GpsLog.findOneAndUpdate(
        { busId: String(resolvedBusId) },
        {
          busId: String(resolvedBusId),
          latitude: Number(latitude),
          longitude: Number(longitude),
          speedKph: speedKph != null ? Number(speedKph) : null,
          heading: heading != null ? Number(heading) : null,
          recordedAt,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await GpsHistory.create({
        busId: String(resolvedBusId),
        latitude: Number(latitude),
        longitude: Number(longitude),
        speedKph: speedKph != null ? Number(speedKph) : null,
        heading: heading != null ? Number(heading) : null,
        recordedAt,
      });

      await Bus.updateOne({ busId: String(resolvedBusId) }, { lastSeenAt: recordedAt }).catch(() => {});

      const payload = {
        busId: String(resolvedBusId),
        latitude: Number(latitude),
        longitude: Number(longitude),
        speedKph: speedKph != null ? Number(speedKph) : null,
        heading: heading != null ? Number(heading) : null,
        recordedAt: recordedAt.toISOString(),
      };
      broadcastLocationUpdate(io, payload);

      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createBusesRouter };
