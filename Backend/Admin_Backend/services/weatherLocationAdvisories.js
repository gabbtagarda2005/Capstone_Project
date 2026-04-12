const mongoose = require("mongoose");
const RouteCoverage = require("../models/RouteCoverage");

/** Open-Meteo WMO weather_code — rain, drizzle, showers, thunderstorm. */
function isRainRelatedCode(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return false;
  if (c >= 51 && c <= 67) return true;
  if (c >= 80 && c <= 82) return true;
  if (c >= 95 && c <= 99) return true;
  return false;
}

function labelForCode(code) {
  const c = Number(code);
  if (c >= 95) return "Thunderstorm / heavy rain";
  if (c >= 80) return "Rain showers";
  if (c >= 61) return "Rain";
  if (c >= 51) return "Drizzle / light rain";
  return "Wet conditions";
}

let cache = {
  alerts: [],
  updatedAt: null,
};

async function refreshWeatherAdvisoriesOnce() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const rows = await RouteCoverage.find({})
      .select("locationName terminal.latitude terminal.longitude terminal.name")
      .lean();

    const spots = [];
    const seen = new Set();
    for (const r of rows) {
      const t = r.terminal;
      if (!t || !Number.isFinite(Number(t.latitude)) || !Number.isFinite(Number(t.longitude))) continue;
      const lat = Number(t.latitude);
      const lon = Number(t.longitude);
      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const loc = String(r.locationName || "").trim();
      const term = String(t.name || "").trim();
      const name = loc || term || "Terminal";
      spots.push({ name, lat, lon });
    }

    const alerts = [];
    await Promise.all(
      spots.map(async (s) => {
        try {
          const url =
            `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(s.lat)}` +
            `&longitude=${encodeURIComponent(s.lon)}&current=weather_code&timezone=auto`;
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 10_000);
          const res = await fetch(url, { signal: ctrl.signal });
          clearTimeout(to);
          if (!res.ok) return;
          const data = await res.json();
          const code = Number(data?.current?.weather_code);
          if (!isRainRelatedCode(code)) return;
          alerts.push({
            locationName: s.name,
            code,
            summary: labelForCode(code),
          });
        } catch {
          /* ignore per-spot failures */
        }
      })
    );

    alerts.sort((a, b) => String(a.locationName).localeCompare(String(b.locationName)));
    const now = new Date().toISOString();
    cache = {
      alerts,
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
    updatedAt: cache.updatedAt,
  });
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
};
