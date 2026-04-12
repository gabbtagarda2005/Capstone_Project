const express = require("express");
const mongoose = require("mongoose");
const PortalUser = require("../models/PortalUser");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const Bus = require("../models/Bus");
const GpsHistory = require("../models/GpsHistory");
const GpsLog = require("../models/GpsLog");
const RouteCoverage = require("../models/RouteCoverage");
const { requireTicketIssuerJwt } = require("../middleware/requireTicketIssuerJwt");
const { buildOperatorBusQuery } = require("../services/attendantGpsIngest");
const { getPortalSettingsLean } = require("../services/adminPortalSettingsService");
const { getFreeEtaMinutes, resolveNextTerminalForBus } = require("../services/freeEtaEngine");

async function loadOperatorProfileFromMongo(portalUserId) {
  if (!mongoose.isValidObjectId(String(portalUserId || ""))) return null;
  const doc = await PortalUser.findById(String(portalUserId))
    .select("firstName lastName email phone role employeeNumber")
    .lean();
  if (!doc) return null;
  const en = doc.employeeNumber != null && String(doc.employeeNumber).trim() ? String(doc.employeeNumber).trim() : null;
  return {
    id: String(doc._id),
    staffId: en,
    firstName: String(doc.firstName || "").trim(),
    lastName: String(doc.lastName || "").trim(),
    email: String(doc.email || "").trim(),
    phone: doc.phone != null ? String(doc.phone).trim() : "",
    role: String(doc.role || "BusAttendant").trim(),
  };
}

function safeStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s.length ? s : null;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function startOfManilaDayUtc(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const ymd = fmt.format(now); // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00+08:00`);
}

function endOfManilaDayUtc(now = new Date()) {
  const start = startOfManilaDayUtc(now).getTime();
  return new Date(start + 24 * 60 * 60 * 1000);
}

function hhmmManila(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);
}

async function loadTodayTicketStatsByOperatorSub(sub, dayStart, dayEnd) {
  const match = { createdAt: { $gte: dayStart, $lt: dayEnd } };
  if (mongoose.isValidObjectId(String(sub || ""))) {
    match.issuerSub = String(sub).trim();
  } else {
    const n = Number(sub);
    if (!Number.isFinite(n) || n < 1) return { ticketsSold: 0, totalCashRemittance: 0 };
    match.issuerMysqlId = n;
  }
  const agg = await IssuedTicketRecord.aggregate([
    { $match: match },
    { $group: { _id: null, cnt: { $sum: 1 }, revenue: { $sum: "$fare" } } },
  ]);
  const r = agg[0];
  return {
    ticketsSold: r ? Number(r.cnt || 0) : 0,
    totalCashRemittance: r ? Number(r.revenue || 0) : 0,
  };
}

async function loadTripAndStops(busId, dayStart, dayEnd) {
  const points = await GpsHistory.find({
    busId: String(busId),
    recordedAt: { $gte: dayStart, $lt: dayEnd },
  })
    .select("latitude longitude recordedAt")
    .sort({ recordedAt: 1 })
    .lean();
  if (!points.length) {
    return {
      startTime: "—",
      endTime: "—",
      kilometers: 0,
      stops: {},
    };
  }
  let meters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    meters += haversineMeters(Number(a.latitude), Number(a.longitude), Number(b.latitude), Number(b.longitude));
  }
  const rc = await RouteCoverage.find().select("terminal stops").lean();
  const targets = ["Don Carlos", "Maramag", "Malaybalay"];
  const stopTimes = {};
  for (const t of targets) stopTimes[t] = null;
  const geos = [];
  for (const r of rc) {
    if (r?.terminal?.name) {
      geos.push({
        name: String(r.terminal.name),
        latitude: Number(r.terminal.latitude),
        longitude: Number(r.terminal.longitude),
        radius: Number(r.terminal.geofenceRadiusM || 500),
      });
    }
    if (Array.isArray(r?.stops)) {
      for (const s of r.stops) {
        if (!s?.name) continue;
        geos.push({
          name: String(s.name),
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
          radius: Number(s.geofenceRadiusM || 100),
        });
      }
    }
  }
  for (const p of points) {
    for (const target of targets) {
      if (stopTimes[target]) continue;
      const hit = geos.find((g) => g.name.toLowerCase().includes(target.toLowerCase()));
      if (!hit) continue;
      const d = haversineMeters(Number(p.latitude), Number(p.longitude), hit.latitude, hit.longitude);
      if (d <= hit.radius) {
        stopTimes[target] = hhmmManila(p.recordedAt);
      }
    }
  }
  return {
    startTime: hhmmManila(points[0].recordedAt),
    endTime: hhmmManila(points[points.length - 1].recordedAt),
    kilometers: Math.round((meters / 1000) * 100) / 100,
    stops: stopTimes,
  };
}

