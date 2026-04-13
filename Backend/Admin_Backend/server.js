require("dotenv").config();
const { applyPublicDnsForMongo } = require("./config/mongoDns");
applyPublicDnsForMongo();

const http = require("http");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const RouteCoverage = require("./models/RouteCoverage");
const CorridorRoute = require("./models/CorridorRoute");
const Bus = require("./models/Bus");
const GpsLog = require("./models/GpsLog");
const { enrichPublicFleetBuses } = require("./services/passengerFleetIntel");
const { Server } = require("socket.io");

const { registerSocketHandlers, setLiveBoardSnapshotProvider, broadcastLocationUpdate } = require("./sockets/socket");
const { attachAttendantLiveGpsSocket } = require("./sockets/attendantLiveGpsSocket");
const { createBusesRouter } = require("./routes/buses");
const { createReportsRouter } = require("./routes/reports");
const { startProximityWorker } = require("./services/proximityWorker");
const { createAuthTicketingRouter } = require("./routes/authTicketing");
const { logMailerBoot, isOtpEmailConfigured, describeMailProvider } = require("./services/mailer");
const { createOperatorsTicketingRouter } = require("./routes/operatorsTicketing");
const { createTicketsTicketingRouter } = require("./routes/ticketsTicketing");
const { createLocationsTicketingRouter } = require("./routes/locationsTicketing");
const { createCorridorRoutesRouter } = require("./routes/corridorRoutes");
const { createFaresRouter } = require("./routes/fares");
const { createSecurityLogsRouter } = require("./routes/securityLogs");
const { createFleetHardwareRouter } = require("./routes/fleetHardware");
const { createDriversRouter } = require("./routes/drivers");
const { createDriversSignupRouter } = require("./routes/driversSignup");
const { createAttendantsSignupRouter } = require("./routes/attendantsSignup");
const { createAdminPortalRouter } = require("./routes/adminPortal");
const { createStaffProfileRouter } = require("./routes/staffProfile");
const { adminAuditLogger } = require("./middleware/adminAuditLogger");
const { maintenanceShieldMiddleware } = require("./middleware/maintenanceShield");
const { enforceAdminRbac } = require("./middleware/enforceAdminRbac");
const { seedRbacAssignments } = require("./services/adminRbac");
const {
  createPassengerFeedbackRouter,
  handlePublicPassengerFeedbackPost,
} = require("./routes/passengerFeedback");
const { createHandlePostPassengerLostItem } = require("./routes/passengerLostItemPublic");
const { handleGetPublicBroadcast, createPostAdminBroadcastHandler } = require("./routes/appBroadcast");
const { handleGetWeatherAdvisories, startWeatherAdvisoryPoller } = require("./services/weatherLocationAdvisories");
const { handleGetPassengerCommandFeed } = require("./services/passengerCommandFeed");
const {
  createLiveDispatchRouter,
  createPublicLiveBoardHandler,
  buildPublicPayload,
} = require("./routes/liveDispatch");
const { requireAdminJwt } = require("./middleware/requireAdminJwt");
const { createNominatimProxyRouter } = require("./routes/nominatimProxy");
const { ingestDeviceGps } = require("./services/attendantGpsIngest");

const app = express();
const server = http.createServer(app);

/**
 * CORS: comma-separated origins in CORS_ORIGIN, or "*" for all.
 * CORS_ALLOW_LOCALHOST=true also allows any http(s)://localhost:* and 127.0.0.1:* (Flutter web uses random ports).
 */
function buildCorsOriginOption() {
  const raw = (process.env.CORS_ORIGIN || "").trim();
  const allowLocal =
    process.env.CORS_ALLOW_LOCALHOST === "1" || process.env.CORS_ALLOW_LOCALHOST === "true";
  if (!raw || raw === "*") {
    return true;
  }
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowLocal) {
    return list;
  }
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (list.includes(origin)) {
      callback(null, true);
      return;
    }
    try {
      const u = new URL(origin);
      const h = u.hostname.toLowerCase();
      if ((h === "localhost" || h === "127.0.0.1") && (u.protocol === "http:" || u.protocol === "https:")) {
        callback(null, true);
        return;
      }
    } catch {
      /* ignore */
    }
    callback(new Error("Not allowed by CORS"));
  };
}

const corsOptions = {
  origin: buildCorsOriginOption(),
};

