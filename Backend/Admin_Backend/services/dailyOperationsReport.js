const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const PortalUser = require("../models/PortalUser");
const SecurityLog = require("../models/SecurityLog");
const GpsLog = require("../models/GpsLog");
const GpsHistory = require("../models/GpsHistory");
const store = require("./liveDispatchStore");

const ACTIVE_GPS_MS = 12 * 60 * 1000;
const ON_TIME_SLACK_MIN = 6;

async function buildAttendantNameFallbackMap(busIds) {
  const ids = Array.from(new Set((busIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
  if (!ids.length) return new Map();
  const buses = await Bus.find({ busId: { $in: ids } })
    .select("busId operatorPortalUserId")
    .lean();
  const portalIds = Array.from(
    new Set(
      buses
        .map((b) => (b?.operatorPortalUserId != null ? String(b.operatorPortalUserId) : ""))
        .filter(Boolean)
    )
  )
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const users = portalIds.length
    ? await PortalUser.find({ _id: { $in: portalIds } }).select("firstName lastName email").lean()
    : [];
  const userById = new Map(
    users.map((u) => {
      const full = `${String(u.firstName || "").trim()} ${String(u.lastName || "").trim()}`.trim();
      return [String(u._id), full || String(u.email || "").trim() || "—"];
    })
  );
  const out = new Map();
  for (const b of buses) {
    const key = String(b.busId || "").trim();
    if (!key) continue;
    const uid = b?.operatorPortalUserId != null ? String(b.operatorPortalUserId) : "";
    const nm = uid ? userById.get(uid) : null;
    if (nm) out.set(key, nm);
  }
  return out;
}

function dayRangeUTC(dateStr) {
  const d = String(dateStr || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return {
    start: new Date(`${d}T00:00:00.000Z`),
    end: new Date(`${d}T23:59:59.999Z`),
    day: d,
  };
}

function parseHHMMToMinutes(s) {
  const t = String(s || "").trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  h = ((h % 24) + 24) % 24;
  return h * 60 + min;
}

function isoToMinutesUTC(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function diffMinutes(schedM, actualM) {
  if (schedM == null || actualM == null) return null;
  let d = actualM - schedM;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

function hubTier(onTimePct, lateRatio, arrivalCount) {
  if (arrivalCount === 0) return { tier: "neutral", label: "NO DATA", hint: "No geofence arrivals logged this day." };
  if (lateRatio >= 0.5 || onTimePct < 50) {
    return { tier: "red", label: "ATTENTION", hint: "High late ratio or few on-time arrivals — review dispatch & corridors." };
  }
  if (lateRatio >= 0.25 || onTimePct < 75) {
    return { tier: "amber", label: "CONGESTION / DELAY RISK", hint: "Elevated late arrivals or overlapping pressure at this hub." };
  }
  if (onTimePct >= 90) {
    return { tier: "green", label: "ON-TIME HUB", hint: "≥90% arrivals within tolerance vs scheduled board time." };
  }
  return { tier: "amber", label: "STABLE", hint: "Within normal variance; monitor peak windows." };
}

/**
 * @param {{ dateStr?: string }} opts
 */
async function buildDailyOperationsReport(opts) {
  const { dateStr } = opts || {};
  const range = dayRangeUTC(dateStr || new Date().toISOString().slice(0, 10));
  if (!range) {
    return { ok: false, error: "Invalid date. Use YYYY-MM-DD." };
  }
  if (mongoose.connection.readyState !== 1) {
    return { ok: false, error: "MongoDB not connected" };
  }

  const now = Date.now();
  const blocks = store.listBlocks().filter((b) => {
    if (!b.arrivalDetectedAt) return false;
    const iso = String(b.arrivalDetectedAt);
    if (iso.slice(0, 10) === range.day) return true;
    if (b.serviceDate && String(b.serviceDate).slice(0, 10) === range.day) return true;
    return false;
  });

  const arrivalRows = [];
  const terminalAgg = new Map();

  for (const b of blocks) {
    const schedM = parseHHMMToMinutes(b.scheduledDeparture);
    const actM = isoToMinutesUTC(b.arrivalDetectedAt);
    const varMin = diffMinutes(schedM, actM);
    const onTime = varMin != null && Math.abs(varMin) <= ON_TIME_SLACK_MIN;
    const term = (b.arrivalTerminalName && String(b.arrivalTerminalName).trim()) || "—";
    const row = {
      busId: String(b.busId),
      routeLabel: String(b.routeLabel || "—"),
      terminal: term,
      scheduledBoard: String(b.scheduledDeparture || "—"),
      geofenceArrivalAt: b.arrivalDetectedAt ? String(b.arrivalDetectedAt) : null,
      varianceMinutes: varMin,
      onTime,
      statusLabel: varMin == null ? "—" : onTime ? "ON-TIME" : varMin > 0 ? "LATE" : "EARLY",
      gate: b.gate || null,
    };
    arrivalRows.push(row);

    const cur = terminalAgg.get(term) || { total: 0, onTime: 0, late: 0, early: 0 };
    cur.total += 1;
    if (onTime) cur.onTime += 1;
    else if (varMin != null && varMin > ON_TIME_SLACK_MIN) cur.late += 1;
    else if (varMin != null && varMin < -ON_TIME_SLACK_MIN) cur.early += 1;
    terminalAgg.set(term, cur);
  }

  const terminalHubs = [...terminalAgg.entries()].map(([name, v]) => {
    const onTimePct = v.total ? Math.round((v.onTime / v.total) * 1000) / 10 : 0;
    const lateRatio = v.total ? v.late / v.total : 0;
    const tier = hubTier(onTimePct, lateRatio, v.total);
    return {
      terminal: name,
      arrivals: v.total,
      onTime: v.onTime,
      late: v.late,
      early: v.early,
      onTimePct,
      tier: tier.tier,
      tierLabel: tier.label,
      tierHint: tier.hint,
    };
  });
  terminalHubs.sort((a, b) => b.arrivals - a.arrivals);

  const speedLogs = await SecurityLog.find({
    type: "speed_violation",
    createdAt: { $gte: range.start, $lte: range.end },
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  const speedAttendantFallbackByBus = await buildAttendantNameFallbackMap(speedLogs.map((d) => d.busId));

  const speedRows = speedLogs.map((d) => {
    const msg = String(d.message || "");
    const m = msg.match(/([\d.]+)\s*km\/h/i);
    const speedNum = m ? Number(m[1]) : null;
    return {
      busId: String(d.busId),
      staff:
        (d.attendantDisplayName != null && String(d.attendantDisplayName).trim()) ||
        speedAttendantFallbackByBus.get(String(d.busId || "").trim()) ||
        "—",
      incident: "SPEEDING",
      speedKph: Number.isFinite(speedNum) ? speedNum : null,
      location: d.assignedRoute != null ? String(d.assignedRoute) : "—",
      timestamp: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      latitude: d.latitude,
      longitude: d.longitude,
    };
  });

  const sosLogs = await SecurityLog.find({
    type: "attendant_sos",
    createdAt: { $gte: range.start, $lte: range.end },
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const sosRows = sosLogs.map((d) => ({
    busId: String(d.busId || "—"),
    staff: d.attendantDisplayName != null ? String(d.attendantDisplayName) : "—",
    incident: "SOS",
    speedKph: null,
    location:
      Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude))
        ? `${Number(d.latitude).toFixed(5)}, ${Number(d.longitude).toFixed(5)}`
        : d.assignedRoute != null
          ? String(d.assignedRoute)
          : "—",
    timestamp: d.createdAt ? new Date(d.createdAt).toISOString() : null,
    latitude: Number.isFinite(Number(d.latitude)) ? Number(d.latitude) : null,
    longitude: Number.isFinite(Number(d.longitude)) ? Number(d.longitude) : null,
  }));

  const sosCount = await SecurityLog.countDocuments({
    type: "attendant_sos",
    createdAt: { $gte: range.start, $lte: range.end },
  });

  const totalFleet = await Bus.countDocuments({});
  const fresh = await GpsLog.find({
    recordedAt: { $gte: new Date(now - ACTIVE_GPS_MS) },
  })
    .select("busId")
    .lean();
  const activeSet = new Set(fresh.map((x) => String(x.busId)));
  const activeBuses = activeSet.size;
  const stationaryBuses = Math.max(0, totalFleet - activeBuses);

  const busIdsForStaff = new Set([
    ...arrivalRows.map((r) => r.busId),
    ...speedRows.map((r) => r.busId),
  ]);
  const busDocs = await Bus.find({ busId: { $in: [...busIdsForStaff] } })
    .select("busId operatorPortalUserId")
    .populate("operatorPortalUserId", "firstName lastName email")
    .lean();
  const staffByBus = new Map();
  for (const bd of busDocs) {
    const op = bd.operatorPortalUserId;
    let name = "—";
    if (op && typeof op === "object") {
      const fn = [op.firstName, op.lastName].filter(Boolean).join(" ").trim();
      name = fn || (op.email != null ? String(op.email) : "—");
    }
    staffByBus.set(String(bd.busId), name);
  }

  /** Peak logged speed per bus (attendant from log or bus assignment). */
  const busSpeedMax = new Map();
  for (const s of speedRows) {
    const sp = s.speedKph;
    if (!Number.isFinite(sp)) continue;
    const staffName = s.staff !== "—" ? s.staff : staffByBus.get(s.busId) || "—";
    const prev = busSpeedMax.get(s.busId);
    if (!prev || sp > prev.topSpeedKph) {
      busSpeedMax.set(s.busId, {
        busId: s.busId,
        attendantName: staffName,
        topSpeedKph: Math.round(sp * 10) / 10,
        at: s.timestamp,
      });
    }
  }
  const speedingPeakByBus = [...busSpeedMax.values()].sort((a, b) => b.topSpeedKph - a.topSpeedKph);

  const arrivalIncidents = arrivalRows.map((r) => ({
    busId: r.busId,
    staff: staffByBus.get(r.busId) || "—",
    incident: r.statusLabel === "ON-TIME" ? "ON-TIME" : r.statusLabel,
    speedKph: null,
    location: `${r.terminal} · ${r.routeLabel}`,
    varianceMinutes: r.varianceMinutes,
    scheduledBoard: r.scheduledBoard,
    geofenceAt: r.geofenceArrivalAt,
  }));

  const incidentTable = [
    ...sosRows.map((s) => ({
      busId: s.busId,
      staff: s.staff,
      incident: "SOS",
      speedKph: null,
      location: s.location,
      timestamp: s.timestamp,
      latitude: s.latitude,
      longitude: s.longitude,
    })),
    ...speedRows.map((s) => ({
      busId: s.busId,
      staff: s.staff !== "—" ? s.staff : staffByBus.get(s.busId) || "—",
      incident: "SPEEDING",
      speedKph: s.speedKph,
      location: s.location,
      timestamp: s.timestamp,
    })),
    ...arrivalIncidents.slice(0, 80).map((a) => ({
      busId: a.busId,
      staff: a.staff,
      incident: a.incident,
      speedKph: a.speedKph,
      location: a.location,
      timestamp: a.geofenceAt,
      varianceMinutes: a.varianceMinutes,
      scheduledBoard: a.scheduledBoard,
    })),
  ].slice(0, 200);

  const onTimeCount = arrivalRows.filter((r) => r.onTime).length;
  const totalArrivals = arrivalRows.length;
  const arrivalPrecisionPct = totalArrivals > 0 ? Math.round((onTimeCount / totalArrivals) * 1000) / 10 : 0;

  const agg = await GpsHistory.aggregate([
    { $match: { recordedAt: { $gte: range.start, $lte: range.end } } },
    {
      $group: {
        _id: "$busId",
        first: { $min: "$recordedAt" },
        last: { $max: "$recordedAt" },
        pings: { $sum: 1 },
      },
    },
    { $sort: { pings: -1 } },
    { $limit: 80 },
  ]);
  const buses = await Bus.find({ busId: { $in: agg.map((a) => a._id) } })
    .select("busId operatorPortalUserId")
    .populate("operatorPortalUserId", "firstName lastName email")
    .lean();
  const busMap = new Map(buses.map((b) => [String(b.busId), b]));
  const crewActivity = agg.map((a) => {
    const bid = String(a._id);
    const bd = busMap.get(bid);
    let name = "—";
    if (bd?.operatorPortalUserId && typeof bd.operatorPortalUserId === "object") {
      const op = bd.operatorPortalUserId;
      name =
        `${String(op.firstName || "").trim()} ${String(op.lastName || "").trim()}`.trim() ||
        String(op.email || "") ||
        "—";
    }
    return {
      source: "telemetry",
      busId: bid,
      name,
      firstPing: a.first ? new Date(a.first).toISOString() : null,
      lastPing: a.last ? new Date(a.last).toISOString() : null,
      pingCount: a.pings,
      note: "Shift window estimated from GPS pings.",
    };
  });

  const signalSamples = await GpsHistory.aggregate([
    {
      $match: {
        recordedAt: { $gte: range.start, $lte: range.end },
        signal: { $in: ["strong", "weak", "offline"] },
      },
    },
    {
      $group: {
        _id: "$busId",
        strong: { $sum: { $cond: [{ $eq: ["$signal", "strong"] }, 1, 0] } },
        weak: { $sum: { $cond: [{ $eq: ["$signal", "weak"] }, 1, 0] } },
        offline: { $sum: { $cond: [{ $eq: ["$signal", "offline"] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);
  const busIdsSig = signalSamples.map((s) => String(s._id));
  const sigBuses =
    busIdsSig.length > 0
      ? await Bus.find({ busId: { $in: busIdsSig } })
          .select("busId route")
          .lean()
      : [];
  const routeByBus = new Map(sigBuses.map((b) => [String(b.busId), b.route != null ? String(b.route) : "—"]));
  const routeAgg = new Map();
  for (const s of signalSamples) {
    const bid = String(s._id);
    const rlab = routeByBus.get(bid) || "—";
    const cur = routeAgg.get(rlab) || { strong: 0, weak: 0, offline: 0, total: 0 };
    cur.strong += s.strong;
    cur.weak += s.weak;
    cur.offline += s.offline;
    cur.total += s.total;
    routeAgg.set(rlab, cur);
  }
  const connectivityByRoute = [...routeAgg.entries()]
    .map(([routeLabel, v]) => {
      const weakPct = v.total ? Math.round((v.weak / v.total) * 1000) / 10 : 0;
      const offlinePct = v.total ? Math.round((v.offline / v.total) * 1000) / 10 : 0;
      const strongPct = v.total ? Math.round((v.strong / v.total) * 1000) / 10 : 0;
      let tier = "green";
      if (offlinePct >= 25 || weakPct + offlinePct >= 55) tier = "red";
      else if (weakPct >= 30 || offlinePct >= 8) tier = "amber";
      return { routeLabel, strongPct, weakPct, offlinePct, sampleCount: v.total, tier };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount)
    .slice(0, 24);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    reportDate: range.day,
    fleetStatus: {
      totalRegistered: totalFleet,
      activeGps: activeBuses,
      stationary: stationaryBuses,
      sosCount,
    },
    arrivalPrecision: arrivalRows,
    terminalHubs,
    speedViolations: speedRows,
    speedingPeakByBus,
    incidentTable,
    crewActivity,
    connectivityByRoute,
    meta: {
      onTimeToleranceMinutes: ON_TIME_SLACK_MIN,
      activeGpsWindowMinutes: ACTIVE_GPS_MS / 60000,
      geofenceTerminalNote:
        "Each row is a terminal geofence arrival from live dispatch when the attendant device crosses the configured terminal radius (typically 500m).",
    },
    arrivalSummary: {
      onTimeTrips: onTimeCount,
      totalTrips: totalArrivals,
      precisionPct: arrivalPrecisionPct,
    },
  };
}

module.exports = { buildDailyOperationsReport, dayRangeUTC };
