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
 * detours, depot idling, etc.). The 85th percentile of that speed distribution is used as the
 * free-flow reference — a standard traffic-engineering convention (most trips aren't gridlocked,
 * so a high percentile of *all* observed speeds approximates the uncongested speed) that doesn't
 * require guessing which hours count as "light traffic" for this specific corridor.
 *
 * Never fabricated: a corridor with too few qualifying samples is left uncalibrated
 * (status: "insufficient_data") rather than storing a number backed by noise.
 */
const Bus = require("../models/Bus");
const CorridorRoute = require("../models/CorridorRoute");
const GpsHistory = require("../models/GpsHistory");
const CorridorFreeFlowCalibration = require("../models/CorridorFreeFlowCalibration");
const { getCorridorPolyline, nearestPointOnPolyline } = require("./corridorGeometry");
const { matchCorridorForBus } = require("./freeEtaEngine");

const DEFAULT_WINDOW_DAYS = 45;
const DEFAULT_MIN_SAMPLES = 40;
const MOVING_SPEED_MIN_KPH = 5; // below this, treat as idle/parked/stopped — not a driving sample
const CORRIDOR_PROXIMITY_M = 250; // must be within this of the corridor polyline to count
const FREE_FLOW_PERCENTILE = 0.85;
const MAX_DOCS_PER_BUS = 20000; // safety cap so one very active bus can't blow up a single query

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Which currently-assigned buses run this corridor, via the same fuzzy route-label match the
 *  live system uses (matchCorridorForBus) — guarantees calibration groups buses exactly the way
 *  the congestion engine will look them up later, with no separate/divergent matching logic. */
async function findBusesForCorridor(corridorId) {
  const buses = await Bus.find({}).select("busId route").lean();
  const matches = [];
  for (const b of buses) {
    if (!b.route) continue;
    const corridor = await matchCorridorForBus(b.busId).catch(() => null);
    if (corridor && String(corridor._id) === String(corridorId)) matches.push(b.busId);
  }
  return matches;
}

/**
 * @returns {Promise<{status:"ok", observedFreeFlowKph:number, sampleSize:number} |
 *                    {status:"insufficient_data", sampleSize:number} |
 *                    {status:"unavailable", reason:string}>}
 */
async function computeCorridorCalibration(corridorDoc, opts = {}) {
  const windowDays = Number(opts.windowDays) || DEFAULT_WINDOW_DAYS;
  const minSamples = Number(opts.minSamples) || DEFAULT_MIN_SAMPLES;

  const polyline = await getCorridorPolyline(corridorDoc).catch(() => null);
  if (!polyline || polyline.length < 2) {
    return { status: "unavailable", reason: "No corridor geometry available" };
  }

  const busIds = await findBusesForCorridor(corridorDoc._id);
  if (busIds.length === 0) {
    return { status: "insufficient_data", sampleSize: 0 };
  }

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const speeds = [];
  for (const busId of busIds) {
    const rows = await GpsHistory.find({
      busId,
      recordedAt: { $gte: since },
      speedKph: { $gte: MOVING_SPEED_MIN_KPH },
    })
      .select("latitude longitude speedKph")
      .sort({ recordedAt: -1 })
      .limit(MAX_DOCS_PER_BUS)
      .lean();

    for (const row of rows) {
      if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
      const nearest = nearestPointOnPolyline(row.latitude, row.longitude, polyline);
      if (nearest && nearest.distanceMeters <= CORRIDOR_PROXIMITY_M) {
        speeds.push(Number(row.speedKph));
      }
    }
  }

  if (speeds.length < minSamples) {
    return { status: "insufficient_data", sampleSize: speeds.length };
  }

  speeds.sort((a, b) => a - b);
  const observedFreeFlowKph = percentile(speeds, FREE_FLOW_PERCENTILE);
  return { status: "ok", observedFreeFlowKph, sampleSize: speeds.length, windowDays };
}

/** Recomputes and upserts calibration for every non-suspended corridor. Returns one summary row
 *  per corridor (including ones that stayed uncalibrated) for a script/report to print. */
async function computeAllCorridorCalibrations(opts = {}) {
  const corridors = await CorridorRoute.find({ suspended: { $ne: true } })
    .populate("originCoverageId", "locationName terminal")
    .populate("destinationCoverageId", "locationName terminal")
    .lean();

  const results = [];
  for (const corridor of corridors) {
    const result = await computeCorridorCalibration(corridor, opts);
    const corridorName =
      corridor.displayName ||
      `${corridor.originCoverageId?.locationName || "?"} → ${corridor.destinationCoverageId?.locationName || "?"}`;

    if (result.status === "ok") {
      await CorridorFreeFlowCalibration.findOneAndUpdate(
        { corridorId: corridor._id },
        {
          corridorId: corridor._id,
          corridorName,
          observedFreeFlowKph: result.observedFreeFlowKph,
          sampleSize: result.sampleSize,
          windowDays: result.windowDays,
          method: "p85_gps_history",
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
  FREE_FLOW_PERCENTILE,
  MOVING_SPEED_MIN_KPH,
  CORRIDOR_PROXIMITY_M,
};
