/**
 * Weather Multiplier for ETA Adjustment.
 * Factors in weather conditions (fog, rain, thunderstorm) to adjust ETA.
 * Heavy rain or fog typically slows buses by 15–30%.
 */

const { getCachedWeatherAdvisories } = require("./weatherLocationAdvisories");

/**
 * WMO weather codes and their delay multipliers.
 * Multiplier: 1.0 = no delay, 1.2 = +20% delay, 1.5 = +50% delay, etc.
 */
const WEATHER_MULTIPLIERS = {
  // Clear/cloudy — no impact
  0: 1.0, // Clear sky
  1: 1.0, // Mainly clear
  2: 1.0, // Partly cloudy
  3: 1.0, // Overcast

  // Light precipitation — minimal impact
  45: 1.15, // Fog (reduced visibility on mountain roads)
  48: 1.15, // Fog + rime (icy conditions)
  51: 1.1, // Drizzle
  52: 1.1, // Light drizzle
  53: 1.1, // Moderate drizzle
  55: 1.12, // Heavy drizzle

  // Rain — moderate impact
  61: 1.2, // Slight rain
  63: 1.25, // Moderate rain
  65: 1.3, // Heavy rain
  66: 1.25, // Slight freezing rain
  67: 1.35, // Heavy freezing rain

  // Showers — high impact (intense localized)
  80: 1.25, // Slight rain showers
  81: 1.3, // Moderate rain showers
  82: 1.35, // Violent rain showers

  // Thunderstorms — severe impact
  95: 1.35, // Thunderstorm with slight hail
  96: 1.4, // Thunderstorm with moderate hail
  99: 1.45, // Thunderstorm with heavy hail
};

/**
 * Get weather conditions for a specific location.
 * Returns the highest delay multiplier if multiple conditions present.
 */
function getWeatherMultiplierForLocation(locationName) {
  try {
    const advisories = getCachedWeatherAdvisories();
    if (!advisories || !Array.isArray(advisories)) {
      return 1.0;
    }

    // Find advisory matching this location
    const advisory = advisories.find(
      (a) =>
        a?.weatherLocations &&
        Array.isArray(a.weatherLocations) &&
        a.weatherLocations.some((wl) => {
          const name = String(wl.name || "").toLowerCase().trim();
          const search = String(locationName || "").toLowerCase().trim();
          return name.includes(search) || search.includes(name);
        })
    );

    if (!advisory || !advisory.weatherLocations || advisory.weatherLocations.length === 0) {
      return 1.0;
    }

    // Find highest multiplier among all location readings
    let maxMultiplier = 1.0;
    for (const loc of advisory.weatherLocations) {
      const code = Number(loc.weatherCode);
      const multiplier = WEATHER_MULTIPLIERS[code] || 1.0;
      maxMultiplier = Math.max(maxMultiplier, multiplier);
    }

    return maxMultiplier;
  } catch (err) {
    console.warn(`[WeatherMultiplier] Error fetching weather for ${locationName}:`, err.message);
    return 1.0;
  }
}

/**
 * Get weather multipliers for a route (from bus current location through stops).
 * Returns average multiplier weighted by segment importance.
 */
function getWeatherMultiplierForRoute(busLocation, nextStops = []) {
  try {
    const locations = [busLocation, ...nextStops].filter(Boolean).map((l) => String(l || "").trim());

    if (locations.length === 0) {
      return 1.0;
    }

    const multipliers = locations.map((loc) => getWeatherMultiplierForLocation(loc));

    // Weight: current location 50%, intermediate stops 30%, next terminal 20%
    if (multipliers.length === 1) {
      return multipliers[0];
    }

    const weights = [0.5, ...Array(multipliers.length - 2).fill(0.3 / Math.max(1, multipliers.length - 2)), 0.2];
    return multipliers.reduce((sum, m, i) => sum + m * (weights[i] || 0), 0);
  } catch (err) {
    console.warn(`[WeatherMultiplier] Error computing route multiplier:`, err.message);
    return 1.0;
  }
}

/**
 * Apply weather adjustment to base ETA.
 * @param {number} baseEtaMinutes - ETA before weather adjustment
 * @param {string} fromLocation - Starting location
 * @param {string} toLocation - Destination location
 * @param {string[]} intermediateStops - Stops along the route
 * @returns {number} Adjusted ETA
 */
function applyWeatherAdjustment(baseEtaMinutes, fromLocation, toLocation, intermediateStops = []) {
  const stops = [fromLocation, ...intermediateStops, toLocation];
  const multiplier = getWeatherMultiplierForRoute(fromLocation, stops.slice(1));

  // Cap multiplier to prevent extreme delays
  const cappedMultiplier = Math.min(multiplier, 1.45);

  const adjustedEta = Math.round(baseEtaMinutes * cappedMultiplier);
  return Math.max(1, adjustedEta);
}

/**
 * Get a human-readable weather impact description.
 */
function getWeatherImpactDescription(multiplier) {
  if (multiplier <= 1.05) return "No weather impact";
  if (multiplier <= 1.15) return "Slight weather delays (fog/drizzle)";
  if (multiplier <= 1.25) return "Moderate weather delays (rain)";
  if (multiplier <= 1.35) return "Significant weather delays (heavy rain)";
  return "Severe weather delays (thunderstorm)";
}

module.exports = {
  getWeatherMultiplierForLocation,
  getWeatherMultiplierForRoute,
  applyWeatherAdjustment,
  getWeatherImpactDescription,
  WEATHER_MULTIPLIERS,
};