app.use(cors(corsOptions));
app.use(express.json());
app.use((err, _req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  return next(err);
});

/** Before any route needs `io` (e.g. passenger-lost-item → commandAlert). */
const io = new Server(server, { cors: corsOptions });
registerSocketHandlers(io);
attachAttendantLiveGpsSocket(io);
setLiveBoardSnapshotProvider(buildPublicPayload);

app.get("/api/public/broadcast/passenger", (_req, res) => {
  handleGetPublicBroadcast("passenger", res);
});
app.get("/api/public/broadcast/attendant", (_req, res) => {
  handleGetPublicBroadcast("attendant", res);
});

/** Rain / wet-condition advisories for terminal hubs in Location Management (Open-Meteo, no API key). */
app.get("/api/public/weather-advisories", handleGetWeatherAdvisories);

/** Passenger tactical hub — dynamic command feed (weather, delays, demand, broadcasts). */
app.get("/api/public/command-feed", handleGetPassengerCommandFeed);

// Operator/Attendant read-only profile (source of truth for attendant app HUD)
app.use("/api", createStaffProfileRouter());

/** LILYGO primary endpoint alias (same ingest path as /api/buses/hardware-telemetry). */
app.post("/api/hardware-telemetry", async (req, res) => {
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
    return res.status(204).send();
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message || "hardware telemetry failed" });
  }
});

app.get("/api/public/maintenance-status", async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({
        enabled: false,
        passengerLocked: false,
        attendantLocked: false,
        message: "",
        scheduledUntil: null,
        minClientVersion: null,
        fleetMode: "standard",
      });
    }
    const { getPortalSettingsLean } = require("./services/adminPortalSettingsService");
    const s = await getPortalSettingsLean();
    const until = s.maintenanceScheduledUntil;
    const master = !!s.maintenanceShieldEnabled;
    const passengerLocked = master && s.maintenancePassengerLocked !== false;
    const attendantLocked = master && s.maintenanceAttendantLocked !== false;
    return res.json({
      enabled: master,
      passengerLocked,
      attendantLocked,
      message: s.maintenanceMessage || "",
      scheduledUntil: until ? new Date(until).toISOString() : null,
      minClientVersion: s.minAttendantAppVersion || null,
      fleetMode: s.fleetMode || "standard",
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "maintenance status failed" });
  }
});

app.get("/api/public/company-profile", async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({
        name: "Bukidnon Bus Company, Inc.",
        email: null,
        phone: null,
        location: null,
        logoUrl: null,
      });
    }
    const { getPortalSettingsLean } = require("./services/adminPortalSettingsService");
    const s = await getPortalSettingsLean();
    return res.json({
      name: s?.companyName ? String(s.companyName).trim() : "Bukidnon Bus Company, Inc.",
      email: s?.companyEmail ? String(s.companyEmail).trim() : null,
      phone: s?.companyPhone ? String(s.companyPhone).trim() : null,
      location: s?.companyLocation
        ? String(s.companyLocation).trim()
        : s?.reportFooter
          ? String(s.reportFooter).trim()
          : null,
      logoUrl: s?.sidebarLogoUrl ? String(s.sidebarLogoUrl).trim() : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "company profile failed" });
  }
});

/** Bus Attendant app: idle logout aligns with Admin Settings → Session timeout when securityPolicyApplyAttendant is on. */
app.get("/api/public/attendant-session-policy", async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({
        sessionTimeoutMinutes: 30,
        securityPolicyApplyAttendant: true,
      });
    }
    const { getPortalSettingsLean } = require("./services/adminPortalSettingsService");
    const s = await getPortalSettingsLean();
    let minutes = Number(s.sessionTimeoutMinutes);
    if (!Number.isFinite(minutes)) minutes = 30;
    minutes = Math.min(480, Math.max(5, minutes));
    const apply = s.securityPolicyApplyAttendant !== false;
    return res.json({ sessionTimeoutMinutes: minutes, securityPolicyApplyAttendant: apply });
  } catch (e) {
    res.status(500).json({ error: e.message || "attendant session policy failed" });
  }
});

app.use(maintenanceShieldMiddleware);
app.use(adminAuditLogger);

// Browsers opening http://localhost:4001/ hit this — the dashboard lives on Admin_Frontend (e.g. Vite :5173).
app.get("/", (_req, res) => {
  res.json({
    service: "Admin_Backend",
    message:
      "API is running. Open the Admin web app (Frontend/Admin_Frontend dev server), not this URL, for the dashboard UI.",
    health: "/health",
  });
});

