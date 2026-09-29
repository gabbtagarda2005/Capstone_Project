/**
 * Traffic source #2/#3 (fallback, per the user's explicit hierarchy: "1. GPS-derived current, 2.
 * Historical GPS-derived, 3. Route-based ETA, 4. NO_DATA"). Used when there aren't enough *recent*
 * GPS observations on a segment to say anything about current conditions — falls back to this
 * fleet's own historical calibration for that segment/corridor, and only as a last resort to
 * OSRM's static (non-traffic-aware) road-speed profile. Never claims this is "current traffic" —
 * callers must label it "historical estimate" / "route-only", never "live".
 */
const { getSegmentReferenceSpeed } = require("../segmentTrafficStats");
const { computeConfidence } = require("../trafficConfidence");

async function getHistoricalTraffic(segmentId, corridorDoc) {
  const reference = await getSegmentReferenceSpeed(segmentId, corridorDoc).catch(() => null);
  if (!reference) return { available: false };
  const trafficSource = reference.source === "osrm_static" ? "route_only" : "historical";
  const confidence = computeConfidence({
    sampleCount: reference.sampleSize || 0,
    method: reference.source,
  });
  return {
    available: true,
    trafficSource,
    speedKph: reference.freeFlowKph,
    referenceKph: reference.freeFlowKph,
    referenceSource: reference.source,
    sampleCount: reference.sampleSize || 0,
    confidence,
  };
}

module.exports = { getHistoricalTraffic };
