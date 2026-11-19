const {
  PHONE_GPS_STALE_TIMEOUT_MS,
  PHONE_GPS_RECOVERY_REQUIRED_UPDATES,
  HARDWARE_MOBILE_TIMEOUT_MS,
  GPS_OFFLINE_THRESHOLD_MS,
  GPS_FIX_MAX_AGE_MS,
  SMS_FIX_MAX_AGE_MS,
  SMS_GPS_INTERVAL_MS,
} = require("../config/gpsThresholds");

/**
 * Per-bus GPS source arbitration across three tiers, in strict preference order:
 *   phone (attendant app, primary, ~3s) > lilygo (LILYGO mobile data, backup, ~5s) >
 *   lilygo_sms (LILYGO SMS fallback, ~8s — only when BOTH phone and LILYGO mobile data are quiet).
 *
 * Rules (all times are server-clock ms unless named fixMs):
 * - Health is based on the server ARRIVAL time of the last VALID, FRESH fix from each source —
 *   "is this source currently delivering usable coordinates", not "is it connected".
 *   A fix is FRESH when its GPS collection time (fixMs) is no older than GPS_FIX_MAX_AGE_MS
 *   (SMS_FIX_MAX_AGE_MS for SMS). Replayed/buffered/outbox fixes are therefore stored by the caller
 *   but never published as live and never make a source look healthy.
 * - Phone is stale after PHONE_GPS_STALE_TIMEOUT_MS without a valid fresh phone fix. The next
 *   valid hardware fix then takes over immediately (no waiting for the phone to come back).
 * - Failback to phone needs PHONE_GPS_RECOVERY_REQUIRED_UPDATES consecutive valid fresh phone
 *   fixes, each arriving within PHONE_GPS_STALE_TIMEOUT_MS of the previous one with strictly
 *   increasing GPS time. Hardware pings interleaved between them do NOT break the streak (the old
 *   version reset it on every hardware ping, so with phone@3s + hardware@5s the phone could
 *   essentially never win back). An invalid/outlier/stale phone fix or a gap does break it.
 * - Monotonic publish guard: a fix is never published if its GPS time is not newer than the last
 *   published fix for that bus, across ALL sources — an older hardware/SMS/phone fix can never
 *   overwrite a newer one, and exact duplicates are never re-published.
 *
 * In-memory, single Node process (same as other per-bus state maps in this service). A restart
 * re-bootstraps from the next pings (ctx values seed phone/hardware health for the first call).
 */
const stateByBus = new Map();
const MAX_SWITCH_HISTORY = 20;
/** Phone clocks can run ahead; never let a phone timestamp claim to be newer than its arrival. */
const FUTURE_SKEW_CAP_MS = 2_000;

let switchListener = null;
/** Register a callback(busId, switchEvent) — used by the ingest service to log transitions. */
function onSourceSwitch(fn) {
  switchListener = typeof fn === "function" ? fn : null;
}

function getState(busId) {
  let s = stateByBus.get(busId);
  if (!s) {
    s = {
      activeSource: null,
      /** server arrival ms of the last valid+fresh fix per source */
      lastValidArrivalMs: { phone: null, lilygo: null, lilygo_sms: null },
      /** GPS collection ms of the last valid fix per source (for status display) */
      lastValidFixMs: { phone: null, lilygo: null, lilygo_sms: null },
      lastPublishedFixMs: null,
      lastPublishedSource: null,
      lastPublishedArrivalMs: null,
      recovery: { count: 0, lastArrivalMs: null, lastFixMs: null },
      lastSwitch: null,
      switches: [],
    };
    stateByBus.set(busId, s);
  }
  return s;
}

