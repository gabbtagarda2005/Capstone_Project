/**
 * Road-segment breakdown for a corridor — the piece the traffic/heat-map/delay engines were
 * missing (see corridorGeometry.js/corridorFreeFlowCalibration.js, which only ever produced ONE
 * free-flow number for a whole corridor end-to-end). A corridor's `authorizedStops`
 * (models/CorridorRoute.js) already give it an ordered list of REAL stop coordinates between
 * origin and destination — this module treats each consecutive waypoint pair (origin→stop1,
 * stop1→stop2, ..., stopN→destination) as one road segment, reusing the exact leg breakdown
 * corridorGeometry.stitchRouteGeometry() already computes before concatenating it into one
 * polyline. No invented geometry, no new coordinates — only real, already-stored route data.
 */
const CorridorRoute = require("../models/CorridorRoute");
const {
  buildOrderedRouteWaypoints,
  stitchRouteGeometry,
  nearestPointOnPolyline,
} = require("./corridorGeometry");

/** Mirrors corridorFreeFlowCalibration.js's CORRIDOR_PROXIMITY_M — how close a GPS fix must be to
 *  a segment's own polyline to count as "on" that segment rather than off-route. */
const SEGMENT_PROXIMITY_M = 250;

const segmentsCache = new Map();
const SEGMENTS_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * @returns {Promise<Array<{
 *   segmentId: string, corridorId: string, sequence: number,
 *   fromName: string|null, toName: string|null,
 *   polyline: {latitude:number, longitude:number}[],
 *   distanceMeters: number, osrmDurationSeconds: number,
 * }>>}
 */
async function getCorridorSegments(corridorDoc) {
  const origin = corridorDoc?.originCoverageId?.terminal;
  const destination = corridorDoc?.destinationCoverageId?.terminal;
  if (
    !origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude) ||
    !destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)
  ) {
    return [];
  }
  const cacheKey = String(corridorDoc._id);
  const cached = segmentsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEGMENTS_CACHE_TTL_MS) {
    return cached.segments;
  }

  const namedOrigin = { ...origin, name: origin.name || "Origin" };
  const namedDestination = { ...destination, name: destination.name || "Destination" };
  const waypoints = buildOrderedRouteWaypoints(namedOrigin, corridorDoc.authorizedStops, namedDestination);
  if (waypoints.length < 2) {
    segmentsCache.set(cacheKey, { ts: Date.now(), segments: [] });
    return [];
  }

  const { legs } = await stitchRouteGeometry(waypoints);
  const segments = (legs || []).map((leg, i) => ({
    segmentId: `${cacheKey}:${i}`,
    corridorId: cacheKey,
    sequence: i,
    fromName: leg.fromName,
    toName: leg.toName,
    polyline: leg.coordinates,
    distanceMeters: leg.distanceMeters,
    osrmDurationSeconds: leg.durationSeconds,
  }));
  segmentsCache.set(cacheKey, { ts: Date.now(), segments });
  return segments;
}

/**
 * Which segment (if any) a GPS fix belongs to, by nearest-polyline distance. Returns
 * `{ segment, distanceMeters, pointOnSegment }` for a real match, or `null` if the fix is further
 * than SEGMENT_PROXIMITY_M from every segment of this corridor (off-route — never force a match).
 */
async function matchPointToSegment(corridorDoc, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const segments = await getCorridorSegments(corridorDoc);
  let best = null;
  for (const segment of segments) {
    const nearest = nearestPointOnPolyline(lat, lon, segment.polyline);
    if (!nearest) continue;
    if (!best || nearest.distanceMeters < best.distanceMeters) {
      best = { segment, distanceMeters: nearest.distanceMeters, pointOnSegment: nearest };
    }
  }
  if (!best || best.distanceMeters > SEGMENT_PROXIMITY_M) return null;
  return best;
}

/** All segments across every non-suspended corridor — the fan-out source for the heat map. */
async function getAllCorridorSegments() {
  const corridors = await CorridorRoute.find({ suspended: { $ne: true } })
    .populate("originCoverageId", "locationName terminal")
    .populate("destinationCoverageId", "locationName terminal")
    .lean();
  const out = [];
  for (const corridor of corridors) {
    const segments = await getCorridorSegments(corridor).catch(() => []);
    for (const s of segments) out.push({ ...s, corridorDoc: corridor });
  }
  return out;
}

module.exports = {
  getCorridorSegments,
  matchPointToSegment,
  getAllCorridorSegments,
  SEGMENT_PROXIMITY_M,
};
