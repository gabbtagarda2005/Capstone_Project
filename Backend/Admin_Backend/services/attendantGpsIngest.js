const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const GpsHistory = require("../models/GpsHistory");
const PortalUser = require("../models/PortalUser");
const { onBusGpsForTerminalArrival } = require("./terminalGeofenceIntercept");
const { maybeRecordSpeedViolation } = require("./speedViolationAlert");
const { normalizeGpsSignal } = require("./normalizeGpsSignal");
const { decideActiveSource, getActiveSource } = require("./gpsSourceArbiter");
const { checkGpsOutlier } = require("./gpsOutlierGuard");
const { isValidGpsCoordinate, resolveRecordedAtFromClientTimestamp } = require("./gpsValidation");
const { buildPublicPayload } = require("../routes/liveDispatch");
const { broadcastLiveBoard } = require("../sockets/socket");
const liveDispatchStore = require("./liveDispatchStore");
const AppBroadcast = require("../models/AppBroadcast");
const { getFreeEtaMinutes, getAdvancedEtaMinutes, resolveNextTerminalForBus, isNearAnyTerminal, getCorridorPolylineForBus, matchCorridorForBus } = require("./freeEtaEngine");
const { nearestPointOnPolyline } = require("./corridorGeometry");
const { matchPointToSegment } = require("./corridorSegments");
const { MOVING_SPEED_MIN_KPH } = require("./corridorFreeFlowCalibration");
const { getPortalSettingsLean } = require("./adminPortalSettingsService");
const { computeBusCongestion } = require("./congestionEngine");
const { classifyDelay } = require("./delayClassifier");
const { manilaNowMinutes, parseHmToMinutes } = require("./manilaTime");

/** Best-effort: which real road segment (services/corridorSegments.js) this fix belongs to, for
 *  tagging GpsHistory rows so they become usable segment-level traffic history. Only matches
 *  moving fixes (reuses corridorFreeFlowCalibration's own "moving" cutoff) — a parked/idle bus
 *  isn't a traffic sample. Never blocks ingestion: any failure here just means the row is stored
 *  without a segment tag, exactly like today. */
async function resolveSegmentMatchForHistory(busId, lat, lon, speedKph) {
  const speed = Number(speedKph);
  if (!Number.isFinite(speed) || speed < MOVING_SPEED_MIN_KPH) return { segmentId: null, corridorId: null };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { segmentId: null, corridorId: null };
  try {
    const corridor = await matchCorridorForBus(String(busId));
    if (!corridor) return { segmentId: null, corridorId: null };
    const match = await matchPointToSegment(corridor, lat, lon);
    if (!match) return { segmentId: null, corridorId: null };
    return { segmentId: match.segment.segmentId, corridorId: corridor._id };
  } catch {
    return { segmentId: null, corridorId: null };
  }
}
/** Hardware (LILYGO) fixes within this distance of the bus's assigned corridor get snapped onto
 *  the road — GNSS noise/multipath near terrain routinely lands a genuine on-road position a
 *  hundred-ish meters into adjacent ground (hillside, treeline) with no on-road alternative
 *  nearby. Beyond this, treat it as a real position (possible detour, or a fix bad enough that
 *  snapping would hide the problem instead of showing it) and publish it unchanged. */
const HARDWARE_SNAP_MAX_METERS = 150;

/** Best-effort — never let corridor lookup/OSRM trouble block a GPS ingest. */
async function snapHardwareFixToCorridor(busId, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const polyline = await getCorridorPolylineForBus(busId);
    if (!polyline) return null;
    const nearest = nearestPointOnPolyline(lat, lng, polyline);
    if (!nearest || nearest.distanceMeters > HARDWARE_SNAP_MAX_METERS) return null;
    return nearest;
  } catch {
    return null;
  }
}
let lastLiveBoardGpsPush = 0;
const LIVE_BOARD_GPS_MIN_MS = 12_000;
const SLOW_SPEED_KPH = 15;
const SLOW_WINDOW_MS = 2 * 60_000;
const slowStateByBus = new Map();
let delayThresholdCache = { value: 10, at: 0 };

async function getDelayThresholdMinutes() {
  const now = Date.now();
  if (now - delayThresholdCache.at < 10_000) return delayThresholdCache.value;
  try {
    const s = await getPortalSettingsLean();
    const n = Number(s?.delayThresholdMinutes);
    const v = n === 8 || n === 10 || n === 12 ? n : 10;
    delayThresholdCache = { value: v, at: now };
    return v;
  } catch {
    return delayThresholdCache.value || 10;
  }
}