app.get("/health", async (_req, res) => {
  const { getFirebaseRtdbHealth } = require("./config/firebaseAdmin");
  let firebaseRtdb = "disabled";
  try {
    firebaseRtdb = await getFirebaseRtdbHealth();
  } catch {
    firebaseRtdb = "error";
  }
  // gps_logs row count — matches GET /api/buses/live; 0 until attendant live-location succeeds.
  let gpsLiveBusCount = null;
  if (mongoose.connection.readyState === 1) {
    try {
      gpsLiveBusCount = await GpsLog.countDocuments();
    } catch {
      gpsLiveBusCount = null;
    }
  }
  const gpsHint =
    gpsLiveBusCount === 0 && mongoose.connection.readyState === 1
      ? "Zero rows in gps_logs yet. Either: (1) Admin View Location → Live fleet → Place test GPS pin, or POST /api/buses/admin/test-gps with admin JWT; or (2) attendant Go live + POST /api/buses/live-location 204 (bus assigned in Management)."
      : null;
  const smtpReady = isOtpEmailConfigured();
  res.json({
    ok: true,
    service: "admin-api",
    databaseMode: "mongodb",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    firebaseRtdb,
    adminLogin: "mongodb(portal_users)",
    otpEmailConfigured: smtpReady,
    smtp: smtpReady ? "configured" : "not_configured",
    smtpProvider: describeMailProvider(),
    driverSignupBase: "/api/driver-signup",
    gpsLiveBusCount,
    ...(gpsHint ? { gpsLiveHint: gpsHint } : {}),
  });
});

app.use("/api/buses", createBusesRouter(io));
/* Driver OTP signup: dedicated prefix + same router on /api/drivers for backward compatibility */
const driverSignupRouter = createDriversSignupRouter();
app.use("/api/driver-signup", driverSignupRouter);
app.use("/api/drivers", driverSignupRouter);
app.use("/api/drivers", createDriversRouter());
app.use("/api/attendants", createAttendantsSignupRouter());
app.use("/api/reports", createReportsRouter());

app.use("/api/auth", createAuthTicketingRouter());
app.use("/api/admin", createAdminPortalRouter());
app.use("/api/operators", createOperatorsTicketingRouter());
app.use("/api/tickets", createTicketsTicketingRouter());
app.use("/api/locations", createLocationsTicketingRouter());
app.use("/api/corridor-routes", createCorridorRoutesRouter());
app.use("/api/fares", createFaresRouter());
app.use("/api/security/logs", createSecurityLogsRouter());
app.use("/api/geocode", createNominatimProxyRouter());
app.use("/api/fleet", requireAdminJwt, createFleetHardwareRouter());

/**
 * Public read-only: coverage hubs (terminal + stop rows) + child stops + optional corridor waypoint.
 * Same documents admins manage under Management → Locations (no JWT).
 */
app.get("/api/public/deployed-points", async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database unavailable" });
    }
    const rows = await RouteCoverage.find({}).sort({ locationName: 1 }).lean();
    const items = rows.map((doc) => {
      const terminal = doc.terminal
        ? {
            name: doc.terminal.name,
            latitude: doc.terminal.latitude,
            longitude: doc.terminal.longitude,
            geofenceRadiusM: doc.terminal.geofenceRadiusM ?? 500,
            pickupOnly: doc.terminal.pickupOnly !== false,
            ...(Number.isFinite(Number(doc.terminal.kilometersFromStart)) && Number(doc.terminal.kilometersFromStart) >= 0
              ? { kilometersFromStart: Number(doc.terminal.kilometersFromStart) }
              : {}),
          }
        : null;
      const locationPoint =
        doc.locationPoint &&
        Number.isFinite(Number(doc.locationPoint.latitude)) &&
        Number.isFinite(Number(doc.locationPoint.longitude))
          ? {
              name:
                String(doc.locationPoint.name || "").trim() ||
                String(doc.locationName || doc.terminal?.name || "Location").trim(),
              latitude: Number(doc.locationPoint.latitude),
              longitude: Number(doc.locationPoint.longitude),
            }
          : null;
      const stops = (doc.stops || [])
        .map((s) => ({
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          sequence: s.sequence,
          geofenceRadiusM: s.geofenceRadiusM ?? 100,
          pickupOnly: s.pickupOnly !== false,
          ...(Number.isFinite(Number(s.kilometersFromStart)) && Number(s.kilometersFromStart) >= 0
            ? { kilometersFromStart: Number(s.kilometersFromStart) }
            : {}),
        }))
        .filter((s) => s.name && Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
        .sort((a, b) => a.sequence - b.sequence);
      const corridorGeofences = [];
      if (terminal && Number.isFinite(terminal.latitude) && Number.isFinite(terminal.longitude)) {
        corridorGeofences.push({
          kind: "terminal",
          name: terminal.name,
          latitude: terminal.latitude,
          longitude: terminal.longitude,
          radiusM: terminal.geofenceRadiusM,
        });
      }
      for (const s of stops) {
        corridorGeofences.push({
          kind: "stop",
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          radiusM: s.geofenceRadiusM ?? 100,
          sequence: s.sequence,
        });
      }
      return {
        id: String(doc._id),
        locationName: doc.locationName,
        terminalName: doc.terminal?.name ?? "",
        pointType: doc.pointType || "terminal",
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
        terminal,
        locationPoint,
        stops,
        corridorGeofences,
      };
    });
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to list deployed points" });
  }
});

