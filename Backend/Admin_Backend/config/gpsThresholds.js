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

/** How long the phone (primary GPS) can go silent before LILYGO is allowed to take over. */
const PHONE_GPS_TIMEOUT_MS = envMs("PHONE_GPS_TIMEOUT_MS", 10_000);

/** Consecutive valid phone updates required before failing back from LILYGO to phone (anti-flap). */
const PHONE_FAILBACK_STABLE_COUNT = envInt("PHONE_FAILBACK_STABLE_COUNT", 3);

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
  PHONE_FAILBACK_STABLE_COUNT,
  GPS_ONLINE_THRESHOLD_MS,
  GPS_STALE_THRESHOLD_MS,
  GPS_OFFLINE_THRESHOLD_MS,
  gpsStatusFromAgeMs,
  GPS_LIVE_MAX_MS,
  GPS_RECENT_MAX_MS,
  GPS_STALE_MAX_MS,
  gpsFreshnessFromAgeMs,
};