function scheduleLiveBoardPushFromGps(io) {
  if (!io) return;
  const now = Date.now();
  if (now - lastLiveBoardGpsPush < LIVE_BOARD_GPS_MIN_MS) return;
  lastLiveBoardGpsPush = now;
  void buildPublicPayload()
    .then((payload) => broadcastLiveBoard(io, payload))
    .catch(() => {});
}

/** Attendant-app-specific timestamp field aliases, delegating the actual clamp logic to the
 *  shared helper (also used by the LILYGO hardware/SMS ingest paths below). */
function resolveRecordedAt(body) {
  const raw = body?.clientRecordedAt ?? body?.recorded_at;
  return resolveRecordedAtFromClientTimestamp(raw);
}

/** [GPS]-prefixed transition logs, fired only when the arbiter's active source actually changes —
 *  matches the exact log vocabulary requested for the phone/hardware/SMS failover state machine. */
function logGpsSourceTransition(busId, prevActive, nextActive) {
  if (!prevActive || !nextActive || prevActive === nextActive) return;
  const tag = `[GPS][bus ${String(busId)}]`;
  if (nextActive === "phone") {
    console.log(`${tag} Staff GPS restored`);
    return;
  }
  if (prevActive === "phone" && nextActive === "lilygo") {
    console.log(`${tag} Staff GPS stale`);
    console.log(`${tag} Hardware mobile telemetry active`);
    return;
  }
  if (prevActive === "phone" && nextActive === "lilygo_sms") {
    console.log(`${tag} Staff GPS stale`);
    console.log(`${tag} SMS fallback ACTIVATED`);
    return;
  }
  if (prevActive === "lilygo" && nextActive === "lilygo_sms") {
    console.log(`${tag} Mobile telemetry failed`);
    console.log(`${tag} SMS fallback ACTIVATED`);
    return;
  }
  if (prevActive === "lilygo_sms" && nextActive === "lilygo") {
    console.log(`${tag} Hardware mobile telemetry restored`);
    console.log(`${tag} SMS fallback stopped`);
  }
}

/** gpsSourceArbiter's internal vocabulary (phone/lilygo/lilygo_sms) → GpsLog.source vocabulary
 *  (staff/hardware/hardware_sms) used everywhere else in this codebase (routes, sockets, UI). */
function mapArbiterSourceToGpsSource(arbiterSource) {
  if (arbiterSource === "phone") return "staff";
  if (arbiterSource === "lilygo") return "hardware";
  if (arbiterSource === "lilygo_sms") return "hardware_sms";
  return null;
}

async function maybeFlipDispatchDelayed(busId) {
  const targetBus = String(busId || "").trim();
  if (!targetBus) return false;
  const delayThresholdMinutes = await getDelayThresholdMinutes();
  const blocks = liveDispatchStore.listBlocks();
  const row = blocks.find((b) => String(b.busId || "").trim() === targetBus);
  if (!row || row.status === "cancelled" || row.status === "arriving") return false;
  const scheduledMin = parseHmToMinutes(row.scheduledDeparture);
  if (scheduledMin == null) return false;
  const lag = manilaNowMinutes() - scheduledMin;
  const shouldDelay = lag > delayThresholdMinutes;
  if (shouldDelay && row.status !== "delayed") {
    liveDispatchStore.updateBlock(row.id, { status: "delayed" });
    return true;
  }
  if (!shouldDelay && row.status === "delayed") {
    liveDispatchStore.updateBlock(row.id, { status: "on-time" });
    return true;
  }
  return false;
}

