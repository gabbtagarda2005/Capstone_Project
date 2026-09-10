/**
 * Computes this fleet's own "free-flow" driving speed per corridor from real GpsHistory
 * breadcrumbs, instead of relying only on OSRM's generic (non-traffic-aware) road-speed
 * profile. Extends the exact swap point congestionEngine.js's header comment calls out:
 * "swap getCorridorFreeFlowProfile's data source here if a paid traffic API is ever added" —
 * this fleet's own historical GPS is a real, verifiable alternative that needs no paid API and
 * is specific to these actual roads and these actual buses, rather than a generic profile.
 *
 * Method: for each corridor, gather every GPS breadcrumb from buses assigned to that corridor,
 * over a lookback window, restricted to points that are (a) moving (excludes idle/parked
 * noise) and (b) genuinely near the corridor's own road-following polyline (excludes off-route
 * detours, depot idling, etc.). The 85th percentile of that speed distribution is the free-flow
 * reference — a standard traffic-engineering convention (most trips aren't gridlocked, so a high
 * percentile approximates the uncongested speed).
 *
 * Adaptive window: prefers the percentile computed *only* from late-night/early-morning samples
 * (genuinely light traffic — see isLightTrafficHour), since that's a truer "free flow" reference
 * than mixing in daytime samples. But a small fleet's light-hour sample count can be tiny, so it
 * only uses that window when it independently clears `minSamples`; otherwise it falls back to the
 * percentile over *all* hours, which needs less data to be trustworthy (a high percentile of a
 * mixed-hour distribution still approximates free-flow, since most samples still aren't
 * gridlocked) — never a hardcoded guess either way, and the stored result records which one was
 * actually used.
 *
 * Never fabricated: a corridor with too few qualifying samples in *either* window is left
 * uncalibrated (status: "insufficient_data") rather than storing a number backed by noise.
 *
 * Bus↔corridor matching mirrors freeEtaEngine.matchCorridorForBus's fuzzy route-label logic
 * exactly, but resolved once in memory across every bus/corridor pair instead of that
 * function's one-fresh-DB-query-per-call design — matchCorridorForBus is fine for the live
 * engine's single-bus lookups, but calling it per-bus-per-corridor here was an accidental O(buses
 * × corridors) storm of redundant populated CorridorRoute queries (observed to make a full
 * calibration run of even a small fleet take 15+ minutes before this fix).
 */
const Bus = require("../models/Bus");
const CorridorRoute = require("../models/CorridorRoute");
const GpsHistory = require("../models/GpsHistory");
const CorridorFreeFlowCalibration = require("../models/CorridorFreeFlowCalibration");
// Required for its side effect only: CorridorRoute's originCoverageId/destinationCoverageId
// refs "RouteCoverage" — Mongoose's .populate() throws MissingSchemaError unless that model
// class has been registered by requiring its file somewhere in the process. server.js pulls
// this in transitively via its route files, but a standalone script (calibrate/backtest) never
// otherwise touches it.
require("../models/RouteCoverage");
const { getCorridorPolyline, nearestPointOnPolyline } = require("./corridorGeometry");

const DEFAULT_WINDOW_DAYS = 45;
const DEFAULT_MIN_SAMPLES = 40;
const MOVING_SPEED_MIN_KPH = 5; // below this, treat as idle/parked/stopped — not a driving sample
const CORRIDOR_PROXIMITY_M = 250; // must be within this of the corridor polyline to count
const FREE_FLOW_PERCENTILE = 0.85;
const MAX_DOCS_PER_BUS = 20000; // safety cap so one very active bus can't blow up a single query

// Genuinely light-traffic hours, local time. Philippines is a fixed UTC+8 with no DST, so this
// is exact plain arithmetic on the stored UTC timestamp — no timezone library needed.
const MANILA_UTC_OFFSET_HOURS = 8;
const LIGHT_HOUR_START = 22; // 10pm
const LIGHT_HOUR_END = 5; // up to, not including, 5am

function manilaHour(date) {
  return (date.getUTCHours() + MANILA_UTC_OFFSET_HOURS) % 24;
}

