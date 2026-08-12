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

module.exports = { YMD_RE, isValidYmd, manilaDayStartUtc, manilaDayEndUtc, manilaTodayYmd, addDaysYmd };
