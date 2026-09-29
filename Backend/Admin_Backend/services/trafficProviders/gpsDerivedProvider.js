/**
 * Traffic source #1 (after any live provider): this fleet's own real, recent GPS observations on
 * the segment in question — see services/segmentTrafficStats.js. Never fabricated; reports
 * `available: false` rather than guessing when there aren't enough fresh samples.
 */
const { computeSegmentCongestion } = require("../segmentTrafficStats");

async function getGpsDerivedTraffic(segmentId, corridorDoc) {
  const result = await computeSegmentCongestion(segmentId, corridorDoc).catch(() => null);
  if (!result || result.status !== "ok") return { available: false };
  return {
    available: true,
    trafficSource: "gps_derived",
    speedKph: result.currentKph,
    referenceKph: result.referenceKph,
    level: result.level,
    congestionRatio: result.congestionRatio,
    sampleCount: result.sampleCount,
    lastObservationAt: result.lastObservationAt,
    confidence: result.confidence,
  };
}

module.exports = { getGpsDerivedTraffic };
