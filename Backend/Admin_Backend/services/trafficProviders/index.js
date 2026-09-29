/**
 * TrafficProvider abstraction. Tries real traffic sources in priority order and returns the first
 * one that has real data — never fabricates a value when every source comes up empty. This is the
 * one place that decides `trafficSource`; every caller downstream (ETA engine, congestion engine,
 * heat map, Socket.IO payload, REST responses) just carries whatever this returns.
 *
 *   TrafficProvider
 *   ├── GoogleRoutesTrafficProvider  (live_provider — stub until GOOGLE_ROUTES_API_KEY exists)
 *   ├── GpsDerivedTrafficProvider    (gps_derived   — this fleet's own recent GPS, per segment)
 *   └── HistoricalTrafficProvider    (historical / route_only — calibrated or OSRM-static fallback)
 */
const { getGoogleRoutesTraffic } = require("./googleRoutesProvider");
const { getGpsDerivedTraffic } = require("./gpsDerivedProvider");
const { getHistoricalTraffic } = require("./historicalProvider");

/**
 * @returns {Promise<{
 *   trafficSource: "live_provider"|"gps_derived"|"historical"|"route_only"|"unavailable",
 *   speedKph: number|null, referenceKph?: number, level?: string, congestionRatio?: number,
 *   sampleCount: number, confidence: "HIGH"|"MEDIUM"|"LOW"|"UNKNOWN",
 * }>}
 */
async function getTrafficForSegment(segmentId, corridorDoc) {
  if (!segmentId) {
    return { trafficSource: "unavailable", speedKph: null, sampleCount: 0, confidence: "UNKNOWN" };
  }

  const live = await getGoogleRoutesTraffic(segmentId, corridorDoc).catch(() => ({ available: false }));
  if (live.available) return live;

  const gpsDerived = await getGpsDerivedTraffic(segmentId, corridorDoc).catch(() => ({ available: false }));
  if (gpsDerived.available) return gpsDerived;

  const historical = await getHistoricalTraffic(segmentId, corridorDoc).catch(() => ({ available: false }));
  if (historical.available) return historical;

  return { trafficSource: "unavailable", speedKph: null, sampleCount: 0, confidence: "UNKNOWN" };
}

module.exports = { getTrafficForSegment };
