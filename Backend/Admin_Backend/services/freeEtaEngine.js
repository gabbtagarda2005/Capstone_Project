const Bus = require("../models/Bus");
const CorridorRoute = require("../models/CorridorRoute");
const RouteCoverage = require("../models/RouteCoverage");
const { smoothEtaWithKalman, resetEtaFilter } = require("./kalmanFilterEta");
const { applyWeatherAdjustment } = require("./weatherEtaMultiplier");
const { getOsrmEta, snapGpsToRoad } = require("./osrmTrafficService");
const { getCorridorSegments, matchPointToSegment } = require("./corridorSegments");
const { getTrafficForSegment } = require("./trafficProviders");
const { progressAlongPolyline } = require("./corridorGeometry");

const CONFIDENCE_RANK = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const CONFIDENCE_LABELS = ["UNKNOWN", "LOW", "MEDIUM", "HIGH"];

/** Clamp a possibly-missing/noisy speed reading to a plausible driving range, with an honest
 *  neutral default (matches getFreeEtaMinutes's own fallback) when there's nothing usable. */
function clampSegmentSpeedKph(speedKph, fallback = 35) {
  const s = Number(speedKph);
  return Number.isFinite(s) && s > 3 ? Math.min(90, Math.max(5, s)) : fallback;
}

function toRad(v) {
  return (Number(v) * Math.PI) / 180;
}

/**
 * Haversine distance in kilometers (WGS84).
 * Used as fallback and for intermediate calculations.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Strategy 3: Add dwell time buffer based on passenger count.
 * If passengers < 50% capacity, add 10 mins for loading.
 * If passengers < 20% capacity, add 5 mins for passengers to board.
 */
function getTerminalDwellBuffer(currentPassengerCount = 0, seatCapacity = 50) {
  const count = Number(currentPassengerCount) || 0;
  const capacity = Number(seatCapacity) || 50;

  if (count <= 0) return 0; // Already at terminal, not an "approach" calc

  const occupancyRatio = count / capacity;

  // Dwell buffer logic
  if (occupancyRatio < 0.2) return 10; // Very few passengers, will board many
  if (occupancyRatio < 0.5) return 5; // Moderate passengers, some boarding
  return 0; // Nearly full, minimal loading
}

/**
 * Strategy 1 + 3: Calculate ETA using real-time speed & Haversine distance.
 * This is the fallback when OSRM is unavailable.
 */
function getFreeEtaMinutes(lat1, lon1, lat2, lon2, speedKph) {
  const baseDistance = haversineKm(lat1, lon1, lat2, lon2);
  if (baseDistance <= 0.08) return 1;

  // Strategy 3: Apply road buffering (1.18x accounts for non-direct road)
  const bufferedDistance = baseDistance * 1.18;

  const speed = Number(speedKph);
  // Clamp noisy GPS speed spikes to keep ETA stable/realistic.
  const effectiveSpeed =
    Number.isFinite(speed) && speed > 5 ? Math.min(70, Math.max(18, speed)) : 35;

  const etaHours = bufferedDistance / effectiveSpeed;
  return Math.max(1, Math.round(etaHours * 60));
}

/**
 * Strategy 1 (preferred): remaining travel time computed from real road segments
 * (services/corridorSegments.js) instead of a fresh OSRM point-to-point call. Sums the bus's
 * remaining distance on its *current* segment (at that segment's real current/historical speed,
 * via services/trafficProviders) plus every downstream segment to the destination. This replaces
 * the old "ask OSRM for lat1,lon1 -> lat2,lon2 on every ~3s ping" approach, which almost never hit
 * osrmTrafficService's 2-minute/~11m-precision cache for a moving bus and was hitting the public
 * OSRM router on nearly every ping. It also means traffic is folded into the ETA exactly once, at
 * the segment level — not as a second multiplier layered on an OSRM number that may already be
 * traffic-flavored.
 *
 * Returns null (caller falls back to OSRM/Haversine) when the bus has no resolvable corridor,
 * isn't within SEGMENT_PROXIMITY_M of any of its segments (off-route), or lat2/lon2 doesn't match
 * that corridor's own destination — never assumes segment math applies to an arbitrary two points.
 */
