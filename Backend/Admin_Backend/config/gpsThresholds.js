/**
 * Configurable thresholds for the phone-primary / LILYGO-backup GPS failover system.
 * Every value is env-overridable so operators can tune cadence/timeouts without a code change.
 */

function envMs(name, fallbackMs) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** First env name that is set wins — lets the newer names coexist with the original ones. */
function envMsAny(names, fallbackMs) {
  for (const n of names) if (process.env[n] != null && process.env[n] !== "") return envMs(n, fallbackMs);
  return fallbackMs;
}
function envIntAny(names, fallback) {
  for (const n of names) if (process.env[n] != null && process.env[n] !== "") return envInt(n, fallback);
  return fallback;
}

/** How long the phone (primary GPS) can go without a VALID, FRESH fix before it is marked stale and
 *  LILYGO is allowed to take over. Phone cadence is 3s, so 10s ≈ three missed updates. Measured on
 *  server arrival time of the last accepted phone fix. Env: PHONE_GPS_STALE_TIMEOUT_MS (preferred)
 *  or the original PHONE_GPS_TIMEOUT_MS. */
const PHONE_GPS_TIMEOUT_MS = envMsAny(["PHONE_GPS_STALE_TIMEOUT_MS", "PHONE_GPS_TIMEOUT_MS"], 10_000);
const PHONE_GPS_STALE_TIMEOUT_MS = PHONE_GPS_TIMEOUT_MS;

/** Consecutive fresh, valid phone updates (each arriving within PHONE_GPS_STALE_TIMEOUT_MS of the
 *  previous one, with increasing GPS time) required before failing back from LILYGO to phone
 *  (anti-flap). Env: PHONE_GPS_RECOVERY_REQUIRED_UPDATES (preferred) or PHONE_FAILBACK_STABLE_COUNT. */
const PHONE_FAILBACK_STABLE_COUNT = envIntAny(
  ["PHONE_GPS_RECOVERY_REQUIRED_UPDATES", "PHONE_FAILBACK_STABLE_COUNT"],
  3
);
const PHONE_GPS_RECOVERY_REQUIRED_UPDATES = PHONE_FAILBACK_STABLE_COUNT;

/** A fix whose GPS collection time is older than this (vs server arrival) is stored but never
 *  published as the live position, and never counts toward source health — e.g. offline-outbox or
 *  ring-buffer replays. Phone + LILYGO mobile data. */
const GPS_FIX_MAX_AGE_MS = envMs("GPS_FIX_MAX_AGE_MS", 30_000);

/** Same, for SMS fixes — SMS delivery + gateway polling add real latency, so allow more. */
const SMS_FIX_MAX_AGE_MS = envMs("SMS_FIX_MAX_AGE_MS", 120_000);

/**
 * How long LILYGO mobile-data (HTTPS) telemetry can go silent before the SMS-fallback tier
 * ("hardware_sms") is allowed to become the published source. The device itself only starts
 * sending SMS after it has independently confirmed a few consecutive HTTPS failures (see the
 * lilygo_ta7670e_cellular_telemetry firmware's MOBILE_FAIL_CONFIRM_COUNT), so by the time an SMS
 * fix arrives this window has already elapsed on the backend side too — no separate counter needed.
 */
const HARDWARE_MOBILE_TIMEOUT_MS = envMs("HARDWARE_MOBILE_TIMEOUT_MS", 15_000);

/** Device-governed SMS send cadence while SMS fallback is active — echoed to clients via
 *  GET /api/buses/live (smsGpsIntervalMs) so the frontend never hardcodes "15 seconds". Not
 *  enforced backend-side; the LILYGO firmware paces its own sends. */
const SMS_GPS_INTERVAL_MS = envMs("SMS_GPS_INTERVAL_MS", 8_000);

/** Dashboard online/unstable/offline status thresholds, keyed off "ms since last published fix". */
const GPS_ONLINE_THRESHOLD_MS = envMs("GPS_ONLINE_THRESHOLD_MS", 10_000);
const GPS_STALE_THRESHOLD_MS = envMs("GPS_STALE_THRESHOLD_MS", 30_000);
const GPS_OFFLINE_THRESHOLD_MS = envMs("GPS_OFFLINE_THRESHOLD_MS", 60_000);

/**
 * Collapses the thresholds above into the three displayed states. GPS_STALE_THRESHOLD_MS is kept
 * as its own named, overridable constant (per spec) even though the discrete classifier only
 * needs two cut points — ONLINE and OFFLINE — to produce online / unstable / offline; any age at
 * or beyond STALE but under OFFLINE already reads as "unstable" here.
 */
function gpsStatusFromAgeMs(ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "offline";
  if (ageMs <= GPS_ONLINE_THRESHOLD_MS) return "online";
  if (ageMs <= GPS_OFFLINE_THRESHOLD_MS) return "unstable";
  return "offline";
}

/**
 * Single source of truth for GPS freshness — LIVE / RECENT / STALE / OFFLINE, keyed off "ms since
 * last published fix". Previously each frontend page (LocationsPage, BusDetailPage) re-derived its
 * own ad hoc staleness cutoff independently of this file and of each other; this is now the one
 * place that decides it, exposed to clients via GET /api/admin/gps-thresholds so the frontend never
 * has to hardcode a value that could drift out of sync with the backend.
 */
const GPS_LIVE_MAX_MS = envMs("GPS_LIVE_MAX_MS", 10_000);
const GPS_RECENT_MAX_MS = envMs("GPS_RECENT_MAX_MS", 30_000);
const GPS_STALE_MAX_MS = envMs("GPS_STALE_MAX_MS", 60_000);

function gpsFreshnessFromAgeMs(ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return "offline";
  if (ageMs <= GPS_LIVE_MAX_MS) return "live";
  if (ageMs <= GPS_RECENT_MAX_MS) return "recent";
  if (ageMs <= GPS_STALE_MAX_MS) return "stale";
  return "offline";
}

module.exports = {
  PHONE_GPS_TIMEOUT_MS,
  PHONE_GPS_STALE_TIMEOUT_MS,
  PHONE_FAILBACK_STABLE_COUNT,
  PHONE_GPS_RECOVERY_REQUIRED_UPDATES,
  GPS_FIX_MAX_AGE_MS,
  SMS_FIX_MAX_AGE_MS,
  HARDWARE_MOBILE_TIMEOUT_MS,
  SMS_GPS_INTERVAL_MS,
  GPS_ONLINE_THRESHOLD_MS,
  GPS_STALE_THRESHOLD_MS,
  GPS_OFFLINE_THRESHOLD_MS,
  gpsStatusFromAgeMs,
  GPS_LIVE_MAX_MS,
  GPS_RECENT_MAX_MS,
  GPS_STALE_MAX_MS,
  gpsFreshnessFromAgeMs,
};
