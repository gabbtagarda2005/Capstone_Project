/**
 * OSRM (Open Source Routing Machine) Integration for Real-Time ETA.
 * Uses actual road geometry and live traffic conditions instead of straight-line distance.
 * Falls back gracefully if OSRM is unavailable.
 */

const https = require("https");

// Configuration - can be customized via env vars
const OSRM_HOST = process.env.OSRM_HOST || "router.project-osrm.org";
const OSRM_TIMEOUT_MS = parseInt(process.env.OSRM_TIMEOUT_MS || "5000", 10);
const ENABLE_OSRM = process.env.ENABLE_OSRM !== "false"; // Default enabled

// Request cache (in-memory with TTL)
const routeCache = new Map();
const ROUTE_CACHE_TTL_MS = 120000; // 2 minutes

/**
 * Generate cache key for route query.
 */
function getCacheKey(lat1, lon1, lat2, lon2) {
  // Round to 4 decimal places (~11m accuracy) to consolidate similar queries
  const key = `${lat1.toFixed(4)},${lon1.toFixed(4)},${lat2.toFixed(4)},${lon2.toFixed(4)}`;
  return key;
}

/**
 * Fetch route data from OSRM with timeout.
 * Returns: { durationSeconds, distanceMeters, geometry }
 */
async function fetchOsrmRoute(lat1, lon1, lat2, lon2) {
  if (!ENABLE_OSRM) {
    return null;
  }

  const cacheKey = getCacheKey(lat1, lon1, lat2, lon2);
  const cached = routeCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < ROUTE_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    // OSRM format: /route/v1/{profile}/{coordinates}
    // Coordinates must be [lon,lat] (GeoJSON order)
    const coords = `${lon1.toFixed(6)},${lat1.toFixed(6)};${lon2.toFixed(6)},${lat2.toFixed(6)}`;
    const path = `/route/v1/driving/${coords}?steps=false&annotations=duration,distance,speed`;

    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("OSRM request timeout")),
        OSRM_TIMEOUT_MS
      );

      const req = https.get(
        `https://${OSRM_HOST}${path}`,
        { timeout: OSRM_TIMEOUT_MS },
        (res) => {
          clearTimeout(timeout);
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("Failed to parse OSRM response"));
            }
          });
        }
      );

      req.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.on("timeout", () => {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error("OSRM request timeout"));
      });
    });

    if (response.code === "Ok" && response.routes && response.routes.length > 0) {
      const route = response.routes[0];
      const result = {
        durationSeconds: Math.round(route.duration),
        distanceMeters: Math.round(route.distance),
        geometry: route.geometry, // GeoJSON geometry if requested
      };

      // Cache result
      routeCache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;
    } else {
      console.warn(
        `[OSRM] Unexpected response: ${response.code || "unknown"}`
      );
      return null;
    }
  } catch (err) {
    console.warn(`[OSRM] Route fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Get ETA from OSRM route data (with optional speed adjustment).
 * @param {object} route - Route object from fetchOsrmRoute()
 * @param {number} speedMultiplier - Optional multiplier for speed (1.0 = use OSRM time as-is, 0.8 = 20% slower)
 * @returns {number} ETA in minutes
 */
function getEtaFromOsrmRoute(route, speedMultiplier = 1.0) {
  if (!route || !route.durationSeconds) {
    return null;
  }

  const adjustedDurationSec = route.durationSeconds / speedMultiplier;
  const etaMinutes = Math.round(adjustedDurationSec / 60);

  return Math.max(1, etaMinutes);
}

/**
 * Snap GPS coordinates to nearest road (using OSRM match service).
 * This corrects GPS drift that puts the bus off-road.
 * Returns: { latitude, longitude, snappedDistance }
 */
async function snapGpsToRoad(latitude, longitude) {
  if (!ENABLE_OSRM) {
    return { latitude, longitude, snappedDistance: 0 };
  }

  try {
    const coords = `${longitude.toFixed(6)},${latitude.toFixed(6)}`;
    const path = `/match/v1/driving/${coords}?steps=false`;

    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("OSRM match timeout")),
        OSRM_TIMEOUT_MS
      );

      const req = https.get(
        `https://${OSRM_HOST}${path}`,
        { timeout: OSRM_TIMEOUT_MS },
        (res) => {
          clearTimeout(timeout);
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("Failed to parse OSRM match response"));
            }
          });
        }
      );

      req.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    if (
      response.code === "Ok" &&
      response.matchings &&
      response.matchings.length > 0 &&
      response.matchings[0].location
    ) {
      const [lon, lat] = response.matchings[0].location;
      const distance = response.matchings[0].distance || 0;

      return {
        latitude: lat,
        longitude: lon,
        snappedDistance: distance,
      };
    }

    return { latitude, longitude, snappedDistance: 0 };
  } catch (err) {
    console.warn(`[OSRM] GPS snap failed: ${err.message}`);
    return { latitude, longitude, snappedDistance: 0 };
  }
}

/**
 * Get real-time ETA using OSRM.
 * @param {number} fromLat - Starting latitude
 * @param {number} fromLon - Starting longitude
 * @param {number} toLat - Destination latitude
 * @param {number} toLon - Destination longitude
 * @returns {number|null} ETA in minutes, or null if OSRM unavailable
 */
async function getOsrmEta(fromLat, fromLon, toLat, toLon) {
  try {
    const route = await fetchOsrmRoute(fromLat, fromLon, toLat, toLon);
    if (route) {
      return getEtaFromOsrmRoute(route);
    }
  } catch (err) {
    console.warn(`[OSRM] ETA fetch failed: ${err.message}`);
  }
  return null;
}

/**
 * Get distance from OSRM route (actual road distance, not haversine).
 * @returns {number|null} Distance in kilometers
 */
async function getOsrmDistance(fromLat, fromLon, toLat, toLon) {
  try {
    const route = await fetchOsrmRoute(fromLat, fromLon, toLat, toLon);
    if (route) {
      return route.distanceMeters / 1000; // Convert to km
    }
  } catch (err) {
    console.warn(`[OSRM] Distance fetch failed: ${err.message}`);
  }
  return null;
}

/**
 * Clear cache (useful for testing or manual refresh).
 */
function clearRouteCache() {
  routeCache.clear();
  console.log("[OSRM] Route cache cleared");
}

module.exports = {
  fetchOsrmRoute,
  getEtaFromOsrmRoute,
  snapGpsToRoad,
  getOsrmEta,
  getOsrmDistance,
  clearRouteCache,
  OSRM_HOST,
  OSRM_TIMEOUT_MS,
  ENABLE_OSRM,
};