async function maybeComputeEtaAndTrafficDelay(io, busId, latitude, longitude, speedKph) {
  const delayThresholdMinutes = await getDelayThresholdMinutes();
  const bid = String(busId || "").trim();
  if (!bid || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return null;
  const terminal = await resolveNextTerminalForBus(bid);
  if (!terminal) return null;

  const speed = Number(speedKph);
  const canEstimateEta = Number.isFinite(speed) && speed > 5;

  let bus = null;
  let etaMinutes = null;
  let trafficSource = "unavailable";
  let confidence = "UNKNOWN";

  if (canEstimateEta) {
    try {
      bus = await Bus.findOne({ busId: bid }).select("seatCapacity currentOccupancy route").lean();
    } catch (err) {
      console.warn(`[ETA] Failed to fetch bus details for ${bid}: ${err.message}`);
    }

    try {
      const etaResult = await getAdvancedEtaMinutes({
        lat1: Number(latitude),
        lon1: Number(longitude),
        lat2: Number(terminal.latitude),
        lon2: Number(terminal.longitude),
        speedKph: speed,
        busId: bid,
        passengerCount: bus?.currentOccupancy || 0,
        seatCapacity: bus?.seatCapacity || 50,
        currentLocation: bus?.route || "In Transit",
        nextLocation: terminal.name || "Terminal",
        stops: [],
      });
      etaMinutes = etaResult.etaMinutes;
      trafficSource = etaResult.trafficSource;
      confidence = etaResult.confidence;
    } catch (err) {
      console.warn(`[ETA] Advanced ETA calculation failed, using fallback: ${err.message}`);
      etaMinutes = getFreeEtaMinutes(
        Number(latitude),
        Number(longitude),
        Number(terminal.latitude),
        Number(terminal.longitude),
        speed
      );
    }
  }
  const nowMs = Date.now();
  const nearTerminal = await isNearAnyTerminal(Number(latitude), Number(longitude));

  // Real congestion + delay-tier classification (see congestionEngine.js/delayClassifier.js) —
  // additive alongside the slow-window heuristic below, which still drives the existing
  // dispatch-status flip and attendant broadcast. This fix was just ingested, so GPS is "live".
  const congestion = await computeBusCongestion({ busId: bid, latitude: Number(latitude), longitude: Number(longitude), speedKph: speed }).catch(
    () => ({ status: "unavailable", reason: "Congestion engine error" })
  );
  const delay = await classifyDelay({
    busId: bid,
    gpsFreshness: "live",
    latitude: Number(latitude),
    longitude: Number(longitude),
    speedKph: speed,
    congestion,
  }).catch(() => ({ tier: "UNKNOWN", delayMinutes: null, reason: "Delay reason unavailable", congestionLevel: null }));

  const isSlow = Number.isFinite(speed) && speed < SLOW_SPEED_KPH && !nearTerminal;
  const prev = slowStateByBus.get(bid) || { startedAt: null };
  let startedAt = prev.startedAt;
  if (isSlow) {
    if (!startedAt) startedAt = nowMs;
  } else {
    startedAt = null;
  }
  slowStateByBus.set(bid, { startedAt });
  const trafficDelay = Boolean(isSlow && startedAt && nowMs - startedAt >= SLOW_WINDOW_MS);
  if (trafficDelay) {
    const blocks = liveDispatchStore.listBlocks();
    const row = blocks.find((b) => String(b.busId || "").trim() === bid);
    if (row && row.status !== "cancelled" && row.status !== "arriving" && row.status !== "delayed") {
      liveDispatchStore.updateBlock(row.id, { status: "delayed" });
      scheduleLiveBoardPushFromGps(io);
    }
    if (Number.isFinite(etaMinutes) && etaMinutes >= delayThresholdMinutes) {
      await AppBroadcast.findOneAndUpdate(
        { target: "attendant" },
        {
          $set: {
            message: `Heavy Traffic Detected. Please inform passengers of a potential +${etaMinutes} minute delay.`,
            severity: "medium",
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).catch(() => {});
    }
  }
  const blocks = liveDispatchStore.listBlocks();
  const row = blocks.find((b) => String(b.busId || "").trim() === bid && b.status !== "cancelled");
  if (row) {
    liveDispatchStore.updateBlock(row.id, {
      etaMinutes,
      etaTargetIso: Number.isFinite(etaMinutes) ? new Date(nowMs + etaMinutes * 60_000).toISOString() : null,
      nextTerminal: terminal.name,
    });
    scheduleLiveBoardPushFromGps(io);
  }
  return {
    etaMinutes,
    etaTargetIso: Number.isFinite(etaMinutes) ? new Date(nowMs + etaMinutes * 60_000).toISOString() : null,
    nextTerminal: terminal.name,
    trafficDelay,
    congestion,
    delay,
    // Additive — see services/trafficProviders/ (never "live_provider" until a real traffic API
    // key is configured) and services/trafficConfidence.js.
    trafficSource,
    confidence,
  };
}

function buildOperatorBusQuery(sub) {
  const s = sub != null ? String(sub).trim() : "";
  if (!s) return null;
  if (mongoose.isValidObjectId(s)) {
    return { operatorPortalUserId: new mongoose.Types.ObjectId(s) };
  }
  if (/^\d+$/.test(s)) {
    return { operatorMysqlId: Number(s) };
  }
  return null;
}

async function resolveAttendantMetaFromTicketingUser(ticketingUser) {
  if (!ticketingUser) return { attendantSub: null, attendantName: null };
  const sub = ticketingUser.sub != null ? String(ticketingUser.sub).trim() : "";
  const role = String(ticketingUser.role || "");
  if (role === "Admin") {
    return {
      attendantSub: null,
      attendantName: ticketingUser.email != null ? String(ticketingUser.email) : "Admin",
    };
  }
  let name = ticketingUser.email != null ? String(ticketingUser.email) : "";
  if (mongoose.isValidObjectId(sub)) {
    const op = await PortalUser.findById(sub).select("firstName lastName email").lean();
    if (op) {
      name =
        `${op.firstName != null ? String(op.firstName) : ""} ${op.lastName != null ? String(op.lastName) : ""}`.trim() ||
        (op.email != null ? String(op.email) : name);
    }
  }
  return { attendantSub: sub || null, attendantName: name || null };
}

/**
 * Shared path for REST live-location and Socket.io attendant stream.
 * @param {import("socket.io").Server} io
 * @param {(io: import("socket.io").Server, payload: object) => void} broadcastLocationUpdate
 */
async function ingestAttendantGps(io, broadcastLocationUpdate, ticketingUser, body) {
  const q = buildOperatorBusQuery(ticketingUser?.sub);
  if (!q) {
    const e = new Error("Could not resolve operator id from token");
    e.statusCode = 400;
    throw e;
  }
  const { latitude, longitude, speedKph, heading, forceSync, precisionHandshake, signal, signal_status } = body || {};
  const isForceSync = Boolean(forceSync || precisionHandshake);
  const signalNorm = normalizeGpsSignal(signal ?? signal_status);
  if (latitude === undefined || longitude === undefined) {
    const e = new Error("latitude, longitude required");
    e.statusCode = 400;
    throw e;
  }
  if (!isValidGpsCoordinate(latitude, longitude)) {
    const e = new Error("Invalid or unavailable GPS coordinates");
    e.statusCode = 400;
    throw e;
  }
  const b = await Bus.findOne(q).select("busId route operatorMysqlId operatorPortalUserId status").lean();
  if (!b?.busId) {
    const e = new Error("No bus assignment for this operator");
    e.statusCode = 403;
    throw e;
  }
  if (String(b.status || "").trim() === "Inactive") {
    const e = new Error(
      "This bus has been deactivated. You cannot transmit GPS until an administrator reactivates the unit."
    );
    e.statusCode = 403;
    throw e;
  }
  const meta = await resolveAttendantMetaFromTicketingUser(ticketingUser);
  const resolvedBusId = b.busId;
  const recordedAt = resolveRecordedAt(body);

  const prevActiveArbiterSource = getActiveSource(resolvedBusId);
  // Phone is the primary GPS source — always preferred. This only defers to LILYGO during the
  // brief stabilization window right after the phone recovers from an outage (see gpsSourceArbiter).
  const { shouldPublish: sourceWantsPublish, activeSource: nextActiveArbiterSource } = decideActiveSource(
    resolvedBusId,
    "phone",
    null,
    Date.now()
  );
  logGpsSourceTransition(resolvedBusId, prevActiveArbiterSource, nextActiveArbiterSource);

  const prevDoc = await GpsLog.findOne({ busId: String(resolvedBusId) })
    .select("attendantLatitude attendantLongitude attendantRecordedAt")
    .lean();
  const { outlier: isOutlier } = await checkGpsOutlier({
    busId: resolvedBusId,
    source: "phone",
    lat: Number(latitude),
    lng: Number(longitude),
    recordedAtMs: recordedAt.getTime(),
    prevLat: Number(prevDoc?.attendantLatitude),
    prevLng: Number(prevDoc?.attendantLongitude),
    prevRecordedAtMs: prevDoc?.attendantRecordedAt ? new Date(prevDoc.attendantRecordedAt).getTime() : null,
  });
  const shouldPublish = sourceWantsPublish && !isOutlier;

  const gpsLogSet = {
    busId: String(resolvedBusId),
    attendantLatitude: Number(latitude),
    attendantLongitude: Number(longitude),
    attendantRecordedAt: recordedAt,
    activeGpsSource: mapArbiterSourceToGpsSource(nextActiveArbiterSource),
    ...(signalNorm ? { signal: signalNorm } : {}),
  };
  if (shouldPublish) {
    Object.assign(gpsLogSet, {
      latitude: Number(latitude),
      longitude: Number(longitude),
      speedKph: speedKph != null ? Number(speedKph) : null,
      heading: heading != null ? Number(heading) : null,
      source: "staff",
      network: null,
      signalStrength: null,
      recordedAt,
    });
  }
  await GpsLog.findOneAndUpdate({ busId: String(resolvedBusId) }, gpsLogSet, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  await Bus.updateOne({ busId: String(resolvedBusId) }, { lastSeenAt: recordedAt }).catch(() => {});

  if (!shouldPublish) {
    // Either LILYGO is still the active/published source (mid stabilization window), or this fix
    // implied an impossible jump from the last phone position (see gpsOutlierGuard) — either way
    // it's recorded above but must not move the map pin or fire side effects.
    return { busId: String(resolvedBusId), recordedAt, published: false, outlier: isOutlier };
  }

  const payload = {
    busId: String(resolvedBusId),
    latitude: Number(latitude),
    longitude: Number(longitude),
    speedKph: speedKph != null ? Number(speedKph) : null,
    heading: heading != null ? Number(heading) : null,
    recordedAt: recordedAt.toISOString(),
    attendantSub: meta.attendantSub != null ? String(meta.attendantSub) : null,
    attendantName: meta.attendantName != null ? String(meta.attendantName) : null,
    source: "staff",
    sourceFlag: "mobile",
    net: null,
    signalStrength: null,
    forceSync: isForceSync,
    ...(signalNorm ? { signal: signalNorm } : {}),
  };
  const etaMeta = await maybeComputeEtaAndTrafficDelay(io, resolvedBusId, latitude, longitude, speedKph).catch(() => null);
  if (etaMeta) {
    payload.etaMinutes = etaMeta.etaMinutes;
    payload.etaTargetIso = etaMeta.etaTargetIso;
    payload.nextTerminal = etaMeta.nextTerminal;
    payload.trafficDelay = etaMeta.trafficDelay;
    payload.congestion = etaMeta.congestion;
    payload.delay = etaMeta.delay;
    payload.trafficSource = etaMeta.trafficSource;
    payload.confidence = etaMeta.confidence;
  }
  broadcastLocationUpdate(io, payload);
  if (await maybeFlipDispatchDelayed(resolvedBusId)) scheduleLiveBoardPushFromGps(io);
  scheduleLiveBoardPushFromGps(io);
  void onBusGpsForTerminalArrival(io, String(resolvedBusId), Number(latitude), Number(longitude)).catch(() => {});

  try {
    const segMatch = await resolveSegmentMatchForHistory(resolvedBusId, Number(latitude), Number(longitude), speedKph);
    await GpsHistory.create({
      busId: String(resolvedBusId),
      latitude: Number(latitude),
      longitude: Number(longitude),
      speedKph: speedKph != null ? Number(speedKph) : null,
      heading: heading != null ? Number(heading) : null,
      signal: signalNorm || null,
      segmentId: segMatch.segmentId,
      corridorId: segMatch.corridorId,
      recordedAt,
    });
  } catch (e) {
    console.warn("[attendantGpsIngest] GpsHistory.create failed:", e.message || e);
  }

  const violationAttendantName = meta.attendantName || (await resolveAssignedAttendantName(b));
  void maybeRecordSpeedViolation(io, {
    busId: resolvedBusId,
    speedKph,
    latitude,
    longitude,
    attendantName: violationAttendantName,
    assignedRoute: b.route != null ? String(b.route) : null,
  });

  return { busId: String(resolvedBusId), recordedAt, published: true };
}

/**
 * Remove this operator's assigned bus from live map storage (gps_logs).
 * Call on attendant sign-out, socket disconnect, or explicit end-shift.
 * @param {(io: import("socket.io").Server, busId: string) => void} [broadcastOffline]
 */
async function clearAttendantLiveSession(io, broadcastOffline, ticketingUser) {
  const q = buildOperatorBusQuery(ticketingUser?.sub);
  if (!q) {
    return { cleared: false };
  }
  const b = await Bus.findOne(q).select("busId").lean();
  if (!b?.busId) {
    return { cleared: false };
  }
  const busId = String(b.busId);
  await GpsLog.deleteOne({ busId }).catch(() => {});
  if (typeof broadcastOffline === "function") broadcastOffline(io, busId);
  return { cleared: true, busId };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * For LILYGO / hardware pings (no JWT): fill SecurityLog.attendantDisplayName from Fleet assignment when possible.
 */
async function resolveAssignedAttendantName(busLean) {
  if (!busLean || typeof busLean !== "object") return null;
  try {
    if (busLean.operatorPortalUserId) {
      const u = await PortalUser.findById(busLean.operatorPortalUserId).select("firstName lastName email").lean();
      if (u) {
        const n = [u.firstName, u.lastName].map((x) => String(x || "").trim()).filter(Boolean).join(" ").trim();
        return n || (u.email ? String(u.email).trim() : null);
      }
    }
  } catch (e) {
    console.warn("[attendantGpsIngest] resolveAssignedAttendantName:", e.message || e);
  }
  return null;
}

/** When the device omits speedKph, derive km/h from distance / time vs last hardware fix. */
function estimateSpeedKphFromPrevHardware(doc, hwLat, hwLng, nowMs) {
  if (!doc) return null;
  const pLat = Number(doc.hardwareLatitude);
  const pLng = Number(doc.hardwareLongitude);
  const tPrev = doc.hardwareRecordedAt ? new Date(doc.hardwareRecordedAt).getTime() : 0;
  if (!Number.isFinite(pLat) || !Number.isFinite(pLng) || !Number.isFinite(tPrev) || tPrev <= 0) return null;
  const dtSec = (nowMs - tPrev) / 1000;
  if (dtSec < 1 || dtSec > 7200) return null;
  const dM = haversineMeters(pLat, pLng, hwLat, hwLng);
  const kph = (dM / dtSec) * 3.6;
  if (!Number.isFinite(kph) || kph < 0) return null;
  return Math.min(199, Math.round(kph * 10) / 10);
}

/** LilyGo / IMEI ping — no operator JWT; bus id already resolved. Optional body.recordedAt (ISO
 *  string, the device's own GNSS-derived fix time) is used so ring-buffer-replayed records sent
 *  after a connectivity outage keep their true original timestamp instead of collapsing onto
 *  server-arrival time; falls back to "now" when absent, matching prior behavior. Optional
 *  body.deviceId (IngestDevice.deviceId) is persisted for admin visibility only. Note:
 *  body.source, if the client sends one, is intentionally never read here — this function always
 *  publishes as source="hardware" regardless of any client claim (see ingestHardwareSmsGps for the
 *  only other place "hardware_sms" is ever written; which function is called, not a request field,
 *  is what determines the published source — closing a spoofing gap). */
async function ingestDeviceGps(io, broadcastLocationUpdate, resolvedBusId, body) {
  const { latitude, longitude, speedKph, heading } = body || {};
  if (latitude === undefined || longitude === undefined) {
    const e = new Error("latitude, longitude required");
    e.statusCode = 400;
    throw e;
  }
  if (!isValidGpsCoordinate(latitude, longitude)) {
    const e = new Error("Invalid or unavailable GPS coordinates");
    e.statusCode = 400;
    throw e;
  }
  const recordedAt = body?.recordedAt != null ? resolveRecordedAtFromClientTimestamp(body.recordedAt) : new Date();
  const deviceId = body?.deviceId != null ? String(body.deviceId).trim() || null : null;
  const busLean = await Bus.findOne({ busId: String(resolvedBusId) })
    .select("route operatorMysqlId operatorPortalUserId")
    .lean();
  const bid = String(resolvedBusId);
  const doc = await GpsLog.findOne({ busId: bid }).lean();
  const hwLat = Number(latitude);
  const hwLng = Number(longitude);
  let nextLat = hwLat;
  let nextLng = hwLng;
  const nextSource = "hardware";
  const prevActiveArbiterSource = getActiveSource(bid);
  /** LILYGO is backup-only: phone (primary) wins whenever it's within its timeout window — see
   *  gpsSourceArbiter for why this replaces the older recency-only fusion logic that was reverted
   *  (it had hidden legitimate hardware fixes; this version tracks explicit per-bus state instead). */
  const { shouldPublish: sourceWantsPublish, activeSource: nextActiveArbiterSource } = decideActiveSource(
    bid,
    "lilygo",
    { phoneLastRecordedAt: doc?.attendantRecordedAt ?? null },
    recordedAt.getTime()
  );
  logGpsSourceTransition(bid, prevActiveArbiterSource, nextActiveArbiterSource);
  const { outlier: isOutlier } = await checkGpsOutlier({
    busId: bid,
    source: "hardware",
    lat: hwLat,
    lng: hwLng,
    recordedAtMs: recordedAt.getTime(),
    prevLat: Number(doc?.hardwareLatitude),
    prevLng: Number(doc?.hardwareLongitude),
    prevRecordedAtMs: doc?.hardwareRecordedAt ? new Date(doc.hardwareRecordedAt).getTime() : null,
  });
  const shouldPublish = sourceWantsPublish && !isOutlier;
  if (shouldPublish) {
    const snapped = await snapHardwareFixToCorridor(bid, hwLat, hwLng);
    if (snapped) {
      nextLat = snapped.latitude;
      nextLng = snapped.longitude;
    }
  }
  const netRaw = String(body?.net ?? body?.network ?? "").trim().toLowerCase();
  /** Stored on GpsLog as `wifi` | `4g` | `unknown` — fleet UI maps 4g → LTE. */
  function normalizeHardwareNetwork(r) {
    if (!r || r === "unknown") return "unknown";
    if (["wifi", "wlan", "ethernet"].includes(r)) return "wifi";
    if (["4g", "lte", "5g", "3g", "gsm", "cell", "cellular", "mobile", "nbiot", "nb-iot"].includes(r)) return "4g";
    if (r.includes("wifi") || r.includes("wlan")) return "wifi";
    if (r.includes("lte") || r.includes("4g") || r.includes("5g") || r.includes("cell") || r.includes("gsm"))
      return "4g";
    return "unknown";
  }
  const net = normalizeHardwareNetwork(netRaw);
  const sigRaw = body?.signal_strength ?? body?.signalStrength ?? body?.rssi ?? null;
  const sigStrength = sigRaw != null && Number.isFinite(Number(sigRaw)) ? Number(sigRaw) : null;
  const voltRaw = body?.voltage ?? body?.vbat ?? body?.batteryVoltage ?? null;
  const voltage = voltRaw != null && Number.isFinite(Number(voltRaw)) ? Number(voltRaw) : null;

  const rawSpeed = speedKph != null ? Number(speedKph) : null;
  let resolvedSpeedKph =
    rawSpeed != null && Number.isFinite(rawSpeed) && rawSpeed >= 0 ? rawSpeed : null;
  if (resolvedSpeedKph == null) {
    const est = estimateSpeedKphFromPrevHardware(doc, hwLat, hwLng, recordedAt.getTime());
    if (est != null) resolvedSpeedKph = est;
  }

  const gpsLogSet = {
    busId: bid,
    hardwareLatitude: hwLat,
    hardwareLongitude: hwLng,
    network: net,
    signalStrength: sigStrength,
    voltage,
    hardwareRecordedAt: recordedAt,
    ...(deviceId ? { deviceId } : {}),
    activeGpsSource: mapArbiterSourceToGpsSource(nextActiveArbiterSource),
  };
  if (shouldPublish) {
    Object.assign(gpsLogSet, {
      latitude: nextLat,
      longitude: nextLng,
      speedKph: resolvedSpeedKph,
      heading: heading != null ? Number(heading) : null,
      source: nextSource,
      recordedAt,
    });
  }
  await GpsLog.findOneAndUpdate({ busId: bid }, gpsLogSet, { upsert: true, new: true, setDefaultsOnInsert: true });
  await Bus.updateOne({ busId: String(resolvedBusId) }, { lastSeenAt: recordedAt }).catch(() => {});

  if (!shouldPublish) {
    // Either phone (primary) is still healthy, or this fix implied an impossible jump from the
    // last hardware position (see gpsOutlierGuard) — either way it's recorded above for
    // continuity but must not move the published pin or trigger ETA/history/speed side effects.
    return;
  }

  await publishHardwarePosition(io, broadcastLocationUpdate, bid, {
    lat: nextLat,
    lng: nextLng,
    speedKph: resolvedSpeedKph,
    heading,
    recordedAt,
    source: nextSource,
    net,
    signalStrength: sigStrength,
    voltage,
    busLean,
  });
}

/**
 * Shared publish-side-effects tail for every hardware-origin GPS source (LILYGO mobile-data HTTPS
 * and LILYGO SMS fallback alike): ETA/traffic-delay computation, canonical Socket.IO broadcast,
 * dispatch delay flip, terminal-arrival geofence check, speed-violation check, GpsHistory append.
 * Only call this once a caller has already decided (via decideActiveSource + checkGpsOutlier) that
 * this fix SHOULD be published, and has already written the raw per-source GpsLog fields
 * (hardwareLatitude/* or smsLatitude/*) itself — this function only handles the publish side.
 */
async function publishHardwarePosition(
  io,
  broadcastLocationUpdate,
  busId,
  { lat, lng, speedKph, heading, recordedAt, source, net, signalStrength, voltage, busLean }
) {
  const bid = String(busId);
  const normalizedHeading = heading != null ? Number(heading) : null;
  const payload = {
    busId: bid,
    latitude: lat,
    longitude: lng,
    speedKph,
    heading: normalizedHeading,
    recordedAt: recordedAt.toISOString(),
    attendantSub: null,
    attendantName: null,
    source,
    sourceFlag: source === "hardware_sms" ? "hardware_sms" : "hardware",
    net,
    signalStrength,
    voltage,
  };
  const etaMeta = await maybeComputeEtaAndTrafficDelay(io, bid, lat, lng, speedKph).catch(() => null);
  if (etaMeta) {
    payload.etaMinutes = etaMeta.etaMinutes;
    payload.etaTargetIso = etaMeta.etaTargetIso;
    payload.nextTerminal = etaMeta.nextTerminal;
    payload.trafficDelay = etaMeta.trafficDelay;
    payload.congestion = etaMeta.congestion;
    payload.delay = etaMeta.delay;
    payload.trafficSource = etaMeta.trafficSource;
    payload.confidence = etaMeta.confidence;
  }
  broadcastLocationUpdate(io, payload);
  if (await maybeFlipDispatchDelayed(bid)) scheduleLiveBoardPushFromGps(io);
  void onBusGpsForTerminalArrival(io, bid, lat, lng).catch(() => {});
  const attendantName = await resolveAssignedAttendantName(busLean);
  void maybeRecordSpeedViolation(io, {
    busId: bid,
    speedKph,
    latitude: lat,
    longitude: lng,
    attendantName,
    assignedRoute: busLean?.route != null ? String(busLean.route) : null,
  });
  try {
    const segMatch = await resolveSegmentMatchForHistory(bid, lat, lng, speedKph);
    await GpsHistory.create({
      busId: bid,
      latitude: lat,
      longitude: lng,
      speedKph,
      heading: normalizedHeading,
      segmentId: segMatch.segmentId,
      corridorId: segMatch.corridorId,
      recordedAt,
    });
  } catch (e) {
    console.warn("[attendantGpsIngest] GpsHistory (hardware) failed:", e.message || e);
  }
}

/**
 * LILYGO SMS-fallback ping — arrives only from services/smsGpsReceiver.js, which has already
 * validated the sender's phone number against IngestDevice.smsSenderNumber and the claimed busId
 * before calling this. Always publishes as source="hardware_sms" — never trusts a client-claimed
 * source string (there isn't one on this path at all, unlike the HTTPS path's informational-only
 * body.source). Writes to smsLatitude/smsLongitude/smsRecordedAt — separate from
 * hardwareLatitude/hardwareLongitude/hardwareRecordedAt (the mobile-data path's fields) — so the
 * two hardware transports never clobber each other's raw bookkeeping.
 */
async function ingestHardwareSmsGps(io, broadcastLocationUpdate, busId, { latitude, longitude, speedKph, heading, recordedAt, deviceId }) {
  const bid = String(busId);
  if (!isValidGpsCoordinate(latitude, longitude)) {
    const e = new Error("Invalid or unavailable GPS coordinates");
    e.statusCode = 400;
    throw e;
  }
  const busLean = await Bus.findOne({ busId: bid })
    .select("route operatorMysqlId operatorPortalUserId")
    .lean();
  const doc = await GpsLog.findOne({ busId: bid }).lean();
  const smsLat = Number(latitude);
  const smsLng = Number(longitude);

  const prevActiveArbiterSource = getActiveSource(bid);
  const { shouldPublish: sourceWantsPublish, activeSource: nextActiveArbiterSource } = decideActiveSource(
    bid,
    "lilygo_sms",
    {
      phoneLastRecordedAt: doc?.attendantRecordedAt ?? null,
      hardwareMobileLastRecordedAt: doc?.hardwareRecordedAt ?? null,
    },
    recordedAt.getTime()
  );
  logGpsSourceTransition(bid, prevActiveArbiterSource, nextActiveArbiterSource);

  const { outlier: isOutlier } = await checkGpsOutlier({
    busId: bid,
    source: "hardware_sms",
    lat: smsLat,
    lng: smsLng,
    recordedAtMs: recordedAt.getTime(),
    prevLat: Number(doc?.smsLatitude),
    prevLng: Number(doc?.smsLongitude),
    prevRecordedAtMs: doc?.smsRecordedAt ? new Date(doc.smsRecordedAt).getTime() : null,
  });
  const shouldPublish = sourceWantsPublish && !isOutlier;

  const resolvedSpeedKph = speedKph != null && Number.isFinite(Number(speedKph)) ? Number(speedKph) : null;

  const gpsLogSet = {
    busId: bid,
    smsLatitude: smsLat,
    smsLongitude: smsLng,
    smsRecordedAt: recordedAt,
    ...(deviceId ? { deviceId } : {}),
    activeGpsSource: mapArbiterSourceToGpsSource(nextActiveArbiterSource),
    lastSmsAt: recordedAt,
  };
  if (shouldPublish) {
    Object.assign(gpsLogSet, {
      latitude: smsLat,
      longitude: smsLng,
      speedKph: resolvedSpeedKph,
      heading: heading != null ? Number(heading) : null,
      source: "hardware_sms",
      network: "sms",
      signalStrength: null,
      voltage: null,
      recordedAt,
    });
  }
  await GpsLog.findOneAndUpdate({ busId: bid }, gpsLogSet, { upsert: true, new: true, setDefaultsOnInsert: true });
  await Bus.updateOne({ busId: bid }, { lastSeenAt: recordedAt }).catch(() => {});

  if (!shouldPublish) {
    // Phone or hardware mobile-data is still healthy, or this implied an impossible jump from the
    // last SMS position — recorded above for continuity, but must not move the published pin.
    return;
  }

  await publishHardwarePosition(io, broadcastLocationUpdate, bid, {
    lat: smsLat,
    lng: smsLng,
    speedKph: resolvedSpeedKph,
    heading,
    recordedAt,
    source: "hardware_sms",
    net: "sms",
    signalStrength: null,
    voltage: null,
    busLean,
  });
}

module.exports = {
  buildOperatorBusQuery,
  resolveAttendantMetaFromTicketingUser,
  ingestAttendantGps,
  ingestDeviceGps,
  ingestHardwareSmsGps,
  clearAttendantLiveSession,
};
