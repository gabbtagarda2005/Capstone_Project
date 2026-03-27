/**
 * Twin-write: after MongoDB is the source of truth, mirror critical fleet/geo data
 * to Firebase Realtime Database for low-latency client/driver surfaces.
 */
const { getRealtimeDb } = require("../config/firebaseAdmin");

async function syncRouteCoverageToRtdb(doc) {
  const db = getRealtimeDb();
  if (!db || !doc?._id) return { skipped: true };

  const id = String(doc._id);
  const terminal = doc.terminal || {};
  const tLat = Number(terminal.latitude);
  const tLng = Number(terminal.longitude);
  const payload = {
    locationName: doc.locationName,
    pointType: doc.pointType === "stop" ? "stop" : "terminal",
    terminal: {
      name: terminal.name || "",
      lat: Number.isFinite(tLat) ? tLat : 0,
      lng: Number.isFinite(tLng) ? tLng : 0,
      geofenceRadiusM: Number(terminal.geofenceRadiusM) || 500,
      pickupOnly: terminal.pickupOnly !== false,
    },
    stops: (doc.stops || []).map((s) => ({
      name: s.name,
      sequence: s.sequence,
      lat: s.latitude,
      lng: s.longitude,
      geofenceRadiusM: s.geofenceRadiusM ?? 100,
      pickupOnly: s.pickupOnly !== false,
    })),
    updatedAt: Date.now(),
  };

  await db.ref(`live_map/coverage/${id}`).set(payload);
  return { ok: true };
}

async function syncCorridorRouteToRtdb(doc) {
  const db = getRealtimeDb();
  if (!db || !doc?._id) return { skipped: true };

  const id = String(doc._id);
  const stops = (doc.authorizedStops || []).map((s) => ({
    coverageId: String(s.coverageId),
    sequence: s.sequence,
    name: s.name,
    latitude: s.latitude,
    longitude: s.longitude,
    geofenceRadiusM: s.geofenceRadiusM ?? 100,
  }));
  const vias = (doc.viaCoverageIds || []).map((x) => String(x));
  await db.ref(`current_routes/${id}`).set({
    displayName: doc.displayName || "",
    originCoverageId: String(doc.originCoverageId),
    destinationCoverageId: String(doc.destinationCoverageId),
    viaCoverageIds: vias,
    authorizedStops: stops,
    updatedAt: Date.now(),
  });
  return { ok: true };
}

async function removeCorridorRouteFromRtdb(routeId) {
  const db = getRealtimeDb();
  if (!db) return { skipped: true };
  await db.ref(`current_routes/${String(routeId)}`).remove();
  return { ok: true };
}

async function removeRouteCoverageFromRtdb(coverageId) {
  const db = getRealtimeDb();
  if (!db) return { skipped: true };
  await db.ref(`live_map/coverage/${String(coverageId)}`).remove();
  return { ok: true };
}

module.exports = {
  syncRouteCoverageToRtdb,
  syncCorridorRouteToRtdb,
  removeCorridorRouteFromRtdb,
  removeRouteCoverageFromRtdb,
};
