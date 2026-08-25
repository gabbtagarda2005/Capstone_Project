/**
 * Shared corridor road-geometry helpers — waypoint ordering + OSRM leg-stitching, and looking up
 * which corridor (if any) a RouteCoverage point belongs to. Extracted from the logic originally
 * written inline for `GET /api/public/buses/:busId/route` (server.js) so the bus-stop
 * road-snapping validator can reuse the exact same corridor-geometry construction instead of
 * duplicating it.
 */
const CorridorRoute = require("../models/CorridorRoute");
const { fetchOsrmRoute } = require("./osrmTrafficService");

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function buildOrderedRouteWaypoints(origin, stops, destination) {
  const sorted = [...(stops || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const raw = [origin, ...sorted, destination].filter(
    (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );
  const deduped = [];
  for (const p of raw) {
    const prev = deduped[deduped.length - 1];
    if (prev && haversineMeters(prev, p) < 30) continue;
    deduped.push(p);
  }
  return deduped;
}

/**
 * Stitches consecutive OSRM driving legs between ordered waypoints into one continuous path.
 * Returns GeoJSON-order coordinates ([lng, lat] pairs), matching OSRM's own convention, plus
 * summed distance/duration. Falls back to a straight 2-point segment for any leg OSRM can't route.
 */
async function stitchRouteGeometry(waypoints) {
  const coordinates = [];
  let totalDistanceM = 0;
  let totalDurationS = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    let leg = null;
    try {
      leg = await fetchOsrmRoute(a.latitude, a.longitude, b.latitude, b.longitude);
    } catch {
      leg = null;
    }
    let legCoords;
    if (leg && leg.geometry && Array.isArray(leg.geometry.coordinates) && leg.geometry.coordinates.length > 1) {
      legCoords = leg.geometry.coordinates;
      totalDistanceM += leg.distanceMeters || 0;
      totalDurationS += leg.durationSeconds || 0;
    } else {
      legCoords = [
        [a.longitude, a.latitude],
        [b.longitude, b.latitude],
      ];
      totalDistanceM += haversineMeters(a, b);
    }
    if (
      coordinates.length &&
      legCoords.length &&
      coordinates[coordinates.length - 1][0] === legCoords[0][0] &&
      coordinates[coordinates.length - 1][1] === legCoords[0][1]
    ) {
      coordinates.push(...legCoords.slice(1));
    } else {
      coordinates.push(...legCoords);
    }
  }
  return { coordinates, distanceMeters: totalDistanceM, durationSeconds: totalDurationS };
}

/** First non-suspended CorridorRoute that references this RouteCoverage _id anywhere in its geometry. */
async function findCorridorForCoverageId(coverageId) {
  if (!coverageId) return null;
  return CorridorRoute.findOne({
    suspended: { $ne: true },
    $or: [
      { originCoverageId: coverageId },
      { destinationCoverageId: coverageId },
      { viaCoverageIds: coverageId },
      { "authorizedStops.coverageId": coverageId },
    ],
  })
    .populate("originCoverageId")
    .populate("destinationCoverageId")
    .lean();
}

/** Dense {latitude,longitude} polyline (road-following) for a populated corridor doc, or null if unavailable. */
async function getCorridorPolyline(corridorDoc) {
  const origin = corridorDoc?.originCoverageId?.terminal;
  const destination = corridorDoc?.destinationCoverageId?.terminal;
  if (
    !origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude) ||
    !destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)
  ) {
    return null;
  }
  const waypoints = buildOrderedRouteWaypoints(origin, corridorDoc.authorizedStops, destination);
  if (waypoints.length < 2) return null;
  const { coordinates } = await stitchRouteGeometry(waypoints);
  return coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}

const coveragePolylineCache = new Map();
const COVERAGE_POLYLINE_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Road-following polyline for the corridor a RouteCoverage point (terminal/stop location group)
 * belongs to, cached per corridor so repeated stops on the same corridor don't re-stitch OSRM legs.
 * Returns null if the point isn't part of any (non-suspended) corridor.
 */
async function getCorridorPolylineForCoverage(coverageId) {
  if (!coverageId) return null;
  const key = String(coverageId);
  const cached = coveragePolylineCache.get(key);
  if (cached && Date.now() - cached.ts < COVERAGE_POLYLINE_CACHE_TTL_MS) {
    return cached.polyline;
  }
  const corridorDoc = await findCorridorForCoverageId(coverageId).catch(() => null);
  const polyline = corridorDoc ? await getCorridorPolyline(corridorDoc).catch(() => null) : null;
  coveragePolylineCache.set(key, { ts: Date.now(), polyline });
  return polyline;
}

/**
 * Closest point on a {latitude,longitude} polyline to (lat, lon), via flat-plane projection onto
 * each segment (fine at road-corridor scale — a few km at most, no antimeridian concerns here).
 * Returns { latitude, longitude, distanceMeters } for the closest segment, or null for a
 * degenerate (<2 point) polyline.
 */
function nearestPointOnPolyline(lat, lon, polyline) {
  if (!Array.isArray(polyline) || polyline.length < 2) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  // Local flat-plane scale factors (meters per degree) centered near the query point.
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(toRad(lat));
  const px = lon * mPerDegLon;
  const py = lat * mPerDegLat;

  let best = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const ax = a.longitude * mPerDegLon;
    const ay = a.latitude * mPerDegLat;
    const bx = b.longitude * mPerDegLon;
    const by = b.latitude * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const dMeters = Math.hypot(px - cx, py - cy);
    if (!best || dMeters < best.distanceMeters) {
      best = {
        latitude: cy / mPerDegLat,
        longitude: cx / mPerDegLon,
        distanceMeters: dMeters,
      };
    }
  }
  return best;
}

const freeFlowProfileCache = new Map();
const FREE_FLOW_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * "Free-flow" reference speed for a corridor — OSRM's routed duration/distance for the full
 * corridor, which reflects normal (uncongested) driving conditions since OSRM's default profile
 * has no live-traffic input. This is the honest baseline the congestion engine compares a bus's
 * actual live speed against (congestionRatio = 1 - liveSpeed/freeFlowSpeed) — never a guessed or
 * hardcoded number. Returns null if the corridor has no usable terminal geometry or OSRM/haversine
 * legs produced zero distance.
 */
async function getCorridorFreeFlowProfile(corridorDoc) {
  const origin = corridorDoc?.originCoverageId?.terminal;
  const destination = corridorDoc?.destinationCoverageId?.terminal;
  if (
    !origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude) ||
    !destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)
  ) {
    return null;
  }
  const cacheKey = String(corridorDoc._id);
  const cached = freeFlowProfileCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FREE_FLOW_PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }
  const waypoints = buildOrderedRouteWaypoints(origin, corridorDoc.authorizedStops, destination);
  if (waypoints.length < 2) return null;
  const { distanceMeters, durationSeconds } = await stitchRouteGeometry(waypoints);
  let profile = null;
  if (distanceMeters > 0 && durationSeconds > 0) {
    profile = {
      freeFlowKph: (distanceMeters / durationSeconds) * 3.6,
      distanceMeters,
      durationSeconds,
    };
  }
  freeFlowProfileCache.set(cacheKey, { ts: Date.now(), profile });
  return profile;
}

module.exports = {
  haversineMeters,
  buildOrderedRouteWaypoints,
  stitchRouteGeometry,
  findCorridorForCoverageId,
  getCorridorPolyline,
  getCorridorPolylineForCoverage,
  getCorridorFreeFlowProfile,
  nearestPointOnPolyline,
};
