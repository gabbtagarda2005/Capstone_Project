const SecurityLog = require("../models/SecurityLog");

/**
 * Anti-spoofing / anti-replay: a city bus implying >MAX_PLAUSIBLE_KPH between two consecutive
 * fixes from the SAME source (hardware vs hardware, phone vs phone) is not a real movement —
 * it's a bad fix, a spoofed coordinate, or a replayed/duplicated packet. Reject it from becoming
 * the published live position, but never throw: a lookup/math problem must never block a
 * legitimate GPS update from reaching the map.
 */
const MAX_PLAUSIBLE_KPH = 180;
const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 7200;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * @returns {Promise<{outlier: boolean, impliedKph: number|null}>}
 */
async function checkGpsOutlier({ busId, source, lat, lng, recordedAtMs, prevLat, prevLng, prevRecordedAtMs }) {
  try {
    if (!Number.isFinite(prevLat) || !Number.isFinite(prevLng) || !prevRecordedAtMs) {
      return { outlier: false, impliedKph: null };
    }
    const dtSec = (recordedAtMs - prevRecordedAtMs) / 1000;
    if (!Number.isFinite(dtSec) || dtSec < MIN_INTERVAL_SEC || dtSec > MAX_INTERVAL_SEC) {
      return { outlier: false, impliedKph: null };
    }
    const meters = haversineMeters(prevLat, prevLng, lat, lng);
    const kph = (meters / dtSec) * 3.6;
    if (!Number.isFinite(kph)) return { outlier: false, impliedKph: null };
    if (kph > MAX_PLAUSIBLE_KPH) {
      SecurityLog.create({
        type: "gps_outlier",
        busId: String(busId || "UNKNOWN"),
        message: `Rejected ${source} fix: implied speed ${kph.toFixed(0)} km/h over ${dtSec.toFixed(1)}s exceeds ${MAX_PLAUSIBLE_KPH} km/h plausibility limit`,
        severity: "warning",
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
        source: source === "hardware" ? "lilygo_outlier" : "attendant_outlier",
      }).catch(() => {});
      return { outlier: true, impliedKph: kph };
    }
    return { outlier: false, impliedKph: kph };
  } catch {
    return { outlier: false, impliedKph: null };
  }
}

module.exports = { checkGpsOutlier, haversineMeters, MAX_PLAUSIBLE_KPH };