/** Passenger: whether Command center operations deck is LIVE (fleet/map allowed). */
app.get("/api/public/operations-deck", async (_req, res) => {
  try {
    const { getPortalSettingsLean } = require("./services/adminPortalSettingsService");
    const s = await getPortalSettingsLean();
    const live = s.operationsDeckLive !== false;
    res.setHeader("Cache-Control", "public, max-age=5");
    res.json({ operationsDeckLive: live });
  } catch (e) {
    res.status(500).json({ error: e.message || "operations-deck failed" });
  }
});

/**
 * Passenger app: read-only fleet registry (buses created in admin), no JWT.
 * Omits internal operator/driver linkage and device ids.
 */
app.get("/api/public/fleet-buses", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database unavailable" });
    }
    const { isOperationsDeckLive } = require("./services/adminPortalSettingsService");
    if (!(await isOperationsDeckLive())) {
      res.setHeader("Cache-Control", "public, max-age=5");
      return res.json({ items: [] });
    }
    function hubLabel(cov) {
      if (!cov || typeof cov !== "object") return null;
      const t = cov.terminal && String(cov.terminal.name || "").trim();
      if (t) return t;
      const ln = String(cov.locationName || "").trim();
      return ln || null;
    }
    function normRouteKey(s) {
      return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[–—−]/g, "-")
        .replace(/↔/g, "->")
        .replace(/\u2194/g, "->")
        .replace(/\u2192/g, "->");
    }
    const corridorDocs = await CorridorRoute.find()
      .populate("originCoverageId")
      .populate("destinationCoverageId")
      .lean();
    const corridorMetas = corridorDocs.map((doc) => {
      const start = hubLabel(doc.originCoverageId);
      const end = hubLabel(doc.destinationCoverageId);
      const display =
        (doc.displayName && String(doc.displayName).trim()) || (start && end ? `${start} → ${end}` : null);
      return { start, end, display };
    });
    const sortedForRouteIndex = [...corridorMetas].sort((a, b) =>
      (a.display || "").localeCompare(b.display || "", undefined, { sensitivity: "base" })
    );

    function matchRouteEndpoints(routeStr) {
      const raw = String(routeStr || "").trim();
      if (!raw) return { routeStart: null, routeEnd: null };
      const n = normRouteKey(raw);
      for (const m of corridorMetas) {
        if (!m.display) continue;
        if (normRouteKey(m.display) === n && m.start && m.end) return { routeStart: m.start, routeEnd: m.end };
        if (m.start && m.end) {
          const arrow = normRouteKey(`${m.start} → ${m.end}`);
          const dash = normRouteKey(`${m.start} - ${m.end}`);
          const bi = normRouteKey(`${m.start} ↔ ${m.end}`);
          if (arrow === n || dash === n || bi === n) return { routeStart: m.start, routeEnd: m.end };
        }
      }
      const idxMatch = /^route\s*(\d+)\s*$/i.exec(raw);
      if (idxMatch) {
        const idx = parseInt(idxMatch[1], 10) - 1;
        if (idx >= 0 && idx < sortedForRouteIndex.length) {
          const hit = sortedForRouteIndex[idx];
          if (hit.start && hit.end) return { routeStart: hit.start, routeEnd: hit.end };
        }
      }
      const parts = raw.split(/\s*(?:→|->|—>|–>)\s*/);
      if (parts.length >= 2) {
        const a = parts[0].trim();
        const b = parts.slice(1).join(" → ").trim();
        if (a && b) return { routeStart: a, routeEnd: b };
      }
      return { routeStart: null, routeEnd: null };
    }

    const rows = await Bus.find().sort({ busId: 1 }).lean();
    const items = rows.map((b) => {
      const route = b.route && String(b.route).trim() ? String(b.route).trim() : null;
      const { routeStart, routeEnd } = matchRouteEndpoints(route);
      const hubOrderLabels = Array.isArray(b.hubOrderLabels)
        ? b.hubOrderLabels.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      return {
        busId: b.busId,
        busNumber: b.busNumber || b.busId,
        plateNumber: b.plateNumber && String(b.plateNumber).trim() ? String(b.plateNumber).trim() : null,
        route,
        routeStart,
        routeEnd,
        hubOrderLabels,
        tripSegmentStartedAt: b.tripSegmentStartedAt
          ? new Date(b.tripSegmentStartedAt).toISOString()
          : null,
        status: b.status || "Active",
        seatCapacity:
          typeof b.seatCapacity === "number" && Number.isFinite(b.seatCapacity) && b.seatCapacity > 0
            ? b.seatCapacity
            : 50,
      };
    });
    const viewerHub = String(req.query?.viewerHub || "").trim();
    const userLat = parseFloat(String(req.query?.userLat ?? ""));
    const userLng = parseFloat(String(req.query?.userLng ?? ""));
    let enriched = items;
    try {
      enriched = await enrichPublicFleetBuses(items, {
        viewerHub,
        userLat: Number.isFinite(userLat) ? userLat : undefined,
        userLng: Number.isFinite(userLng) ? userLng : undefined,
      });
    } catch (e) {
      console.warn("[fleet-buses] enrich failed:", e.message || e);
    }
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json({ items: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to list fleet buses" });
  }
});

