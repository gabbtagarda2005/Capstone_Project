/**
 * Asia/Manila (fixed UTC+8, no DST) day-boundary helpers, shared wherever a YYYY-MM-DD from the
 * UI needs to become an unambiguous UTC instant range — an explicit "+08:00" offset makes this
 * correct regardless of the server's own timezone, unlike `new Date(ymd + "T00:00:00")`, which
 * is interpreted in the server's local time.
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s) {
  return typeof s === "string" && YMD_RE.test(s);
}

function manilaDayStartUtc(ymd) {
  return new Date(`${ymd}T00:00:00+08:00`);
}

function manilaDayEndUtc(ymd) {
  return new Date(`${ymd}T23:59:59.999+08:00`);
}

function manilaTodayYmd() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Minutes since midnight, Asia/Manila local time, for the current instant — used to compare
 *  against a schedule's "HH:MM" scheduledDeparture without a timezone library. */
function manilaNowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh * 60 + mm;
}

/** Parses a "HH:MM" schedule string into minutes-since-midnight, or null if malformed. */
function parseHmToMinutes(raw) {
  const s = raw == null ? "" : String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

module.exports = {
  YMD_RE,
  isValidYmd,
  manilaDayStartUtc,
  manilaDayEndUtc,
  manilaTodayYmd,
  addDaysYmd,
  manilaNowMinutes,
  parseHmToMinutes,
};