/** Returns null (not 0) when unavailable — 0 is a real epoch value and must not mean "never". */
function toMs(d) {
  if (d == null) return null;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

function maxAgeFor(source) {
  return source === "lilygo_sms" ? SMS_FIX_MAX_AGE_MS : GPS_FIX_MAX_AGE_MS;
}

function recordSwitch(busId, state, to, reason, nowMs) {
  const from = state.activeSource;
  state.activeSource = to;
  if (from === to) return null;
  const evt = { from, to, reason, atMs: nowMs, at: new Date(nowMs).toISOString() };
  state.lastSwitch = evt;
  state.switches.unshift(evt);
  if (state.switches.length > MAX_SWITCH_HISTORY) state.switches.length = MAX_SWITCH_HISTORY;
  if (switchListener) {
    try {
      switchListener(busId, evt);
    } catch {
      /* logging must never break ingest */
    }
  }
  return evt;
}

function isPhoneHealthy(state, nowMs, ctx) {
  const last = state.lastValidArrivalMs.phone != null ? state.lastValidArrivalMs.phone : toMs(ctx?.phoneLastRecordedAt);
  return last != null && nowMs - last < PHONE_GPS_STALE_TIMEOUT_MS;
}

function isHwMobileHealthy(state, nowMs, ctx) {
  const last =
    state.lastValidArrivalMs.lilygo != null ? state.lastValidArrivalMs.lilygo : toMs(ctx?.hardwareMobileLastRecordedAt);
  return last != null && nowMs - last < HARDWARE_MOBILE_TIMEOUT_MS;
}

/**
 * @param {string} busId
 * @param {"phone"|"lilygo"|"lilygo_sms"} incomingSource
 * @param {{fixMs?: number, nowMs?: number, valid?: boolean, ctx?: object}} [opts]
 *   fixMs — GPS collection time of this fix (already clamped by resolveRecordedAtFromClientTimestamp);
 *   nowMs — server arrival time (default Date.now());
 *   valid — false when the caller already rejected the fix (e.g. gpsOutlierGuard jump);
 *   ctx   — cold-start bootstrap {phoneLastRecordedAt, hardwareMobileLastRecordedAt} (first call
 *           after a restart only; ignored once this process has seen that source).
 * @returns {{ shouldPublish: boolean, activeSource: "phone"|"lilygo"|"lilygo_sms"|null, reason: string, switched: object|null }}
 */
function decideActiveSource(busId, incomingSource, opts = {}) {
  const bid = String(busId);
  const state = getState(bid);
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  let fixMs = Number.isFinite(opts.fixMs) ? opts.fixMs : nowMs;
  if (fixMs > nowMs + FUTURE_SKEW_CAP_MS) fixMs = nowMs; // clock ahead → treat as "now"
  const valid = opts.valid !== false;
  const ctx = opts.ctx || {};
  const fresh = valid && nowMs - fixMs <= maxAgeFor(incomingSource);

  const result = (shouldPublish, reason, switched = null) => {
    if (shouldPublish) {
      state.lastPublishedFixMs = fixMs;
      state.lastPublishedSource = incomingSource;
      state.lastPublishedArrivalMs = nowMs;
    }
    return { shouldPublish, activeSource: state.activeSource, reason, switched };
  };

  if (!fresh) {
    if (incomingSource === "phone") state.recovery = { count: 0, lastArrivalMs: null, lastFixMs: null };
    return result(false, valid ? "stale_fix" : "invalid_fix");
  }

  state.lastValidArrivalMs[incomingSource] = nowMs;
  state.lastValidFixMs[incomingSource] = Math.max(state.lastValidFixMs[incomingSource] ?? 0, fixMs);
  const newerThanPublished = state.lastPublishedFixMs == null || fixMs > state.lastPublishedFixMs;

  if (incomingSource === "phone") {
    const onBackup = state.activeSource === "lilygo" || state.activeSource === "lilygo_sms";
    if (onBackup) {
      const r = state.recovery;
      const continues =
        r.lastArrivalMs != null && nowMs - r.lastArrivalMs <= PHONE_GPS_STALE_TIMEOUT_MS && fixMs > r.lastFixMs;
      r.count = continues ? r.count + 1 : 1;
      r.lastArrivalMs = nowMs;
      r.lastFixMs = fixMs;
      if (r.count < PHONE_GPS_RECOVERY_REQUIRED_UPDATES) {
        return result(false, `phone_recovering_${r.count}_of_${PHONE_GPS_RECOVERY_REQUIRED_UPDATES}`);
      }
      state.recovery = { count: 0, lastArrivalMs: null, lastFixMs: null };
      const sw = recordSwitch(
        bid,
        state,
        "phone",
        `phone recovered: ${PHONE_GPS_RECOVERY_REQUIRED_UPDATES} consecutive fresh valid updates`,
        nowMs
      );
      return result(newerThanPublished, newerThanPublished ? "phone_recovered" : "older_than_published", sw);
    }
    const sw = state.activeSource == null ? recordSwitch(bid, state, "phone", "first valid phone fix", nowMs) : null;
    return result(newerThanPublished, newerThanPublished ? "phone_active" : "older_than_published", sw);
  }

  // While a LILYGO tier is the active source, the phone has NOT taken over yet even if it is
  // mid-recovery-streak (its pings refresh its health) — so the backup keeps publishing until the
  // phone actually wins, instead of the map freezing for the whole recovery window.
  const phoneOwnsBus = state.activeSource === "phone" || state.activeSource == null;

  if (incomingSource === "lilygo") {
    if (phoneOwnsBus && isPhoneHealthy(state, nowMs, ctx)) {
      // Phone is primary and healthy — hardware is a standby; caller still stores hardware* fields.
      if (state.activeSource == null) state.activeSource = "phone";
      return result(false, "standby_phone_healthy");
    }
    let sw = null;
    if (state.activeSource !== "lilygo") {
      const phoneLast = state.lastValidArrivalMs.phone;
      const why =
        state.activeSource === "lilygo_sms"
          ? "LILYGO mobile data restored"
          : phoneLast != null
            ? `phone GPS stale (${Math.round((nowMs - phoneLast) / 1000)}s since last valid phone fix)`
            : "no phone GPS available";
      sw = recordSwitch(bid, state, "lilygo", why, nowMs);
    }
    return result(newerThanPublished, newerThanPublished ? "hardware_active" : "older_than_published", sw);
  }

  // incomingSource === "lilygo_sms"
  if (phoneOwnsBus && isPhoneHealthy(state, nowMs, ctx)) {
    if (state.activeSource == null) state.activeSource = "phone";
    return result(false, "standby_phone_healthy");
  }
  if (isHwMobileHealthy(state, nowMs, ctx)) {
    // Mobile data strictly preferred over SMS at race boundaries (late SMS after data resumed).
    return result(false, "standby_hw_mobile_healthy");
  }
  let sw = null;
  if (state.activeSource !== "lilygo_sms") {
    sw = recordSwitch(bid, state, "lilygo_sms", "phone GPS and LILYGO mobile data both stale", nowMs);
  }
  return result(newerThanPublished, newerThanPublished ? "sms_active" : "older_than_published", sw);
}

function getActiveSource(busId) {
  return stateByBus.get(String(busId))?.activeSource ?? null;
}

/** Ops/testing hook — drop in-memory state for a bus. */
function clearBusState(busId) {
  stateByBus.delete(String(busId));
}

const SOURCE_LABEL = { phone: "Bus Attendant Phone", lilygo: "LILYGO Mobile Data", lilygo_sms: "LILYGO SMS" };

/**
 * Read-only status snapshot for the admin dashboard. Status is derived from real ingest state:
 *   ACTIVE     — phone is the active source and healthy
 *   FALLBACK   — LILYGO (data or SMS) is active and still delivering within its window
 *   RECOVERING — LILYGO is active and the phone has a recovery streak in progress
 *   STALE      — the active source has stopped delivering valid fixes
 *   NO_SIGNAL  — nothing valid received for this bus since the server started
 */
function getSourceStatus(busId, nowMs = Date.now()) {
  const s = stateByBus.get(String(busId));
  if (!s || s.activeSource == null) {
    return { activeSource: null, activeSourceLabel: null, status: "NO_SIGNAL", lastSwitch: null, recentSwitches: [] };
  }
  const ageOf = (src) => (s.lastValidArrivalMs[src] != null ? nowMs - s.lastValidArrivalMs[src] : null);
  const windowFor = (src) =>
    src === "phone" ? PHONE_GPS_STALE_TIMEOUT_MS : src === "lilygo" ? HARDWARE_MOBILE_TIMEOUT_MS : SMS_GPS_INTERVAL_MS * 4;
  const activeAge = ageOf(s.activeSource);
  const activeHealthy = activeAge != null && activeAge < windowFor(s.activeSource);
  const recoveringNow =
    s.activeSource !== "phone" &&
    s.recovery.count > 0 &&
    s.recovery.lastArrivalMs != null &&
    nowMs - s.recovery.lastArrivalMs <= PHONE_GPS_STALE_TIMEOUT_MS;
  let status;
  if (s.activeSource === "phone") status = activeHealthy ? "ACTIVE" : "STALE";
  else if (recoveringNow) status = "RECOVERING";
  else status = activeHealthy ? "FALLBACK" : "STALE";

  const perSource = {};
  for (const src of ["phone", "lilygo", "lilygo_sms"]) {
    perSource[src] = {
      lastValidFixAt: s.lastValidFixMs[src] != null ? new Date(s.lastValidFixMs[src]).toISOString() : null,
      lastValidReceivedAt: s.lastValidArrivalMs[src] != null ? new Date(s.lastValidArrivalMs[src]).toISOString() : null,
      msSinceLastValid: ageOf(src),
    };
  }
  return {
    activeSource: s.activeSource,
    activeSourceLabel: SOURCE_LABEL[s.activeSource] || null,
    status,
    lastPublishedFixAt: s.lastPublishedFixMs != null ? new Date(s.lastPublishedFixMs).toISOString() : null,
    msSinceLastPublished: s.lastPublishedArrivalMs != null ? nowMs - s.lastPublishedArrivalMs : null,
    phoneRecovery: { count: s.recovery.count, required: PHONE_GPS_RECOVERY_REQUIRED_UPDATES },
    perSource,
    lastSwitch: s.lastSwitch,
    recentSwitches: s.switches.slice(0, 10),
    thresholds: {
      phoneStaleTimeoutMs: PHONE_GPS_STALE_TIMEOUT_MS,
      hardwareMobileTimeoutMs: HARDWARE_MOBILE_TIMEOUT_MS,
      phoneRecoveryRequiredUpdates: PHONE_GPS_RECOVERY_REQUIRED_UPDATES,
    },
  };
}

function listBusIds() {
  return Array.from(stateByBus.keys());
}

/**
 * Maps a persisted GpsLog.source + "ms since last published fix" into the UPPER_SNAKE contract
 * exposed to clients (GET /api/buses/live, the canonical bus:location:update socket event).
 * @returns {"STAFF"|"HARDWARE_MOBILE"|"HARDWARE_SMS"|"NO_SIGNAL"}
 */
function deriveGpsSourceState(source, ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs > GPS_OFFLINE_THRESHOLD_MS) return "NO_SIGNAL";
  if (source === "staff") return "STAFF";
  if (source === "hardware") return "HARDWARE_MOBILE";
  if (source === "hardware_sms") return "HARDWARE_SMS";
  return "NO_SIGNAL";
}

module.exports = {
  decideActiveSource,
  getActiveSource,
  clearBusState,
  deriveGpsSourceState,
  getSourceStatus,
  listBusIds,
  onSourceSwitch,
};
