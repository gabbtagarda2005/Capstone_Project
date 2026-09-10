/**
 * Reconstructs completed one-way trips between two terminals from a time-ordered GPS breadcrumb
 * trail. Used only for offline backtesting (scripts/backtestDelayAccuracy.js) — there is no live
 * "trip boundary" concept elsewhere in this app, so this is inferred after the fact from real
 * GpsHistory records rather than tracked at ingest time.
 *
 * A trip is counted when the bus leaves one terminal's geofence and later enters the other
 * terminal's geofence, with no gap between consecutive breadcrumbs bigger than `maxGapMinutes`
 * along the way. A big mid-trip gap (device offline, end of shift, etc.) makes the elapsed time
 * meaningless as a travel-time sample, so that attempt is discarded rather than counted — this
 * keeps the backtest's "actual" travel times honest instead of occasionally including a multi-hour
 * gap as if it were real driving time.
 */
const { haversineMeters } = require("./corridorGeometry");

/**
 * @param {Array<{latitude:number, longitude:number, recordedAt:string|Date}>} breadcrumbs
 * @param {{latitude:number, longitude:number, geofenceRadiusM?:number}} terminalA
 * @param {{latitude:number, longitude:number, geofenceRadiusM?:number}} terminalB
 * @param {{maxGapMinutes?:number, minTripMinutes?:number, maxTripMinutes?:number}} [opts]
 * @returns {Array<{direction:"A_to_B"|"B_to_A", startAt:Date, endAt:Date, actualMinutes:number}>}
 */
function segmentTripsFromBreadcrumbs(breadcrumbs, terminalA, terminalB, opts = {}) {
  const maxGapMinutes = opts.maxGapMinutes ?? 120;
  const minTripMinutes = opts.minTripMinutes ?? 3;
  const maxTripMinutes = opts.maxTripMinutes ?? 240;
  const radiusA = terminalA.geofenceRadiusM || 500;
  const radiusB = terminalB.geofenceRadiusM || 500;

  const sorted = [...breadcrumbs]
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.recordedAt)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const nearA = (p) => haversineMeters(p, terminalA) <= radiusA;
  const nearB = (p) => haversineMeters(p, terminalB) <= radiusB;

  const trips = [];
  let state = null; // "atA" | "atB" | "traveling"
  let direction = null; // "A_to_B" | "B_to_A"
  let tripStart = null;
  let lastTs = null;

  for (const p of sorted) {
    const ts = new Date(p.recordedAt);
    if (lastTs && state === "traveling" && (ts - lastTs) / 60000 > maxGapMinutes) {
      state = null;
      tripStart = null;
      direction = null;
    }
    lastTs = ts;

    const isA = nearA(p);
    const isB = nearB(p);
    if (isA && isB) continue; // ambiguous (overlapping geofences) — skip this point

    if (state === null) {
      if (isA) state = "atA";
      else if (isB) state = "atB";
      continue;
    }

    if (state === "atA") {
      if (!isA) {
        state = "traveling";
        direction = "A_to_B";
        tripStart = ts;
      }
      continue;
    }

    if (state === "atB") {
      if (!isB) {
        state = "traveling";
        direction = "B_to_A";
        tripStart = ts;
      }
      continue;
    }

    // state === "traveling"
    const arrived = direction === "A_to_B" ? isB : isA;
    if (arrived) {
      const actualMinutes = (ts - tripStart) / 60000;
      if (actualMinutes >= minTripMinutes && actualMinutes <= maxTripMinutes) {
        trips.push({ direction, startAt: tripStart, endAt: ts, actualMinutes });
      }
      state = direction === "A_to_B" ? "atB" : "atA";
      tripStart = null;
      direction = null;
      continue;
    }
    const backAtOrigin = direction === "A_to_B" ? isA : isB;
    if (backAtOrigin) {
      // U-turn / aborted departure — didn't actually complete a trip, don't record one.
      state = direction === "A_to_B" ? "atA" : "atB";
      tripStart = null;
      direction = null;
    }
  }

  return trips;
}

module.exports = { segmentTripsFromBreadcrumbs };
