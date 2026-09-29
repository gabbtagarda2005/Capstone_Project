const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");

/**
 * LILYGO device-status heartbeat — deliberately separate from position ingestion
 * (attendantGpsIngest.js). A device can be "cellular connected, no GNSS fix yet" (still in the
 * firmware's GNSS_WAIT_FIX state) and admins should be able to see that on the Fleet Sensors /
 * Bus Detail pages without it being conflated with an actual position update — this function has
 * NO publish/broadcast/ETA side effects, it only updates status fields on the bus's GpsLog row.
 *
 * @param {object} p
 * @param {string} p.busId
 * @param {string|null} [p.deviceId]
 * @param {boolean|null} [p.cellularConnected]
 * @param {boolean|null} [p.gpsFixAcquired]
 * @param {"ok"|"failed"|"unknown"|null} [p.telemetryStatus]
 * @param {"standby"|"active"|"failed"|null} [p.smsFallbackStatus]
 * @param {string|null} [p.network] wifi | 4g | sms | unknown
 * @param {number|null} [p.signalStrength]
 * @param {number|null} [p.voltage]
 */
async function ingestDeviceStatus(p) {
  const busId = p?.busId != null ? String(p.busId).trim() : "";
  if (!busId) {
    const e = new Error("busId is required");
    e.statusCode = 400;
    throw e;
  }
  const now = new Date();
  const set = { busId, lastGpsFixAt: undefined, lastTelemetryAt: undefined };

  if (p.deviceId != null) set.deviceId = String(p.deviceId).trim() || null;
  if (p.cellularConnected != null) set.cellularConnected = Boolean(p.cellularConnected);
  if (p.gpsFixAcquired != null) {
    set.gpsFixAcquired = Boolean(p.gpsFixAcquired);
    if (set.gpsFixAcquired) set.lastGpsFixAt = now;
  }
  if (p.telemetryStatus != null) {
    const ts = String(p.telemetryStatus);
    if (["ok", "failed", "unknown"].includes(ts)) {
      set.telemetryStatus = ts;
      if (ts === "ok") set.lastTelemetryAt = now;
    }
  }
  if (p.smsFallbackStatus != null) {
    const ss = String(p.smsFallbackStatus);
    if (["standby", "active", "failed"].includes(ss)) set.smsFallbackStatus = ss;
  }
  if (p.network != null) set.network = String(p.network);
  if (p.signalStrength != null && Number.isFinite(Number(p.signalStrength))) {
    set.signalStrength = Number(p.signalStrength);
  }
  if (p.voltage != null && Number.isFinite(Number(p.voltage))) {
    set.voltage = Number(p.voltage);
  }
  // Only include lastGpsFixAt/lastTelemetryAt in the write when actually set above — Mongoose
  // would otherwise write `undefined` fields as unset $set no-ops, which is harmless, but cleaner
  // to just omit them.
  if (set.lastGpsFixAt === undefined) delete set.lastGpsFixAt;
  if (set.lastTelemetryAt === undefined) delete set.lastTelemetryAt;

  await GpsLog.findOneAndUpdate({ busId }, { $set: set }, { upsert: true, setDefaultsOnInsert: true });
  await Bus.updateOne({ busId }, { lastSeenAt: now }).catch(() => {});

  return { busId, ok: true };
}

module.exports = { ingestDeviceStatus };
