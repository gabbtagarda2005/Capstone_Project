/**
 * Shared congestion-ratio → tier mapping, used by both the per-bus congestion reading
 * (congestionEngine.js) and segment-level congestion (segmentTrafficStats.js). Kept in its own
 * module (not re-exported from congestionEngine.js) purely to avoid a require cycle between those
 * two files. congestionRatio = 1 - (currentSpeedKph / referenceSpeedKph), clamped [0, 1].
 */

/** Documented, not hidden magic numbers: below 0.15 the road is essentially moving at its
 *  reference free-flow speed. This is the exact enum the Admin frontend already renders
 *  (types.ts/LocationsPage.tsx) — do not rename these values. */
const CONGESTION_LEVELS = [
  { max: 0.15, level: "FREE_FLOW" },
  { max: 0.35, level: "MODERATE" },
  { max: 0.55, level: "SLOW" },
  { max: 0.75, level: "HEAVY" },
  { max: Infinity, level: "SEVERE" },
];

function classifyRatio(ratio) {
  for (const tier of CONGESTION_LEVELS) {
    if (ratio <= tier.max) return tier.level;
  }
  return "SEVERE";
}

module.exports = { CONGESTION_LEVELS, classifyRatio };
