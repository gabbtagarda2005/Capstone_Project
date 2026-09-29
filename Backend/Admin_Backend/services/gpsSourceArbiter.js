const {
  PHONE_GPS_TIMEOUT_MS,
  PHONE_FAILBACK_STABLE_COUNT,
  HARDWARE_MOBILE_TIMEOUT_MS,
  GPS_OFFLINE_THRESHOLD_MS,
} = require("../config/gpsThresholds");

/**
 * Per-bus GPS source arbitration across three tiers, in strict preference order:
 *   phone (attendant app, primary) > lilygo (LILYGO mobile-data/HTTPS, backup) >
 *   lilygo_sms (LILYGO SMS fallback, emergency-only — active only when BOTH phone and LILYGO
 *   mobile-data have gone quiet).
 *
 * The attendant's phone is always the preferred source; LILYGO is backup-only and must never
 * overwrite a newer, still-healthy phone fix (that exact "stale hardware pin overwrote a fresher
 * phone pin" bug is why an older fusion attempt was reverted in ingestDeviceGps — see the comment
 * there). This version fixes it with an explicit per-bus state machine instead of ad-hoc recency
 * checks, and extends the original two-way (phone/lilygo) version with a third "lilygo_sms" tier
 * using the same hysteresis/timeout mechanics.
 *
 * In-memory, single Node process — matches other per-bus state maps already used in this service
 * (e.g. slowStateByBus in attendantGpsIngest.js). Not persisted: a server restart just re-bootstraps
 * on the next ping from whichever source arrives first (using the ctx bootstrap values below for
 * one call), which is the correct behavior (no stale cross-restart failover state to reason about).
 */
const stateByBus = new Map();

function getState(busId) {
  let s = stateByBus.get(busId);
  if (!s) {
    s = { activeSource: null, phoneConsecutiveGood: 0, lastSeenMs: { phone: null, lilygo: null, lilygo_sms: null } };
    stateByBus.set(busId, s);
  }
  return s;
}

/** Returns null (not 0) when unavailable — 0 is a real, if practically-impossible, epoch
 *  millisecond value and must not be conflated with "never seen" (Date.now() is always a huge
 *  number in production; this only matters for correctness at the boundary, e.g. under test). */
function toMs(d) {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {string} busId
 * @param {"phone"|"lilygo"|"lilygo_sms"} incomingSource
 * @param {{phoneLastRecordedAt?: Date|string|null, hardwareMobileLastRecordedAt?: Date|string|null}} [ctx]
 *   Cold-start bootstrap only (e.g. read from GpsLog.attendantRecordedAt/hardwareRecordedAt on the
 *   very first call after a server restart). Once this bus has received at least one ping of a
 *   given source in this process's lifetime, the arbiter's own in-memory lastSeenMs for that
 *   source is used instead and ctx is ignored for it.
 * @param {number} nowMs
 * @returns {{ shouldPublish: boolean, activeSource: "phone"|"lilygo"|"lilygo_sms" }}
 */
function decideActiveSource(busId, incomingSource, ctx, nowMs) {
  const bid = String(busId);
  const state = getState(bid);
  const c = ctx || {};

  if (Object.prototype.hasOwnProperty.call(state.lastSeenMs, incomingSource)) {
    state.lastSeenMs[incomingSource] = nowMs;
  }

  const phoneLastMs = state.lastSeenMs.phone != null ? state.lastSeenMs.phone : toMs(c.phoneLastRecordedAt);
  const hwMobileLastMs = state.lastSeenMs.lilygo != null ? state.lastSeenMs.lilygo : toMs(c.hardwareMobileLastRecordedAt);
  const phoneHealthy = phoneLastMs != null && nowMs - phoneLastMs < PHONE_GPS_TIMEOUT_MS;
  const hwMobileHealthy = hwMobileLastMs != null && nowMs - hwMobileLastMs < HARDWARE_MOBILE_TIMEOUT_MS;

  if (incomingSource === "phone") {
    state.phoneConsecutiveGood = Math.min(state.phoneConsecutiveGood + 1, PHONE_FAILBACK_STABLE_COUNT);
    // Recovering from LILYGO backup (mobile-data or SMS): require a short stabilization streak
    // before flipping back so a single lucky phone ping doesn't cause the map marker to flap.
    if (
      (state.activeSource === "lilygo" || state.activeSource === "lilygo_sms") &&
      state.phoneConsecutiveGood < PHONE_FAILBACK_STABLE_COUNT
    ) {
      return { shouldPublish: false, activeSource: state.activeSource };
    }
    state.activeSource = "phone";
    return { shouldPublish: true, activeSource: "phone" };
  }

  // Any non-phone ping resets the phone failback streak — a fresh consecutive run is required.
  state.phoneConsecutiveGood = 0;

  if (incomingSource === "lilygo") {
    if (phoneHealthy) {
      // Phone is primary and still healthy — record the hardware fix (caller still writes the
      // hardware* fields) but do not let it become the published/active location.
      return { shouldPublish: false, activeSource: "phone" };
    }
    state.activeSource = "lilygo";
    return { shouldPublish: true, activeSource: "lilygo" };
  }

  // incomingSource === "lilygo_sms"
  if (phoneHealthy) {
    return { shouldPublish: false, activeSource: "phone" };
  }
  if (hwMobileHealthy) {
    // Mobile-data is strictly preferred over SMS at any race boundary (e.g. a buffered/delayed SMS
    // arriving just after mobile-data telemetry has actually resumed) — never let a stale-by-the-
    // time-it-lands SMS fix override a fresher/healthier mobile-data one.
    return { shouldPublish: false, activeSource: "lilygo" };
  }
  state.activeSource = "lilygo_sms";
  return { shouldPublish: true, activeSource: "lilygo_sms" };
}

function getActiveSource(busId) {
  return stateByBus.get(String(busId))?.activeSource ?? null;
}

/** Ops/testing hook — drop in-memory state for a bus (e.g. after it's removed from the registry). */
function clearBusState(busId) {
  stateByBus.delete(String(busId));
}

/**
 * Maps a persisted GpsLog.source + "ms since last published fix" into the UPPER_SNAKE contract
 * exposed to clients (GET /api/buses/live, the canonical bus:location:update socket event). This
 * is a pure read-path helper — NO_SIGNAL is an absence, not something that ever arrives as a ping,
 * so it is derived here rather than being a value decideActiveSource() can return.
 * @param {"staff"|"hardware"|"hardware_sms"|string|null|undefined} source
 * @param {number|null} ageMs
 * @returns {"STAFF"|"HARDWARE_MOBILE"|"HARDWARE_SMS"|"NO_SIGNAL"}
 */
function deriveGpsSourceState(source, ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs > GPS_OFFLINE_THRESHOLD_MS) return "NO_SIGNAL";
  if (source === "staff") return "STAFF";
  if (source === "hardware") return "HARDWARE_MOBILE";
  if (source === "hardware_sms") return "HARDWARE_SMS";
  return "NO_SIGNAL";
}

module.exports = { decideActiveSource, getActiveSource, clearBusState, deriveGpsSourceState };