function isLightTrafficHour(date) {
  const h = manilaHour(date);
  return h >= LIGHT_HOUR_START || h < LIGHT_HOUR_END;
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Mirrors freeEtaEngine.js's routeLikeName exactly (kept local so this module doesn't need to
 *  change that file's exports for one shared string helper). */
function routeLikeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s*[→➔>–—-]\s*/g, " ")
    .replace(/\s+/g, " ");
}

/** Same two-pass priority as freeEtaEngine.matchCorridorForBus (displayName match first, then
 *  origin+destination substring match), just operating on an already-fetched corridor list. */
function findMatchingCorridor(corridors, routeLabel) {
  const low = routeLikeName(routeLabel);
  if (!low) return null;
  const byDisplayName = corridors.find((r) => {
    const d = routeLikeName(r.displayName || "");
    return d && (d.includes(low) || low.includes(d));
  });
  if (byDisplayName) return byDisplayName;
  return (
    corridors.find((r) => {
      const o = String(r.originCoverageId?.locationName || r.originCoverageId?.terminal?.name || "").toLowerCase();
      const d = String(r.destinationCoverageId?.locationName || r.destinationCoverageId?.terminal?.name || "").toLowerCase();
      return o && d && low.includes(o) && low.includes(d);
    }) || null
  );
}

/** Two queries total (all buses, all corridors), matched in memory — not one query per pair. */
async function loadCorridorsAndBuses() {
  const [buses, corridors] = await Promise.all([
    Bus.find({}).select("busId route").lean(),
    CorridorRoute.find({ suspended: { $ne: true } })
      .populate("originCoverageId", "locationName terminal")
      .populate("destinationCoverageId", "locationName terminal")
      .lean(),
  ]);
  return { buses, corridors };
}

/** corridorId (string) -> busId[] map, built from one buses fetch + one corridors fetch. */
function buildCorridorBusMap(buses, corridors) {
  const map = new Map();
  for (const b of buses) {
    if (!b.route) continue;
    const corridor = findMatchingCorridor(corridors, b.route);
    if (!corridor) continue;
    const key = String(corridor._id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b.busId);
  }
  return map;
}

/** Which currently-assigned buses run this corridor. Convenience single-corridor wrapper around
 *  loadCorridorsAndBuses/buildCorridorBusMap for callers (e.g. the backtest script) that only
 *  need one corridor's buses — still just two DB queries, not one per bus. */
async function findBusesForCorridor(corridorId) {
  const { buses, corridors } = await loadCorridorsAndBuses();
  const map = buildCorridorBusMap(buses, corridors);
  return map.get(String(corridorId)) || [];
}

/**
 * @param {object} corridorDoc
 * @param {string[]} busIds - buses already resolved to this corridor (see buildCorridorBusMap).
 * @returns {Promise<
 *   {status:"ok", observedFreeFlowKph:number, sampleSize:number, method:"p85_light_hours"|"p85_all_hours",
 *    lightHourSampleSize:number, allHourSampleSize:number} |
 *   {status:"insufficient_data", sampleSize:number, lightHourSampleSize:number, allHourSampleSize:number} |
 *   {status:"unavailable", reason:string}
 * >}
 */
