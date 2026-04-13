const mongoose = require("mongoose");
const RouteCoverage = require("../models/RouteCoverage");
const TicketLocation = require("../models/TicketLocation");

/** Open-Meteo WMO weather_code — rain, drizzle, showers, thunderstorm. */
function isRainRelatedCode(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return false;
  if (c >= 51 && c <= 67) return true;
  if (c >= 80 && c <= 82) return true;
  if (c >= 95 && c <= 99) return true;
  return false;
}

/** Fog / depositing rime fog — reduced visibility on upland segments. */
function isFogRelatedCode(code) {
  const c = Number(code);
  return c === 45 || c === 48;
}

function needsPassengerAdvisory(code) {
  return isRainRelatedCode(code) || isFogRelatedCode(code);
}

function labelForCode(code) {
  const c = Number(code);
  if (isFogRelatedCode(c)) return "Fog / reduced visibility";
  if (c >= 95) return "Thunderstorm / heavy rain";
  if (c >= 80) return "Rain showers";
  if (c >= 61) return "Rain";
  if (c >= 51) return "Drizzle / light rain";
  return "Wet conditions";
}

/** Human label for any WMO code (passenger-facing). */
function summaryForAnyWeatherCode(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return "Unknown";
  if (c === 0) return "Clear sky";
  if (c === 1) return "Mainly clear";
  if (c === 2) return "Partly cloudy";
  if (c === 3) return "Overcast";
  if (c === 45) return "Fog";
  if (c === 48) return "Fog / rime";
  if (c >= 51 && c <= 55) return "Drizzle";
  if (c >= 56 && c <= 57) return "Freezing drizzle";
  if (c >= 61 && c <= 65) return "Rain";
  if (c >= 66 && c <= 67) return "Freezing rain";
  if (c >= 71 && c <= 77) return "Snow";
  if (c >= 80 && c <= 82) return "Rain showers";
  if (c >= 85 && c <= 86) return "Snow showers";
  if (c === 95) return "Thunderstorm";
  if (c >= 96 && c <= 99) return "Thunderstorm / hail";
  return "Mixed conditions";
}

/**
 * All coordinates the admin defined: corridor hubs, stops, optional location points, ticketing stops.
 * Dedupes by ~11 m grid so stacked stops do not spam the API.
 */
async function collectAllMonitoredSpots() {
  const seen = new Set();
  const spots = [];

  function add(lat, lon, name) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return;
    const la = Number(lat);
    const lo = Number(lon);
    const key = `${la.toFixed(4)},${lo.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const n = String(name || "").trim() || "Location";
    spots.push({ name: n, lat: la, lon: lo });
  }

  const rows = await RouteCoverage.find({})
    .select("locationName terminal stops locationPoint")
    .lean();

  for (const r of rows) {
    const hub = String(r.locationName || "").trim();
    const t = r.terminal;
    if (t && Number.isFinite(Number(t.latitude)) && Number.isFinite(Number(t.longitude))) {
      const term = String(t.name || "").trim();
      add(t.latitude, t.longitude, hub || term || "Terminal");
    }
    const lp = r.locationPoint;
    if (
      lp &&
      Number.isFinite(Number(lp.latitude)) &&
      Number.isFinite(Number(lp.longitude))
    ) {
      const ln = String(lp.name || "").trim();
      add(lp.latitude, lp.longitude, ln || hub || "Location point");
    }
    const stops = Array.isArray(r.stops) ? r.stops : [];
    for (const s of stops) {
      if (!s) continue;
      const sn = String(s.name || "").trim();
      const label = hub && sn ? `${hub} — ${sn}` : sn || hub || "Stop";
      add(s.latitude, s.longitude, label);
    }
  }

  const ticketLocs = await TicketLocation.find({}).select("name latitude longitude").lean();
  for (const q of ticketLocs) {
    if (!q) continue;
    add(q.latitude, q.longitude, String(q.name || "").trim() || "Ticketing stop");
  }

  spots.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return spots;
}

async function fetchWeatherForSpot(s) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(s.lat)}` +
    `&longitude=${encodeURIComponent(s.lon)}&current=weather_code&timezone=auto`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const data = await res.json();
    const code = Number(data?.current?.weather_code);
    if (!Number.isFinite(code)) return null;
    const summary = needsPassengerAdvisory(code) ? labelForCode(code) : summaryForAnyWeatherCode(code);
    return {
      locationName: s.name,
      code,
      summary,
      isRain: isRainRelatedCode(code),
      isFog: isFogRelatedCode(code),
    };
  } catch {
    clearTimeout(to);
    return null;
  }
}

/** Limit parallel Open-Meteo calls per refresh. */
async function mapInChunks(items, chunkSize, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const part = await Promise.all(chunk.map(fn));
    for (const p of part) {
      if (p) out.push(p);
    }
  }
  return out;
}

let cache = {
  alerts: [],
  byLocation: [],
  updatedAt: null,
};

async function refreshWeatherAdvisoriesOnce() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const spots = await collectAllMonitoredSpots();
    const byLocation = await mapInChunks(spots, 8, fetchWeatherForSpot);
    byLocation.sort((a, b) => String(a.locationName).localeCompare(String(b.locationName)));

    const alerts = byLocation
      .filter((x) => needsPassengerAdvisory(x.code))
      .map((x) => ({
        locationName: x.locationName,
        code: x.code,
        summary: labelForCode(x.code),
      }));

    const now = new Date().toISOString();
    cache = {
      alerts,
      byLocation,
      updatedAt: now,
    };
  } catch (e) {
    console.warn("[weather-advisories]", e.message || e);
  }
}

function handleGetWeatherAdvisories(_req, res) {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    alerts: cache.alerts,
    byLocation: cache.byLocation || [],
    updatedAt: cache.updatedAt,
  });
}

/** Snapshot for passenger command feed + HTTP handler. */
function getCachedWeatherAdvisories() {
  return {
    alerts: cache.alerts || [],
    byLocation: cache.byLocation || [],
    updatedAt: cache.updatedAt,
  };
}

let intervalRef = null;

function startWeatherAdvisoryPoller() {
  void refreshWeatherAdvisoriesOnce();
  if (intervalRef) clearInterval(intervalRef);
  intervalRef = setInterval(() => void refreshWeatherAdvisoriesOnce(), 10 * 60 * 1000);
}

module.exports = {
  handleGetWeatherAdvisories,
  startWeatherAdvisoryPoller,
  refreshWeatherAdvisoriesOnce,
  getCachedWeatherAdvisories,
};
