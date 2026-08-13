/**
 * Road-snapping + coordinate validation for admin-created bus stops/terminals.
 *
 * Priority order (per the "route-aware stop placement" requirement):
 *   1. If the point already belongs to a corridor (via coverageId), snap to that corridor's own
 *      road-following geometry — prevents a stop from landing on a nearby parallel road instead
 *      of the road its route actually uses.
 *   2. Otherwise, snap to the nearest road in general via OSRM map-matching.
 *   3. If neither succeeds within the configured max distance, do not silently move the point.
 *
 * Reuses `snapGpsToRoad()` (Admin_Backend/services/osrmTrafficService.js) — previously dead code,
 * this is its first real caller — and the corridor-geometry helpers already built for
 * `GET /api/public/buses/:busId/route`.
 */
const { snapGpsToRoad } = require("./osrmTrafficService");
const { haversineMeters, findCorridorForCoverageId, getCorridorPolyline } = require("./corridorGeometry");

/** Same Bukidnon + northern-corridor box already used for Nominatim search bias (nominatimProxy.js / nominatimBukidnon.ts). */
const SERVICE_AREA_BOUNDS = { minLon: 124.35, maxLon: 125.65, minLat: 7.45, maxLat: 8.55 };
/** Small buffer so a point just outside the strict box (e.g. a stop near the edge of coverage) isn't rejected outright. */
const SERVICE_AREA_PADDING_DEG = 0.15;

const MAX_SNAP_DISTANCE_M = Number(process.env.STOP_SNAP_MAX_DISTANCE_M) || 60;

/** Light cache around road-match calls so an existing-stops audit run doesn't hammer OSRM for nearby/repeated points. */
const roadSnapCache = new Map();
const ROAD_SNAP_CACHE_TTL_MS = 5 * 60 * 1000;

function isInServiceArea(latitude, longitude) {
  return (
    longitude >= SERVICE_AREA_BOUNDS.minLon - SERVICE_AREA_PADDING_DEG &&
    longitude <= SERVICE_AREA_BOUNDS.maxLon + SERVICE_AREA_PADDING_DEG &&
    latitude >= SERVICE_AREA_BOUNDS.minLat - SERVICE_AREA_PADDING_DEG &&
    latitude <= SERVICE_AREA_BOUNDS.maxLat + SERVICE_AREA_PADDING_DEG
  );
}

function cachedRoadSnapKey(latitude, longitude) {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

async function cachedSnapGpsToRoad(latitude, longitude) {
  const key = cachedRoadSnapKey(latitude, longitude);
  const cached = roadSnapCache.get(key);
  if (cached && Date.now() - cached.ts < ROAD_SNAP_CACHE_TTL_MS) return cached.data;
  const data = await snapGpsToRoad(latitude, longitude);
  roadSnapCache.set(key, { ts: Date.now(), data });
  return data;
}

/** Nearest vertex on a dense {latitude,longitude}[] polyline, plus the distance to it. */
function nearestPointOnPolyline(point, polyline) {
  let best = null;
  let bestDistance = Infinity;
  for (const p of polyline) {
    const d = haversineMeters(point, p);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  if (!best) return null;
  return { latitude: best.latitude, longitude: best.longitude, distance: bestDistance };
}

/**
 * @param {{latitude:number, longitude:number, coverageId?:string, snapEnabled?:boolean}} input
 * @returns {Promise<{
 *   valid: boolean, inServiceArea: boolean, snapped: boolean, snapSource: "corridor"|"road"|null,
 *   latitude: number, longitude: number, originalLatitude: number, originalLongitude: number,
 *   distanceFromOriginal: number, roadDistance: number, reason: string|null,
 * }>}
 */
async function validateBusStopLocation({ latitude, longitude, coverageId, snapEnabled = true }) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return {
      valid: false,
      inServiceArea: false,
      snapped: false,
      snapSource: null,
      latitude: lat,
      longitude: lng,
      originalLatitude: lat,
      originalLongitude: lng,
      distanceFromOriginal: 0,
      roadDistance: null,
      reason: "invalid_coordinates",
    };
  }

  const original = { latitude: lat, longitude: lng };
  const inServiceArea = isInServiceArea(lat, lng);

  const base = {
    valid: true,
    inServiceArea,
    originalLatitude: lat,
    originalLongitude: lng,
  };

  if (!inServiceArea) {
    return {
      ...base,
      snapped: false,
      snapSource: null,
      latitude: lat,
      longitude: lng,
      distanceFromOriginal: 0,
      roadDistance: null,
      reason: "outside_service_area",
    };
  }

  if (!snapEnabled) {
    return {
      ...base,
      snapped: false,
      snapSource: null,
      latitude: lat,
      longitude: lng,
      distanceFromOriginal: 0,
      roadDistance: null,
      reason: null,
    };
  }

  // Priority 1: assigned route geometry.
  try {
    const corridorDoc = await findCorridorForCoverageId(coverageId);
    if (corridorDoc) {
      const polyline = await getCorridorPolyline(corridorDoc);
      if (polyline && polyline.length > 0) {
        const nearest = nearestPointOnPolyline(original, polyline);
        if (nearest && nearest.distance <= MAX_SNAP_DISTANCE_M) {
          return {
            ...base,
            snapped: true,
            snapSource: "corridor",
            latitude: nearest.latitude,
            longitude: nearest.longitude,
            distanceFromOriginal: Math.round(nearest.distance * 10) / 10,
            roadDistance: 0,
            reason: null,
          };
        }
      }
    }
  } catch (e) {
    console.warn("[busStopLocationValidation] corridor snap failed:", e.message || e);
  }

  // Priority 2: general nearest-road snap.
  try {
    const matched = await cachedSnapGpsToRoad(lat, lng);
    if (matched && Number.isFinite(matched.snappedDistance)) {
      if (matched.snappedDistance <= MAX_SNAP_DISTANCE_M) {
        return {
          ...base,
          snapped: true,
          snapSource: "road",
          latitude: matched.latitude,
          longitude: matched.longitude,
          distanceFromOriginal: Math.round(matched.snappedDistance * 10) / 10,
          roadDistance: 0,
          reason: null,
        };
      }
      // Nearest road exists but is too far — report the real gap, don't move the point.
      return {
        ...base,
        snapped: false,
        snapSource: null,
        latitude: lat,
        longitude: lng,
        distanceFromOriginal: 0,
        roadDistance: Math.round(matched.snappedDistance * 10) / 10,
        reason: "too_far_from_road",
      };
    }
  } catch (e) {
    console.warn("[busStopLocationValidation] road snap failed:", e.message || e);
  }

  // Priority 3: OSRM unavailable or returned nothing usable.
  return {
    ...base,
    snapped: false,
    snapSource: null,
    latitude: lat,
    longitude: lng,
    distanceFromOriginal: 0,
    roadDistance: null,
    reason: "osrm_unavailable",
  };
}

module.exports = { validateBusStopLocation, MAX_SNAP_DISTANCE_M, isInServiceArea };
