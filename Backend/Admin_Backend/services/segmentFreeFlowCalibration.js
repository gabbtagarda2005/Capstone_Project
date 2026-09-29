/**
 * Computes and stores each road segment's (services/corridorSegments.js) fleet-observed free-flow
 * speed from real GpsHistory breadcrumbs — the exact method of corridorFreeFlowCalibration.js, one
 * level deeper. Simpler than the corridor version: GpsHistory rows are already tagged with their
 * matched `segmentId` at ingest time (see attendantGpsIngest.js), so there's no need to re-derive
 * which buses ran which corridor — just group by segmentId directly.
 *
 * Same honesty guarantee: a segment with too few qualifying samples in either window is left
 * uncalibrated (status: "insufficient_data") rather than storing a number backed by noise.
 * services/segmentTrafficStats.js falls back to the corridor-wide calibration/OSRM profile for any
 * segment that doesn't have one yet.
 */
const GpsHistory = require("../models/GpsHistory");
const SegmentFreeFlowCalibration = require("../models/SegmentFreeFlowCalibration");
const { getAllCorridorSegments } = require("./corridorSegments");
const {
  isLightTrafficHour,
  FREE_FLOW_PERCENTILE,
  MOVING_SPEED_MIN_KPH,
} = require("./corridorFreeFlowCalibration");

const DEFAULT_WINDOW_DAYS = 45;
const DEFAULT_MIN_SAMPLES = 40;

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/**
 * @returns {Promise<
 *   {status:"ok", observedFreeFlowKph:number, sampleSize:number, method:"p85_light_hours"|"p85_all_hours",
 *    lightHourSampleSize:number, allHourSampleSize:number} |
 *   {status:"insufficient_data", sampleSize:number, lightHourSampleSize:number, allHourSampleSize:number}
 * >}
 */
async function computeSegmentCalibration(segmentId, opts = {}) {
  const windowDays = Number(opts.windowDays) || DEFAULT_WINDOW_DAYS;
  const minSamples = Number(opts.minSamples) || DEFAULT_MIN_SAMPLES;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await GpsHistory.find({
    segmentId,
    recordedAt: { $gte: since },
    speedKph: { $gte: MOVING_SPEED_MIN_KPH },
  })
    .select("speedKph recordedAt")
    .limit(20000)
    .lean();

  const allSpeeds = [];
  const lightHourSpeeds = [];
  for (const row of rows) {
    const speed = Number(row.speedKph);
    if (!Number.isFinite(speed)) continue;
    allSpeeds.push(speed);
    if (isLightTrafficHour(new Date(row.recordedAt))) lightHourSpeeds.push(speed);
  }

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

/** Recomputes and upserts calibration for every segment of every non-suspended corridor. Returns
 *  one summary row per segment (including ones that stayed uncalibrated). */
async function computeAllSegmentCalibrations(opts = {}) {
  const segments = await getAllCorridorSegments();
  const results = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (typeof opts.onProgress === "function") {
      opts.onProgress(`${segment.fromName || "?"} → ${segment.toName || "?"}`, i + 1, segments.length);
    }
    const result = await computeSegmentCalibration(segment.segmentId, opts);
    if (result.status === "ok") {
      await SegmentFreeFlowCalibration.findOneAndUpdate(
        { segmentId: segment.segmentId },
        {
          segmentId: segment.segmentId,
          corridorId: segment.corridorId,
          fromName: segment.fromName,
          toName: segment.toName,
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
    results.push({
      segmentId: segment.segmentId,
      fromName: segment.fromName,
      toName: segment.toName,
      ...result,
    });
  }
  return results;
}

module.exports = { computeSegmentCalibration, computeAllSegmentCalibrations, DEFAULT_WINDOW_DAYS, DEFAULT_MIN_SAMPLES };
