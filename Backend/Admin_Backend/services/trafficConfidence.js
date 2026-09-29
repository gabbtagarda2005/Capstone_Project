/**
 * Shared confidence scoring — every traffic/delay/ETA result reuses this so the same bus never
 * shows HIGH confidence in one place and UNKNOWN in another. Never returns HIGH without real,
 * fresh, sufficiently-sampled data; degrades honestly instead of faking certainty.
 *
 * Factors considered (documented, not hidden): sample count, GPS freshness, which reference-speed
 * method was used (a segment's own calibration is stronger evidence than a corridor-wide or OSRM
 * fallback), and how old the most recent observation is.
 */

const HIGH_MIN_SAMPLES = 8;
const MEDIUM_MIN_SAMPLES = 3;
const OBSERVATION_STALE_MS = 10 * 60 * 1000; // 10 minutes — beyond this, even a real sample is old news

const STRONG_METHODS = new Set(["segment_calibrated", "segment_own", "gps_derived"]);
const MEDIUM_METHODS = new Set(["corridor_calibrated", "historical"]);

/**
 * @param {object} args
 * @param {number} args.sampleCount - observations backing this reading.
 * @param {"live"|"recent"|"stale"|"offline"|null} [args.gpsFreshness] - the subject bus's own GPS freshness, if relevant.
 * @param {string|null} [args.method] - "segment_calibrated"|"segment_own"|"gps_derived"|"corridor_calibrated"|"historical"|"osrm_static"|null.
 * @param {number|null} [args.observationAgeMs] - age of the most recent contributing observation.
 * @returns {"HIGH"|"MEDIUM"|"LOW"|"UNKNOWN"}
 */
function computeConfidence({ sampleCount, gpsFreshness = null, method = null, observationAgeMs = null } = {}) {
  const samples = Number(sampleCount) || 0;
  if (samples <= 0) return "UNKNOWN";

  const freshnessOk = gpsFreshness == null || gpsFreshness === "live" || gpsFreshness === "recent";
  const observationFresh = observationAgeMs == null || observationAgeMs <= OBSERVATION_STALE_MS;

  if (
    samples >= HIGH_MIN_SAMPLES &&
    freshnessOk &&
    observationFresh &&
    (method == null || STRONG_METHODS.has(method))
  ) {
    return "HIGH";
  }

  if (
    samples >= MEDIUM_MIN_SAMPLES &&
    observationFresh &&
    (method == null || STRONG_METHODS.has(method) || MEDIUM_METHODS.has(method))
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

module.exports = { computeConfidence, HIGH_MIN_SAMPLES, MEDIUM_MIN_SAMPLES, OBSERVATION_STALE_MS };
