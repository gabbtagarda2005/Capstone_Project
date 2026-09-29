/**
 * Shared GPS validation helpers used by every ingestion entrypoint (attendant phone, LILYGO
 * mobile-data HTTPS, LILYGO SMS fallback) — extracted from attendantGpsIngest.js so the new SMS
 * path (smsGpsReceiver.js) validates coordinates/timestamps identically instead of re-implementing
 * the same checks with a second, possibly-drifting definition.
 */

/** Reject NaN, out-of-range, and the (0,0) "no fix" sentinel some GPS stacks send instead of omitting. */
function isValidGpsCoordinate(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return false;
  if (Math.abs(la) < 1e-6 && Math.abs(lo) < 1e-6) return false;
  return true;
}

/**
 * Clamp a client-supplied timestamp (attendant clientRecordedAt, LILYGO GNSS-derived recordedAt,
 * SMS gateway modemTimestamp-derived recordedAt, ...) to a sane window around "now" — a wildly
 * future or stale-by-days value is more likely a clock/parse problem than a real fix time.
 */
function resolveRecordedAtFromClientTimestamp(raw) {
  if (raw == null) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date();
  const now = Date.now();
  if (d.getTime() > now + 90_000) return new Date();
  if (d.getTime() < now - 7 * 86400_000) return new Date();
  return d;
}

module.exports = { isValidGpsCoordinate, resolveRecordedAtFromClientTimestamp };