/**
 * Passenger fare calculator — same engine as ticketing quote, no JWT.
 * Body: { startLocation, destination, passengerCategory?: regular|student|senior|pwd|adult }
 */
app.post("/api/public/fare-quote", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database unavailable" });
    }
    const { computeTicketFare } = require("./services/farePricing");
    const body = req.body || {};
    const start = String(body.startLocation || "").trim();
    const dest = String(body.destination || "").trim();
    let category = String(body.passengerCategory || "regular").trim().toLowerCase();
    if (!start || !dest) {
      return res.status(400).json({ error: "startLocation and destination are required" });
    }
    const catNorm =
      category === "regular" || category === "adult"
        ? "adult"
        : ["student", "pwd", "senior"].includes(category)
          ? category
          : "adult";
    const pricing = await computeTicketFare({
      startLocation: start,
      destination: dest,
      category: catNorm,
      clientFare: null,
    });
    if (!pricing.matched) {
      const msg =
        typeof pricing.message === "string" && pricing.message.trim()
          ? pricing.message.trim()
          : "No priced path for this trip.";
      return res.json({
        matched: false,
        message: msg,
        passengerCategory: catNorm,
      });
    }
    const subtotal = Number(pricing.subtotalRoundedHalfPeso);
    const fare = Number(pricing.fare);
    const discPct = Number(pricing.discountPct) || 0;
    const discountAmount =
      Number.isFinite(subtotal) && Number.isFinite(fare) && discPct > 0
        ? Math.round(Math.max(0, subtotal - fare) * 100) / 100
        : 0;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      matched: true,
      fare,
      baseFarePesos: pricing.baseFarePesos,
      distanceChargePesos: Number(pricing.distanceChargePesos) || 0,
      subtotalRoundedHalfPeso: pricing.subtotalRoundedHalfPeso,
      discountPct: discPct,
      discountAmount,
      passengerCategory: pricing.categoryUsed,
      pricingMode: pricing.pricingMode,
      fareBreakdownDisplay: pricing.fareBreakdownDisplay || null,
      pricingSummary:
        typeof pricing.pricingSummary === "string" && pricing.pricingSummary.trim()
          ? pricing.pricingSummary.trim()
          : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Fare quote failed" });
  }
});

/** Passenger live departures — pairs admin trip blocks with optional GPS-aware ETA hints */
app.get("/api/public/live-board", createPublicLiveBoardHandler());

