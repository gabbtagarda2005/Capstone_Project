const SecurityLog = require("../models/SecurityLog");
const { broadcastCommandAlert } = require("../sockets/socket");

/** Limit DB rows & socket noise while a bus stays above the limit (km/h). */
const LOG_INTERVAL_MS = 60_000;
const ALERT_INTERVAL_MS = 25_000;
const SPEED_LIMIT_KPH = 80;

const lastLogAt = new Map();
const lastAlertAt = new Map();

/**
 * When GPS speed exceeds threshold: persist SecurityLog (throttled) + commandAlert for admin UI.
 */
async function maybeRecordSpeedViolation(io, ctx) {
  const {
    busId,
    speedKph,
    latitude,
    longitude,
    attendantName = null,
    assignedRoute = null,
  } = ctx || {};
  const bid = busId != null ? String(busId).trim() : "";
  const sp = speedKph != null ? Number(speedKph) : NaN;
  if (!bid || !Number.isFinite(sp) || sp <= SPEED_LIMIT_KPH) return;

  const la = Number(latitude);
  const ln = Number(longitude);
  const now = Date.now();
  const iso = new Date().toISOString();

  let doc = null;
  const prevLog = lastLogAt.get(bid) ?? 0;
  if (now - prevLog >= LOG_INTERVAL_MS) {
    lastLogAt.set(bid, now);
    try {
      doc = await SecurityLog.create({
        type: "speed_violation",
        busId: bid,
        message: `Speed ${sp.toFixed(1)} km/h exceeds ${SPEED_LIMIT_KPH} km/h limit`,
        severity: "critical",
        latitude: Number.isFinite(la) ? la : null,
        longitude: Number.isFinite(ln) ? ln : null,
        assignedRoute: assignedRoute != null ? String(assignedRoute) : null,
        source: "attendant_gps",
        attendantDisplayName: attendantName != null ? String(attendantName) : null,
      });
    } catch (e) {
      console.warn("[speedViolation] SecurityLog.create:", e.message || e);
    }
  }

  const prevAlert = lastAlertAt.get(bid) ?? 0;
  if (now - prevAlert >= ALERT_INTERVAL_MS && io) {
    lastAlertAt.set(bid, now);
    broadcastCommandAlert(io, {
      kind: "speed_violation",
      id: doc ? String(doc._id) : `spd-${bid}-${now}`,
      busId: bid,
      speedKph: sp,
      latitude: Number.isFinite(la) ? la : null,
      longitude: Number.isFinite(ln) ? ln : null,
      attendantName: attendantName != null ? String(attendantName) : null,
      message: `SPEED ALERT: ${bid} is traveling at ${Math.round(sp)} km/h`,
      createdAt: iso,
    });
  }
}

module.exports = { maybeRecordSpeedViolation, SPEED_LIMIT_KPH };