async function computeCorridorCalibration(corridorDoc, busIds, opts = {}) {
  const windowDays = Number(opts.windowDays) || DEFAULT_WINDOW_DAYS;
  const minSamples = Number(opts.minSamples) || DEFAULT_MIN_SAMPLES;

  const polyline = await getCorridorPolyline(corridorDoc).catch(() => null);
  if (!polyline || polyline.length < 2) {
    return { status: "unavailable", reason: "No corridor geometry available" };
  }
  if (!busIds || busIds.length === 0) {
    return { status: "insufficient_data", sampleSize: 0, lightHourSampleSize: 0, allHourSampleSize: 0 };
  }

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const allSpeeds = [];
  const lightHourSpeeds = [];
  for (const busId of busIds) {
    const rows = await GpsHistory.find({
      busId,
      recordedAt: { $gte: since },
      speedKph: { $gte: MOVING_SPEED_MIN_KPH },
    })
      .select("latitude longitude speedKph recordedAt")
      .sort({ recordedAt: -1 })
      .limit(MAX_DOCS_PER_BUS)
      .lean();

    for (const row of rows) {
      if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
      const nearest = nearestPointOnPolyline(row.latitude, row.longitude, polyline);
      if (!nearest || nearest.distanceMeters > CORRIDOR_PROXIMITY_M) continue;
      const speed = Number(row.speedKph);
      allSpeeds.push(speed);
      if (isLightTrafficHour(new Date(row.recordedAt))) lightHourSpeeds.push(speed);
    }
  }

  // Prefer the light-hour-only percentile when it independently has enough samples to trust —
  // a truer free-flow reference. Falls back to the all-hours percentile (needs less data to be
  // meaningful) when it doesn't, rather than reporting nothing at all.
  if (lightHourSpeeds.length >= minSamples) {
    lightHourSpeeds.sort((a, b) => a - b);
    return {
      status: "ok",
      observedFreeFlowKph: percentile(lightHourSpeeds, FREE_FLOW_PERCENTILE),
      sampleSize: lightHourSpeeds.length,
      method: "p85_light_hours",
      lightHourSampleSize: lightHourSpeeds.length,
      allHourSampleSize: allSpeeds.length,
      windowDays,
    };
  }
  if (allSpeeds.length >= minSamples) {
    allSpeeds.sort((a, b) => a - b);
    return {
      status: "ok",
      observedFreeFlowKph: percentile(allSpeeds, FREE_FLOW_PERCENTILE),
      sampleSize: allSpeeds.length,
      method: "p85_all_hours",
      lightHourSampleSize: lightHourSpeeds.length,
      allHourSampleSize: allSpeeds.length,
      windowDays,
    };
  }
  return {
    status: "insufficient_data",
    sampleSize: allSpeeds.length,
    lightHourSampleSize: lightHourSpeeds.length,
    allHourSampleSize: allSpeeds.length,
  };
}

/** Recomputes and upserts calibration for every non-suspended corridor. Returns one summary row
 *  per corridor (including ones that stayed uncalibrated) for a script/report to print.
 *  `opts.onProgress(corridorName, index, total)` is called before each corridor starts, so a
 *  long run (this genuinely takes tens of seconds to a few minutes on a real fleet's GPS
 *  history) has visible progress instead of going silent until the very end. */
async function computeAllCorridorCalibrations(opts = {}) {
  const { buses, corridors } = await loadCorridorsAndBuses();
  const busMap = buildCorridorBusMap(buses, corridors);

  const results = [];
  for (let i = 0; i < corridors.length; i++) {
    const corridor = corridors[i];
    const corridorName =
      corridor.displayName ||
      `${corridor.originCoverageId?.locationName || "?"} → ${corridor.destinationCoverageId?.locationName || "?"}`;
    if (typeof opts.onProgress === "function") opts.onProgress(corridorName, i + 1, corridors.length);

    const busIds = busMap.get(String(corridor._id)) || [];
    const result = await computeCorridorCalibration(corridor, busIds, opts);

    if (result.status === "ok") {
      await CorridorFreeFlowCalibration.findOneAndUpdate(
        { corridorId: corridor._id },
        {
          corridorId: corridor._id,
          corridorName,
          observedFreeFlowKph: result.observedFreeFlowKph,
          sampleSize: result.sampleSize,
          lightHourSampleSize: result.lightHourSampleSize,
          allHourSampleSize: result.allHourSampleSize,
          windowDays: result.windowDays,
          method: result.method,
          computedAt: new Date(),
        },
        { upsert: true, new: true }
      );
    }

    results.push({ corridorId: corridor._id, corridorName, ...result });
  }
  return results;
}

/** Current stored calibration for a corridor, or null if none exists yet. Deliberately doesn't
 *  expire by age — a fleet-observed baseline from weeks ago is still more representative of
 *  these specific roads than OSRM's generic profile; re-run the calibration script periodically
 *  (e.g. monthly) to refresh it rather than relying on automatic staleness cutoffs. */
async function getStoredCalibration(corridorId) {
  if (!corridorId) return null;
  return CorridorFreeFlowCalibration.findOne({ corridorId }).lean();
}

module.exports = {
  computeCorridorCalibration,
  computeAllCorridorCalibrations,
  getStoredCalibration,
  findBusesForCorridor,
  loadCorridorsAndBuses,
  buildCorridorBusMap,
  isLightTrafficHour,
  LIGHT_HOUR_START,
  LIGHT_HOUR_END,
  FREE_FLOW_PERCENTILE,
  MOVING_SPEED_MIN_KPH,
  CORRIDOR_PROXIMITY_M,
};
