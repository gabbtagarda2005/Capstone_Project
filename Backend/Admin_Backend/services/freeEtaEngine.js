const Bus = require("../models/Bus");
const CorridorRoute = require("../models/CorridorRoute");
const RouteCoverage = require("../models/RouteCoverage");
const { smoothEtaWithKalman, resetEtaFilter } = require("./kalmanFilterEta");
const { applyWeatherAdjustment } = require("./weatherEtaMultiplier");
const { getOsrmEta, snapGpsToRoad } = require("./osrmTrafficService");

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
 * Strategy 1: Advanced ETA calculation with real-time traffic & all optimizations.
 * Tries OSRM first, falls back to Haversine with speed clamping.
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
 * @returns {Promise<number>} ETA in minutes
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
    return 1;
  }

  let etaMinutes = 1;

  try {
    // Try Strategy 1: Use OSRM for real-time traffic-aware routing
    const osrmEta = await getOsrmEta(lat1, lon1, lat2, lon2);
    if (osrmEta) {
      etaMinutes = osrmEta;
      console.log(
        `[ETA] OSRM route available: ${etaMinutes} mins for bus ${busId}`
      );
    } else {
      // Fallback to Haversine
      etaMinutes = getFreeEtaMinutes(lat1, lon1, lat2, lon2, speedKph);
      console.log(
        `[ETA] OSRM unavailable, using Haversine: ${etaMinutes} mins for bus ${busId}`
      );
    }
  } catch (err) {
    // Silent fallback on error
    etaMinutes = getFreeEtaMinutes(lat1, lon1, lat2, lon2, speedKph);
  }

  // Strategy 2: Add terminal dwell time (boarding buffer)
  const dwellBuffer = getTerminalDwellBuffer(passengerCount, seatCapacity);
  if (dwellBuffer > 0) {
    etaMinutes += dwellBuffer;
    console.log(
      `[ETA] Added dwell buffer (+${dwellBuffer} mins): passengers ${passengerCount}/${seatCapacity}`
    );
  }

  // Strategy 4: Apply weather adjustments
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

  // Strategy 5: Apply Kalman smoothing (if busId provided)
  if (busId) {
    try {
      const smoothedEta = smoothEtaWithKalman(busId, etaMinutes);
      if (smoothedEta !== etaMinutes) {
        console.log(
          `[ETA] Kalman smoothing: ${etaMinutes} → ${smoothedEta} mins`
        );
      }
      etaMinutes = smoothedEta;
    } catch (err) {
      console.warn(`[ETA] Kalman smoothing failed: ${err.message}`);
    }
  }

  return Math.max(1, Math.round(etaMinutes));
}

function routeLikeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s*[→➔>–—-]\s*/g, " ")
    .replace(/\s+/g, " ");
}

async function resolveNextTerminalForBus(busId) {
  const bus = await Bus.findOne({ busId: String(busId) }).select("route").lean();
  const routeLabel = String(bus?.route || "").trim();
  if (!routeLabel) return null;
  const low = routeLikeName(routeLabel);
  const routes = await CorridorRoute.find()
    .populate("originCoverageId", "locationName terminal")
    .populate("destinationCoverageId", "locationName terminal")
    .lean();
  const match =
    routes.find((r) => routeLikeName(r.displayName || "").includes(low) || low.includes(routeLikeName(r.displayName || ""))) ||
    routes.find((r) => {
      const o = String(r.originCoverageId?.locationName || r.originCoverageId?.terminal?.name || "").toLowerCase();
      const d = String(r.destinationCoverageId?.locationName || r.destinationCoverageId?.terminal?.name || "").toLowerCase();
      return low.includes(o) && low.includes(d);
    });
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
};