/** Alias for trip updates (e.g. geofence arrival sync) — same backing store as live-dispatch blocks. */
app.put("/api/schedules/:trip_id", requireAdminJwt, async (req, res) => {
  const store = require("./services/liveDispatchStore");
  const { broadcastLiveBoard } = require("./sockets/socket");
  try {
    const next = store.updateBlock(req.params.trip_id, req.body || {});
    if (!next) return res.status(404).json({ error: "Trip not found" });
    const payload = await buildPublicPayload();
    broadcastLiveBoard(io, payload);
    res.json(next);
  } catch (e) {
    res.status(500).json({ error: e.message || "schedule update failed" });
  }
});

app.use("/api/live-dispatch", requireAdminJwt, createLiveDispatchRouter(io));

app.use("/api/passenger-feedback", createPassengerFeedbackRouter());

app.post("/api/admin/broadcast", requireAdminJwt, createPostAdminBroadcastHandler(io));

/**
 * Passenger web JSON POSTs — registered here (before the `/api` JSON 404) so paths are never swallowed.
 * Same handlers as historically mounted on `express.Router()` under `/api/public`.
 */
app.post("/api/public/passenger-feedback", handlePublicPassengerFeedbackPost);
app.post("/api/public/passenger-lost-item", createHandlePostPassengerLostItem(io));

/** JSON 404s so clients (e.g. Flutter) never get HTML that breaks jsonDecode. */
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found.",
  });
});

console.log("Mongo-only mode enabled. SQL ticketing modules are disabled.");

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGODB_URI — copy .env.example to .env and set your Atlas URI.");
  process.exit(1);
}

/** Stops scheduled daily ops digest on shutdown (if started). */
let stopDailyOpsCron = () => {};

mongoose
  .connect(uri, { serverSelectionTimeoutMS: 30_000 })
  .then(async () => {
    console.log("MongoDB connected (admin-api)");
    try {
      const { initAdminAuthLockout } = require("./services/adminAuthLockout");
      await initAdminAuthLockout();
    } catch (e) {
      console.warn("AdminAuthLockout init:", e.message);
    }
    try {
      await seedRbacAssignments();
    } catch (e) {
      console.warn("RBAC seed:", e.message);
    }
    try {
      startWeatherAdvisoryPoller();
    } catch (e) {
      console.warn("[weather-advisories] poller failed to start:", e.message || e);
    }
    const stopProximity = startProximityWorker(io);

    const port = Number(process.env.PORT) || 4001;
    server.listen(port, () => {
      logMailerBoot();
      try {
        const { startDailyOperationsReportCron } = require("./services/dailyOperationsReportCron");
        const cronApi = startDailyOperationsReportCron();
        stopDailyOpsCron = typeof cronApi.stop === "function" ? cronApi.stop : () => {};
      } catch (e) {
        console.warn("[daily-ops-cron] init failed:", e.message || e);
      }
      console.log(`admin-api listening on http://localhost:${port}`);
      console.log(`  GET  /api/buses/live`);
      console.log(`  GET  /api/public/deployed-points`);
      console.log(`  GET  /api/public/command-feed`);
      console.log(`  GET  /api/public/operations-deck`);
      console.log(`  GET  /api/public/fleet-buses`);
      console.log(`  POST /api/buses/ping`);
      console.log(`  POST /api/tickets/issue (operator JWT)`);
      console.log(`  POST /api/attendants/verify-email | verify-otp | save-attendant`);
      console.log(`  POST /api/driver-signup/verify-email | verify-otp | save-driver (also under /api/drivers/…)`);
      console.log(`  GET  /api/drivers/verified | GET /api/attendants/verified`);
      console.log(`  POST /api/auth/operator-forgot-password-otp | operator-verify-reset-otp | operator-reset-password-token`);
    });

    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log("\nShutting down admin-api…");
      try {
        stopDailyOpsCron();
      } catch (_) {}
      try {
        stopProximity();
      } catch (_) {}
      try {
        io.disconnectSockets(true);
        io.close();
      } catch (_) {}
      try {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      } catch (_) {}
      server.close(() => {
        mongoose.connection.close(false).finally(() => process.exit(0));
      });
      // If WebSockets/keep-alive still block server.close(), exit anyway (common on Windows).
      setTimeout(() => process.exit(0), 2000).unref();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
