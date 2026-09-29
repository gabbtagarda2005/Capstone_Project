/**
 * Current (recent-window) and reference (historical) speed statistics per road segment
 * (services/corridorSegments.js), computed from real GpsHistory breadcrumbs — never a random or
 * simulated value. This is the substrate for segment-level congestion (congestionEngine.js), the
 * heat map, and the unified ETA engine.
 *
 * Never classifies from a single noisy GPS point: computeSegmentCongestion() below requires a
 * minimum sample count in the recent window before it will report a real congestion level.
 */
const GpsHistory = require("../models/GpsHistory");
const SegmentFreeFlowCalibration = require("../models/SegmentFreeFlowCalibration");
const { getStoredCalibration } = require("./corridorFreeFlowCalibration");
const { getCorridorFreeFlowProfile } = require("./corridorGeometry");
const { classifyRatio } = require("./congestionLevels");
const { computeConfidence } = require("./trafficConfidence");

const CURRENT_WINDOW_MINUTES = 15;
const MIN_SAMPLES_FOR_CLASSIFICATION = 3;
const STATS_CACHE_TTL_MS = 20 * 1000;

const statsCache = new Map();

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function median(sortedAsc) {
  if (!sortedAsc.length) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Recent-window statistics for one segment, across every bus that has recently driven it.
 * @returns {Promise<{sampleCount:number, medianSpeed:number|null, meanSpeed:number|null,
 *   p10Speed:number|null, p50Speed:number|null, p90Speed:number|null, lastObservationAt:Date|null}>}
 */
async function getSegmentCurrentStats(segmentId, opts = {}) {
  const windowMinutes = Number(opts.windowMinutes) || CURRENT_WINDOW_MINUTES;
  const cacheKey = `${segmentId}:${windowMinutes}`;
  const cached = statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) return cached.stats;

  const since = new Date(Date.now() - windowMinutes * 60_000);
  const rows = await GpsHistory.find({ segmentId, recordedAt: { $gte: since } })
    .select("speedKph recordedAt")
    .sort({ recordedAt: -1 })
    .limit(500)
    .lean();

  const speeds = rows.map((r) => Number(r.speedKph)).filter((s) => Number.isFinite(s));
  speeds.sort((a, b) => a - b);
  const stats = {
    sampleCount: speeds.length,
    medianSpeed: median(speeds),
    meanSpeed: mean(speeds),
    p10Speed: percentile(speeds, 0.1),
    p50Speed: percentile(speeds, 0.5),
    p90Speed: percentile(speeds, 0.9),
    lastObservationAt: rows.length ? new Date(rows[0].recordedAt) : null,
  };
  statsCache.set(cacheKey, { ts: Date.now(), stats });
  return stats;
}

/**
 * Reference ("free-flow") speed for a segment — prefers the segment's own historical calibration,
 * falls back to the corridor-wide calibration/OSRM profile when the segment doesn't independently
 * have enough samples yet. Mirrors corridorFreeFlowCalibration.js's adaptive-fallback philosophy
 * one level deeper. Returns `{ freeFlowKph, source }` or null if nothing usable exists at all.
 */
async function getSegmentReferenceSpeed(segmentId, corridorDoc) {
  const segCal = await SegmentFreeFlowCalibration.findOne({ segmentId })
    .select("observedFreeFlowKph sampleSize")
    .lean()
    .catch(() => null);
  if (segCal && Number.isFinite(segCal.observedFreeFlowKph) && segCal.observedFreeFlowKph > 0) {
    return { freeFlowKph: segCal.observedFreeFlowKph, source: "segment_calibrated", sampleSize: segCal.sampleSize };
  }
  if (corridorDoc?._id) {
    const corridorCal = await getStoredCalibration(corridorDoc._id).catch(() => null);
    if (corridorCal && Number.isFinite(corridorCal.observedFreeFlowKph) && corridorCal.observedFreeFlowKph > 0) {
      return { freeFlowKph: corridorCal.observedFreeFlowKph, source: "corridor_calibrated", sampleSize: corridorCal.sampleSize };
    }
    const profile = await getCorridorFreeFlowProfile(corridorDoc).catch(() => null);
    if (profile && Number.isFinite(profile.freeFlowKph) && profile.freeFlowKph > 0) {
      return { freeFlowKph: profile.freeFlowKph, source: "osrm_static", sampleSize: null };
    }
  }
  return null;
}

/**
 * Real, sample-backed congestion reading for one segment — the segment-level building block the
 * heat map and congestionEngine.js's per-bus reading are both built from.
 * @returns {Promise<{status:"ok", segmentId, level, congestionRatio, currentKph, referenceKph,
 *   referenceSource, sampleCount, lastObservationAt, corridorId} |
 *   {status:"insufficient_data", segmentId, sampleCount} |
 *   {status:"unavailable", segmentId, reason}>}
 */
async function computeSegmentCongestion(segmentId, corridorDoc) {
  const current = await getSegmentCurrentStats(segmentId);
  const reference = await getSegmentReferenceSpeed(segmentId, corridorDoc);
  if (!reference) {
    return { status: "unavailable", segmentId, reason: "No reference speed available for this segment" };
  }
  if (current.sampleCount < MIN_SAMPLES_FOR_CLASSIFICATION || current.medianSpeed == null) {
    return { status: "insufficient_data", segmentId, sampleCount: current.sampleCount };
  }
  const ratio = Math.max(0, Math.min(1, 1 - current.medianSpeed / reference.freeFlowKph));
  const confidence = computeConfidence({
    sampleCount: current.sampleCount,
    method: reference.source,
    observationAgeMs: current.lastObservationAt ? Date.now() - current.lastObservationAt.getTime() : null,
  });
  return {
    status: "ok",
    segmentId,
    corridorId: corridorDoc?._id ? String(corridorDoc._id) : null,
    level: classifyRatio(ratio),
    congestionRatio: Math.round(ratio * 100) / 100,
    currentKph: Math.round(current.medianSpeed * 10) / 10,
    referenceKph: Math.round(reference.freeFlowKph * 10) / 10,
    referenceSource: reference.source,
    sampleCount: current.sampleCount,
    lastObservationAt: current.lastObservationAt,
    confidence,
  };
}

module.exports = {
  getSegmentCurrentStats,
  getSegmentReferenceSpeed,
  computeSegmentCongestion,
  MIN_SAMPLES_FOR_CLASSIFICATION,
  CURRENT_WINDOW_MINUTES,
};