function createStaffProfileRouter() {
  const router = express.Router();

  router.get("/staff-profile", requireTicketIssuerJwt, async (req, res) => {
    const sub = req.ticketingUser?.sub != null ? String(req.ticketingUser.sub).trim() : "";
    if (!sub) return res.status(400).json({ error: "Could not resolve operator id from token" });

    try {
      const q = buildOperatorBusQuery(sub);
      const [profile, settings, assignedBus] = await Promise.all([
        mongoose.isValidObjectId(String(sub)) ? loadOperatorProfileFromMongo(sub) : Promise.resolve(null),
        getPortalSettingsLean(),
        q ? Bus.findOne(q).select("busId busNumber").lean() : Promise.resolve(null),
      ]);

      if (!profile) {
        return res.status(404).json({ error: "Operator profile not found" });
      }

      const companyName = safeStr(settings?.companyName) || "Bukidnon Bus Company";
      const companyPhone = safeStr(settings?.companyPhone);
      const companyEmail = safeStr(settings?.companyEmail);
      const logoUrl = safeStr(settings?.sidebarLogoUrl);
      const address = safeStr(settings?.companyLocation) || safeStr(settings?.reportFooter);

      const busNumber =
        assignedBus && (assignedBus.busNumber || assignedBus.busId) ? String(assignedBus.busNumber || assignedBus.busId) : "—";

      return res.json({
        profile: {
          id: profile.id,
          staffId: profile.staffId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          phone: profile.phone,
          role: profile.role,
          busNumber,
        },
        company: {
          name: companyName,
          phone: companyPhone,
          email: companyEmail,
          address,
          logoUrl,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to load staff profile" });
    }
  });

  router.get("/staff-shift-summary", requireTicketIssuerJwt, async (req, res) => {
    const sub = req.ticketingUser?.sub != null ? String(req.ticketingUser.sub).trim() : "";
    if (!sub) return res.status(400).json({ error: "Could not resolve operator id from token" });
    try {
      const q = buildOperatorBusQuery(sub);
      const dayStart = startOfManilaDayUtc();
      const dayEnd = endOfManilaDayUtc();
      const [profile, settings, assignedBus, log] = await Promise.all([
        mongoose.isValidObjectId(String(sub)) ? loadOperatorProfileFromMongo(sub) : Promise.resolve(null),
        getPortalSettingsLean(),
        q ? Bus.findOne(q).select("busId busNumber").lean() : Promise.resolve(null),
        q ? (async () => {
            const b = await Bus.findOne(q).select("busId").lean();
            if (!b?.busId) return null;
            return GpsLog.findOne({ busId: String(b.busId) })
              .select("source network signalStrength voltage hardwareRecordedAt")
              .lean();
          })() : Promise.resolve(null),
      ]);
      if (!profile) return res.status(404).json({ error: "Operator profile not found" });
      const busId = assignedBus?.busId != null ? String(assignedBus.busId) : null;
      const busNumber = assignedBus?.busNumber != null ? String(assignedBus.busNumber) : "—";
      const [ticketStats, trip] = await Promise.all([
        loadTodayTicketStatsByOperatorSub(sub, dayStart, dayEnd),
        busId ? loadTripAndStops(busId, dayStart, dayEnd) : Promise.resolve({ startTime: "—", endTime: "—", kilometers: 0, stops: {} }),
      ]);

      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      return res.json({
        generatedAt: new Date().toISOString(),
        date: today,
        profile: {
          id: profile.id,
          staffId: profile.staffId,
          name: `${profile.firstName} ${profile.lastName}`.trim(),
          email: profile.email,
          role: profile.role,
          busNumber,
          busId,
        },
        company: {
          name: safeStr(settings?.companyName) || "Bukidnon Bus Company, Inc.",
          phone: safeStr(settings?.companyPhone),
          email: safeStr(settings?.companyEmail),
          logoUrl: safeStr(settings?.sidebarLogoUrl),
          location: safeStr(settings?.companyLocation) || safeStr(settings?.reportFooter),
        },
        tripLog: {
          startTime: trip.startTime,
          endTime: trip.endTime,
          kilometers: trip.kilometers,
        },
        revenue: ticketStats,
        stops: {
          donCarlos: trip.stops?.["Don Carlos"] || "—",
          maramag: trip.stops?.Maramag || "—",
          malaybalay: trip.stops?.Malaybalay || "—",
        },
        hardwareHealth: {
          statement:
            log?.source === "hardware"
              ? "Tracking was active via LILYGO Hardware Backup."
              : "Tracking was active via Staff App (hardware standby).",
          source: log?.source || "staff",
          network: log?.network || "unknown",
          signalStrength: log?.signalStrength ?? null,
          voltage: log?.voltage ?? null,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to load shift summary" });
    }
  });

  router.get("/staff-eta", requireTicketIssuerJwt, async (req, res) => {
    const sub = req.ticketingUser?.sub != null ? String(req.ticketingUser.sub).trim() : "";
    if (!sub) return res.status(400).json({ error: "Could not resolve operator id from token" });
    try {
      const q = buildOperatorBusQuery(sub);
      if (!q) return res.status(400).json({ error: "No operator bus query" });
      const bus = await Bus.findOne(q).select("busId").lean();
      if (!bus?.busId) return res.status(404).json({ error: "No assigned bus" });
      const [log, nextTerminal] = await Promise.all([
        GpsLog.findOne({ busId: String(bus.busId) }).select("latitude longitude speedKph").lean(),
        resolveNextTerminalForBus(String(bus.busId)),
      ]);
      if (!log || !nextTerminal) {
        return res.json({ etaMinutes: null, targetArrivalTime: null, status: "ON TIME", nextTerminal: null });
      }
      const etaMinutes = getFreeEtaMinutes(
        Number(log.latitude),
        Number(log.longitude),
        Number(nextTerminal.latitude),
        Number(nextTerminal.longitude),
        Number(log.speedKph)
      );
      const targetArrivalTime = new Date(Date.now() + etaMinutes * 60_000).toISOString();
      const settings = await getPortalSettingsLean().catch(() => null);
      const delayThreshold = [8, 10, 12].includes(Number(settings?.delayThresholdMinutes))
        ? Number(settings.delayThresholdMinutes)
        : 10;
      res.json({
        etaMinutes,
        targetArrivalTime,
        status: etaMinutes > delayThreshold ? "DELAYED" : "ON TIME",
        nextTerminal: nextTerminal.name,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to compute ETA" });
    }
  });

  return router;
}

module.exports = { createStaffProfileRouter };