async function computeSegmentBasedEta({ lat1, lon1, lat2, lon2, busId }) {
  if (!busId) return null;
  const corridor = await matchCorridorForBus(busId).catch(() => null);
  if (!corridor) return null;
  const destination = corridor?.destinationCoverageId?.terminal;
  if (!destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) {
    return null;
  }
  if (haversineKm(lat2, lon2, destination.latitude, destination.longitude) * 1000 > 300) return null;

  const segments = await getCorridorSegments(corridor).catch(() => []);
  if (!segments.length) return null;

  const match = await matchPointToSegment(corridor, lat1, lon1).catch(() => null);
  if (!match) return null;

  const currentSegment = match.segment;
  const progress = progressAlongPolyline(lat1, lon1, currentSegment.polyline);
  if (!progress) return null;
  const remainingMetersOnSegment = Math.max(0, progress.totalDistanceMeters - progress.distanceTraveledMeters);

  const currentTraffic = await getTrafficForSegment(currentSegment.segmentId, corridor).catch(() => null);
  const currentSpeedKph = clampSegmentSpeedKph(currentTraffic?.speedKph);
  let totalMinutes = (remainingMetersOnSegment / 1000 / currentSpeedKph) * 60;

  let confidenceRank = CONFIDENCE_RANK[currentTraffic?.confidence] ?? 0;
  const trafficSource = currentTraffic?.trafficSource || "unavailable";

  for (const seg of segments) {
    if (seg.sequence <= currentSegment.sequence) continue;
    const traffic = await getTrafficForSegment(seg.segmentId, corridor).catch(() => null);
    const speedKph = clampSegmentSpeedKph(traffic?.speedKph);
    totalMinutes += (seg.distanceMeters / 1000 / speedKph) * 60;
    const rank = CONFIDENCE_RANK[traffic?.confidence] ?? 0;
    if (rank < confidenceRank) confidenceRank = rank;
  }

  return {
    etaMinutes: totalMinutes,
    trafficSource,
    confidence: CONFIDENCE_LABELS[confidenceRank] || "UNKNOWN",
  };
}

/**
 * Advanced ETA calculation with real-time traffic & all optimizations. Prefers the segment-based
 * calculation above; falls back to OSRM point-to-point, then Haversine, only when segments aren't
 * resolvable for this bus right now (e.g. off-route).
 *
 * @param {object} options - Configuration object
 * @param {number} options.lat1 - Current bus latitude
 * @param {number} options.lon1 - Current bus longitude
 * @param {number} options.lat2 - Destination latitude
 * @param {number} options.lon2 - Destination longitude
 * @param {number} options.speedKph - Current bus speed (km/h)
 * @param {string} options.busId - Bus identifier (for Kalman filter)
 * @param {number} options.passengerCount - Current passengers aboard
 * @param {number} options.seatCapacity - Bus seat capacity
 * @param {string} options.currentLocation - Current location name (for weather)
 * @param {string} options.nextLocation - Next stop name (for weather)
 * @param {string[]} options.stops - Array of upcoming stops
 * @returns {Promise<{etaMinutes:number, trafficSource:"live_provider"|"gps_derived"|"historical"|"route_only"|"unavailable", confidence:"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"}>}
 */
async function getAdvancedEtaMinutes(options = {}) {
  const {
    lat1,
    lon1,
    lat2,
    lon2,
    speedKph,
    busId,
    passengerCount = 0,
    seatCapacity = 50,
    currentLocation,
    nextLocation,
    stops = [],
  } = options;

  // Validate coordinates
  if (
    ![lat1, lon1, lat2, lon2].every((x) => Number.isFinite(x))
  ) {
    return { etaMinutes: 1, trafficSource: "unavailable", confidence: "UNKNOWN" };
  }

  let etaMinutes = 1;
  let trafficSource = "unavailable";
  let confidence = "UNKNOWN";

  const segmentEta = await computeSegmentBasedEta({ lat1, lon1, lat2, lon2, busId }).catch(() => null);
  if (segmentEta) {
    etaMinutes = segmentEta.etaMinutes;
    trafficSource = segmentEta.trafficSource;
    confidence = segmentEta.confidence;
  } else {
    // Fallback: bus isn't matched to a segment right now (off-route, or no usable corridor
    // geometry yet). Neither OSRM's static routing nor a Haversine estimate is a real traffic
    // signal — label honestly rather than implying either is "live" or "GPS-derived".
    try {
      const osrmEta = await getOsrmEta(lat1, lon1, lat2, lon2);
      if (osrmEta) {
        etaMinutes = osrmEta;
        trafficSource = "route_only";
        confidence = "LOW";
      } else {
        etaMinutes = getFreeEtaMinutes(lat1, lon1, lat2, lon2, speedKph);
      }
    } catch (err) {
      etaMinutes = getFreeEtaMinutes(lat1, lon1, lat2, lon2, speedKph);
    }
  }

  // Terminal dwell time (boarding buffer) — unchanged.
  const dwellBuffer = getTerminalDwellBuffer(passengerCount, seatCapacity);
  if (dwellBuffer > 0) {
    etaMinutes += dwellBuffer;
  }

  // Weather adjustment — unchanged, still capped 1.45x, applied exactly once (never re-applied
  // downstream — see delayClassifier.js, which no longer re-multiplies this ETA by a congestion
  // ratio the way it used to).
  if (currentLocation && nextLocation) {
    try {
      const beforeWeather = etaMinutes;
      etaMinutes = applyWeatherAdjustment(
        etaMinutes,
        currentLocation,
        nextLocation,
        stops
      );
      if (etaMinutes > beforeWeather) {
        console.log(
          `[ETA] Weather adjustment: ${beforeWeather} → ${etaMinutes} mins`
        );
      }
    } catch (err) {
      console.warn(`[ETA] Weather adjustment failed: ${err.message}`);
    }
  }

  // Confidence-adaptive Kalman smoothing: reacts faster for HIGH-confidence readings, smooths
  // harder for thin/stale/fallback ones (see kalmanFilterEta.js's CONFIDENCE_MEASUREMENT_NOISE).
  if (busId) {
    try {
      etaMinutes = smoothEtaWithKalman(busId, etaMinutes, { confidence });
    } catch (err) {
      console.warn(`[ETA] Kalman smoothing failed: ${err.message}`);
    }
  }

  return { etaMinutes: Math.max(1, Math.round(etaMinutes)), trafficSource, confidence };
}

function routeLikeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s*[→➔>–—-]\s*/g, " ")
    .replace(/\s+/g, " ");
}

/** Shared by resolveNextTerminalForBus() and getCorridorPolylineForBus() — same fuzzy match. */
const corridorForBusCache = new Map();
const CORRIDOR_FOR_BUS_CACHE_TTL_MS = 30 * 1000;

/** A single GPS ping now triggers several independent matchCorridorForBus lookups (ETA, congestion,
 *  delay classification, segment history tagging) — this short cache collapses those into one real
 *  DB round trip per bus per ~30s instead of one per caller per ping, without going stale enough to
 *  miss a genuine route reassignment for more than a few seconds. */
async function matchCorridorForBus(busId) {
  const key = String(busId);
  const cached = corridorForBusCache.get(key);
  if (cached && Date.now() - cached.ts < CORRIDOR_FOR_BUS_CACHE_TTL_MS) {
    return cached.corridor;
  }
  const bus = await Bus.findOne({ busId: key }).select("route").lean();
  const routeLabel = String(bus?.route || "").trim();
  let corridor = null;
  if (routeLabel) {
    const low = routeLikeName(routeLabel);
    const routes = await CorridorRoute.find({ suspended: { $ne: true } })
      .populate("originCoverageId", "locationName terminal")
      .populate("destinationCoverageId", "locationName terminal")
      .lean();
    corridor =
      routes.find((r) => routeLikeName(r.displayName || "").includes(low) || low.includes(routeLikeName(r.displayName || ""))) ||
      routes.find((r) => {
        const o = String(r.originCoverageId?.locationName || r.originCoverageId?.terminal?.name || "").toLowerCase();
        const d = String(r.destinationCoverageId?.locationName || r.destinationCoverageId?.terminal?.name || "").toLowerCase();
        return low.includes(o) && low.includes(d);
      }) ||
      null;
  }
  corridorForBusCache.set(key, { ts: Date.now(), corridor });
  return corridor;
}

const corridorPolylineCache = new Map();
const CORRIDOR_POLYLINE_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Dense, road-following {latitude,longitude} polyline for the corridor assigned to this bus's
 * route label — the same line the passenger map draws for "select a bus, see its route". Used to
 * project a raw GPS fix onto the actual highway the bus is assigned to (rather than whatever OSM
 * way happens to be nearest), so the live marker doesn't drift onto an unrelated side road.
 * Cached per corridor since it's built from several stitched OSRM legs. Returns null if the bus
 * has no resolvable corridor or the corridor has no usable terminal geometry.
 */
async function getCorridorPolylineForBus(busId) {
  const match = await matchCorridorForBus(busId).catch(() => null);
  if (!match) return null;
  const cacheKey = String(match._id);
  const cached = corridorPolylineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CORRIDOR_POLYLINE_CACHE_TTL_MS) {
    return cached.polyline;
  }
  const { getCorridorPolyline } = require("./corridorGeometry");
  const polyline = await getCorridorPolyline(match).catch(() => null);
  corridorPolylineCache.set(cacheKey, { ts: Date.now(), polyline });
  return polyline;
}

async function resolveNextTerminalForBus(busId) {
  const match = await matchCorridorForBus(busId);
  const terminal = match?.destinationCoverageId?.terminal;
  if (terminal && Number.isFinite(terminal.latitude) && Number.isFinite(terminal.longitude)) {
    return {
      name: String(match.destinationCoverageId.terminal.name || match.destinationCoverageId.locationName || "Terminal"),
      latitude: Number(terminal.latitude),
      longitude: Number(terminal.longitude),
      geofenceRadiusM: Number(terminal.geofenceRadiusM || 500),
    };
  }
  return null;
}

async function isNearAnyTerminal(latitude, longitude) {
  const rows = await RouteCoverage.find({ pointType: "terminal" }).select("terminal").lean();
  for (const row of rows) {
    const t = row?.terminal;
    if (!t) continue;
    if (!Number.isFinite(t.latitude) || !Number.isFinite(t.longitude)) continue;
    const dMeters = haversineKm(latitude, longitude, Number(t.latitude), Number(t.longitude)) * 1000;
    if (dMeters <= Number(t.geofenceRadiusM || 500)) return true;
  }
  return false;
}

module.exports = {
  haversineKm,
  getFreeEtaMinutes,
  getAdvancedEtaMinutes,
  getTerminalDwellBuffer,
  resolveNextTerminalForBus,
  isNearAnyTerminal,
  getCorridorPolylineForBus,
  matchCorridorForBus,
};

