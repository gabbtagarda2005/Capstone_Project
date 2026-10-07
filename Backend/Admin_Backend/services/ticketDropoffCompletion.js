const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const RouteCoverage = require("../models/RouteCoverage");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const { normalizeBusKey, effectiveSegmentStart } = require("./passengerFleetIntel");
const { buildPublicPayload } = require("../routes/liveDispatch");
const { broadcastLiveBoard } = require("../sockets/socket");

/**
 * Per-ticket passenger drop-off detection: when a bus's live GPS enters ANY registered terminal OR
 * stop geofence (not just the corridor's current final terminal — see autoRouteFlip.js for that
 * separate, final-endpoint-only concern), auto-complete "boarded" tickets whose destination is
 * exactly that point. This is what makes BOARDED counts drop at intermediate stops instead of only
 * at the end of the corridor.
 *
 * Destination matching uses the exact label the BusAttendant app builds at ticket issuance —
 * `${stop or terminal name} (${coverage doc's locationName})` — see
 * `ApiRouteCoverage.pickableStopChoices()` in
 * Frontend/BusAttendant_Frontend/lib/services/api_client.dart. A stop in one city and a
 * same-named stop/terminal in another never collide because the area suffix is part of the label,
 * so "Barangay Mailag (Valencia)" is never confused with "Valencia Integrated Transport Terminal
 * Complex, Poblacion (Valencia)" — they're different canonical labels even though both mention
 * Valencia.
 */

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function normalizeLabel(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

let pointsCache = { at: 0, points: [] };
const POINTS_CACHE_MS = 45_000;

/** Flat list of every registered terminal AND stop, each carrying the exact ticket-label format. */
async function loadDropoffPoints() {
  const now = Date.now();
  if (now - pointsCache.at < POINTS_CACHE_MS && pointsCache.points.length) return pointsCache.points;

  const docs = await RouteCoverage.find().select("locationName terminal stops").lean();
  const points = [];
  for (const doc of docs) {
    const area = String(doc.locationName || "").trim();
    const t = doc.terminal;
    if (t && t.name && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) {
      const label = `${String(t.name).trim()} (${area})`;
      const r = Number(t.geofenceRadiusM);
      points.push({
        normLabel: normalizeLabel(label),
        latitude: t.latitude,
        longitude: t.longitude,
        radiusM: Number.isFinite(r) && r >= 50 ? r : 500,
      });
    }
    for (const s of doc.stops || []) {
      if (!s || !s.name || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
      const label = `${String(s.name).trim()} (${area})`;
      const r = Number(s.geofenceRadiusM);
      points.push({
        normLabel: normalizeLabel(label),
        latitude: s.latitude,
        longitude: s.longitude,
        radiusM: Number.isFinite(r) && r >= 10 ? r : 100,
      });
    }
  }
  pointsCache = { at: now, points };
  return points;
}

/**
 * @returns {Promise<{ completed: number }>}
 */
async function completeTicketsAtArrivedStops(io, busId, lat, lng) {
  if (mongoose.connection.readyState !== 1) return { completed: 0 };
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { completed: 0 };
  const bid = String(busId || "").trim();
  if (!bid) return { completed: 0 };

  let points;
  try {
    points = await loadDropoffPoints();
  } catch (e) {
    console.warn("[ticket-dropoff] load points failed:", e.message);
    return { completed: 0 };
  }
  if (!points.length) return { completed: 0 };

  const hitLabels = new Set();
  for (const p of points) {
    if (haversineMeters(la, ln, p.latitude, p.longitude) <= p.radiusM) hitLabels.add(p.normLabel);
  }
  if (!hitLabels.size) return { completed: 0 };

  const bus = await Bus.findOne({ busId: bid }).select("busId busNumber tripSegmentStartedAt").lean();
  if (!bus) return { completed: 0 };
  const bKey = normalizeBusKey(bus.busNumber || bus.busId);
  if (!bKey) return { completed: 0 };

  // Only the CURRENT trip/leg's boarded tickets are eligible — the same boundary the public
  // occupancy count already uses, so a ticket from a previous leg (or an old out-of-scope ticket
  // whose destination string happens to match a currently-hit stop) can never be swept up here.
  const segmentStart = effectiveSegmentStart(bus.tripSegmentStartedAt);

  // Small working set (a bus's currently-boarded tickets) — filtering bus key / destination /
  // segment boundary in JS mirrors the exact pattern enrichPublicFleetBuses() already uses, rather
  // than introducing a second, possibly-diverging Mongo query shape for the same data.
  const candidates = await IssuedTicketRecord.find({
    boardingStatus: "boarded",
    createdAt: { $gte: segmentStart },
  })
    .select("_id busNumber destination destinationLocation")
    .lean();

  const toCompleteIds = [];
  for (const t of candidates) {
    if (normalizeBusKey(t.busNumber) !== bKey) continue;
    const destNorm = normalizeLabel(t.destination || t.destinationLocation || "");
    if (destNorm && hitLabels.has(destNorm)) toCompleteIds.push(t._id);
  }
  if (!toCompleteIds.length) return { completed: 0 };

  // Atomic per-document test-and-set: only documents still "boarded" flip. If two GPS pings race
  // each other, the second update's filter matches zero of these already-"completed" ids — no
  // double-completion, no need for a separate dedup/lock.
  const result = await IssuedTicketRecord.updateMany(
    { _id: { $in: toCompleteIds }, boardingStatus: "boarded" },
    { $set: { boardingStatus: "completed" } }
  );
  const completed = result.modifiedCount || 0;

  if (completed > 0 && io) {
    try {
      const payload = await buildPublicPayload();
      broadcastLiveBoard(io, payload);
    } catch (e) {
      console.warn("[ticket-dropoff] broadcast live board failed:", e.message);
    }
  }

  return { completed };
}

module.exports = { completeTicketsAtArrivedStops };
