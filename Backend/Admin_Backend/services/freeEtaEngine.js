const Bus = require("../models/Bus");
const CorridorRoute = require("../models/CorridorRoute");
const RouteCoverage = require("../models/RouteCoverage");

function toRad(v) {
  return (Number(v) * Math.PI) / 180;
}

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

function getFreeEtaMinutes(lat1, lon1, lat2, lon2, speedKph) {
  const baseDistance = haversineKm(lat1, lon1, lat2, lon2);
  if (baseDistance <= 0.08) return 1;
  const bufferedDistance = baseDistance * 1.18;
  const speed = Number(speedKph);
  // Clamp noisy GPS speed spikes to keep ETA stable/realistic.
  const effectiveSpeed = Number.isFinite(speed) && speed > 5 ? Math.min(70, Math.max(18, speed)) : 35;
  const etaHours = bufferedDistance / effectiveSpeed;
  return Math.max(1, Math.round(etaHours * 60));
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
  resolveNextTerminalForBus,
  isNearAnyTerminal,
};

