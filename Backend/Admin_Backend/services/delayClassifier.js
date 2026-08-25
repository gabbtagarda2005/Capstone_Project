/**
 * Turns a bus's GPS freshness + congestion reading into a delay tier and an honestly-scoped
 * reason. Never labels a delay "traffic" unless the congestion engine actually measured HEAVY/
 * SEVERE congestion for that bus's corridor; otherwise reports "Delay reason unavailable" rather
 * than guessing. Never computes a delay from a stale/offline GPS fix.
 */

/** delayMinutes tiers — documented, not hidden. */
function tierFromDelayMinutes(delayMinutes) {
  if (delayMinutes <= 2) return "ON_TIME";
  if (delayMinutes <= 5) return "MINOR_DELAY";
  if (delayMinutes <= 10) return "MODERATE_DELAY";
  return "MAJOR_DELAY";
}

/**
 * @param {object} args
 * @param {"live"|"recent"|"stale"|"offline"} args.gpsFreshness
 * @param {number|null} args.etaMinutes - remaining-trip ETA (free-flow-leaning; see freeEtaEngine).
 * @param {object|null} args.congestion - result of congestionEngine.computeBusCongestion().
 * @returns {{ tier: string, delayMinutes: number|null, reason: string|null, congestionLevel: string|null }}
 */
function classifyDelay({ gpsFreshness, etaMinutes, congestion }) {
  if (gpsFreshness === "stale" || gpsFreshness === "offline") {
    return { tier: "GPS_STALE", delayMinutes: null, reason: null, congestionLevel: null };
  }

  if (!congestion || congestion.status === "not_applicable") {
    // At/near a terminal — dwelling isn't a traffic delay.
    return { tier: "ON_TIME", delayMinutes: 0, reason: null, congestionLevel: null };
  }

  if (congestion.status !== "ok") {
    return { tier: "UNKNOWN", delayMinutes: null, reason: "Delay reason unavailable", congestionLevel: null };
  }

  // If current speed is `freeFlowKph * (1 - ratio)`, time-for-remaining-distance scales by
  // 1/(1-ratio) versus the free-flow ETA — the added minutes are the delay this congestion is
  // causing. Cap the ratio used here so a near-zero speed reading doesn't blow this up to an
  // absurd number; the congestion *level* (SEVERE) still communicates the severity honestly.
  const ratio = Math.min(0.9, Math.max(0, Number(congestion.congestionRatio) || 0));
  const etaMin = Number(etaMinutes);
  const delayMinutes =
    Number.isFinite(etaMin) && ratio > 0 ? Math.max(0, Math.round((etaMin * ratio) / (1 - ratio))) : 0;

  const tier = tierFromDelayMinutes(delayMinutes);
  let reason = null;
  if (tier !== "ON_TIME") {
    reason = congestion.level === "HEAVY" || congestion.level === "SEVERE" ? "Heavy traffic" : "Delay reason unavailable";
  }
  return { tier, delayMinutes, reason, congestionLevel: congestion.level };
}

module.exports = { classifyDelay, tierFromDelayMinutes };
