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

module.exports = {
  haversineMeters,
  buildOrderedRouteWaypoints,
  stitchRouteGeometry,
  findCorridorForCoverageId,
  getCorridorPolyline,
};
