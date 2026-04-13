const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const GpsHistory = require("../models/GpsHistory");
const PortalUser = require("../models/PortalUser");
const { onBusGpsForTerminalArrival } = require("./terminalGeofenceIntercept");
const { maybeRecordSpeedViolation } = require("./speedViolationAlert");
const { normalizeGpsSignal } = require("./normalizeGpsSignal");
const { buildPublicPayload } = require("../routes/liveDispatch");
const { broadcastLiveBoard } = require("../sockets/socket");
const liveDispatchStore = require("./liveDispatchStore");
const AppBroadcast = require("../models/AppBroadcast");
const { getFreeEtaMinutes, resolveNextTerminalForBus, isNearAnyTerminal } = require("./freeEtaEngine");
const { getPortalSettingsLean } = require("./adminPortalSettingsService");
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

function resolveRecordedAt(body) {
  const raw = body?.clientRecordedAt ?? body?.recorded_at;
  if (raw == null) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date();
  const now = Date.now();
  if (d.getTime() > now + 90_000) return new Date();
  if (d.getTime() < now - 7 * 86400_000) return new Date();
  return d;
}

function parseHmToMinutes(raw) {
  const s = raw == null ? "" : String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function manilaNowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
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
  const etaMinutes = canEstimateEta
    ? getFreeEtaMinutes(
        Number(latitude),
        Number(longitude),
        Number(terminal.latitude),
        Number(terminal.longitude),
        speed
      )
    : null;
  const nowMs = Date.now();
  const nearTerminal = await isNearAnyTerminal(Number(latitude), Number(longitude));
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

  await GpsLog.findOneAndUpdate(
    { busId: String(resolvedBusId) },
    {
      busId: String(resolvedBusId),
      latitude: Number(latitude),
      longitude: Number(longitude),
      attendantLatitude: Number(latitude),
      attendantLongitude: Number(longitude),
      speedKph: speedKph != null ? Number(speedKph) : null,
      heading: heading != null ? Number(heading) : null,
      source: "staff",
      network: null,
      signalStrength: null,
      attendantRecordedAt: recordedAt,
      ...(signalNorm ? { signal: signalNorm } : {}),
      recordedAt,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Bus.updateOne({ busId: String(resolvedBusId) }, { lastSeenAt: recordedAt }).catch(() => {});

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
  }
  broadcastLocationUpdate(io, payload);
  if (await maybeFlipDispatchDelayed(resolvedBusId)) scheduleLiveBoardPushFromGps(io);
  scheduleLiveBoardPushFromGps(io);
  void onBusGpsForTerminalArrival(io, String(resolvedBusId), Number(latitude), Number(longitude)).catch(() => {});

  try {
    await GpsHistory.create({
      busId: String(resolvedBusId),
      latitude: Number(latitude),
      longitude: Number(longitude),
      speedKph: speedKph != null ? Number(speedKph) : null,
      heading: heading != null ? Number(heading) : null,
      signal: signalNorm || null,
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

  return { busId: String(resolvedBusId), recordedAt };
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

/** LilyGo / IMEI ping — no operator JWT; bus id already resolved. */
async function ingestDeviceGps(io, broadcastLocationUpdate, resolvedBusId, body) {
  const { latitude, longitude, speedKph, heading } = body || {};
  if (latitude === undefined || longitude === undefined) {
    const e = new Error("latitude, longitude required");
    e.statusCode = 400;
    throw e;
  }
  const recordedAt = new Date();
  const busLean = await Bus.findOne({ busId: String(resolvedBusId) })
    .select("route operatorMysqlId operatorPortalUserId")
    .lean();
  const bid = String(resolvedBusId);
  const doc = await GpsLog.findOne({ busId: bid }).lean();
  const hwLat = Number(latitude);
  const hwLng = Number(longitude);
  /** LilyGo / device REST pings must always move the published pin — do not fuse with staff GPS here.
   *  (Older fusion logic hid hardware fixes while the attendant app had pinged 5–10s earlier.) */
  const nextLat = hwLat;
  const nextLng = hwLng;
  const nextSource = "hardware";
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

  await GpsLog.findOneAndUpdate(
    { busId: bid },
    {
      busId: bid,
      latitude: nextLat,
      longitude: nextLng,
      hardwareLatitude: hwLat,
      hardwareLongitude: hwLng,
      speedKph: resolvedSpeedKph,
      heading: heading != null ? Number(heading) : null,
      source: nextSource,
      network: net,
      signalStrength: sigStrength,
      voltage,
      hardwareRecordedAt: recordedAt,
      recordedAt,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Bus.updateOne({ busId: String(resolvedBusId) }, { lastSeenAt: recordedAt }).catch(() => {});
  const payload = {
    busId: String(resolvedBusId),
    latitude: nextLat,
    longitude: nextLng,
    speedKph: resolvedSpeedKph,
    heading: heading != null ? Number(heading) : null,
    recordedAt: recordedAt.toISOString(),
    attendantSub: null,
    attendantName: null,
    source: nextSource,
    sourceFlag: nextSource === "hardware" ? "hardware" : "mobile",
    net,
    signalStrength: sigStrength,
    voltage,
  };
  const etaMeta = await maybeComputeEtaAndTrafficDelay(io, resolvedBusId, latitude, longitude, resolvedSpeedKph).catch(
    () => null
  );
  if (etaMeta) {
    payload.etaMinutes = etaMeta.etaMinutes;
    payload.etaTargetIso = etaMeta.etaTargetIso;
    payload.nextTerminal = etaMeta.nextTerminal;
    payload.trafficDelay = etaMeta.trafficDelay;
  }
  broadcastLocationUpdate(io, payload);
  if (await maybeFlipDispatchDelayed(resolvedBusId)) scheduleLiveBoardPushFromGps(io);
  void onBusGpsForTerminalArrival(io, String(resolvedBusId), Number(latitude), Number(longitude)).catch(() => {});
  const hardwareAttendantName = await resolveAssignedAttendantName(busLean);
  void maybeRecordSpeedViolation(io, {
    busId: resolvedBusId,
    speedKph: resolvedSpeedKph,
    latitude,
    longitude,
    attendantName: hardwareAttendantName,
    assignedRoute: busLean?.route != null ? String(busLean.route) : null,
  });
  try {
    await GpsHistory.create({
      busId: String(resolvedBusId),
      latitude: Number(latitude),
      longitude: Number(longitude),
      speedKph: resolvedSpeedKph,
      heading: heading != null ? Number(heading) : null,
      recordedAt,
    });
  } catch (e) {
    console.warn("[attendantGpsIngest] GpsHistory (device) failed:", e.message || e);
  }
}

module.exports = {
  buildOperatorBusQuery,
  resolveAttendantMetaFromTicketingUser,
  ingestAttendantGps,
  ingestDeviceGps,
  clearAttendantLiveSession,
};
