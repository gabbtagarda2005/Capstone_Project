const { PHONE_GPS_TIMEOUT_MS, PHONE_FAILBACK_STABLE_COUNT } = require("../config/gpsThresholds");

/**
 * Per-bus GPS source arbitration: the attendant's phone is always the preferred (primary) GPS
 * source; the LILYGO hardware is backup-only and must never overwrite a newer, still-healthy
 * phone fix (that exact "stale hardware pin overwrote a fresher phone pin" bug is why an older
 * fusion attempt was reverted in ingestDeviceGps — see the comment there. This version fixes it
 * with an explicit per-bus state machine instead of ad-hoc recency checks).
 *
 * In-memory, single Node process — matches other per-bus state maps already used in this
 * service (e.g. slowStateByBus in attendantGpsIngest.js). Not persisted: a server restart just
 * re-bootstraps on the next ping from whichever source arrives first, which is the correct
 * behavior (no stale cross-restart failover state to reason about).
 */
const stateByBus = new Map();

function getState(busId) {
  let s = stateByBus.get(busId);
  if (!s) {
    s = { activeSource: null, phoneConsecutiveGood: 0 };
    stateByBus.set(busId, s);
  }
  return s;
}

/**
 * @param {string} busId
 * @param {"phone"|"lilygo"} incomingSource
 * @param {Date|string|null} phoneLastRecordedAt Last known phone fix time (GpsLog.attendantRecordedAt).
 *   Only consulted when incomingSource is "lilygo" — to decide if phone is still inside its timeout window.
 * @param {number} nowMs
 * @returns {{ shouldPublish: boolean, activeSource: "phone"|"lilygo" }}
 */
function decideActiveSource(busId, incomingSource, phoneLastRecordedAt, nowMs) {
  const bid = String(busId);
  const state = getState(bid);

  if (incomingSource === "phone") {
    state.phoneConsecutiveGood = Math.min(state.phoneConsecutiveGood + 1, PHONE_FAILBACK_STABLE_COUNT);
    // Recovering from LILYGO backup: require a short stabilization streak before flipping back
    // so a single lucky phone ping doesn't cause the map marker to flap between sources.
    if (state.activeSource === "lilygo" && state.phoneConsecutiveGood < PHONE_FAILBACK_STABLE_COUNT) {
      return { shouldPublish: false, activeSource: "lilygo" };
    }
    state.activeSource = "phone";
    return { shouldPublish: true, activeSource: "phone" };
  }

  // incomingSource === "lilygo"
  const phoneLastMs = phoneLastRecordedAt ? new Date(phoneLastRecordedAt).getTime() : 0;
  const phoneWithinTimeout = phoneLastMs > 0 && nowMs - phoneLastMs < PHONE_GPS_TIMEOUT_MS;
  if (phoneWithinTimeout) {
    // Phone is primary and still healthy — record the hardware fix (caller still writes the
    // hardware* fields) but do not let it become the published/active location.
    return { shouldPublish: false, activeSource: "phone" };
  }
  state.activeSource = "lilygo";
  state.phoneConsecutiveGood = 0; // require a fresh consecutive streak before the next failback
  return { shouldPublish: true, activeSource: "lilygo" };
}

function getActiveSource(busId) {
  return stateByBus.get(String(busId))?.activeSource ?? null;
}

/** Ops/testing hook — drop in-memory state for a bus (e.g. after it's removed from the registry). */
function clearBusState(busId) {
  stateByBus.delete(String(busId));
}

module.exports = { decideActiveSource, getActiveSource, clearBusState };
