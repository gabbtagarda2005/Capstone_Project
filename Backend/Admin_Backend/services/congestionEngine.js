/**
 * TrafficProvider → TrafficService abstraction (see SECURITY.md-style doc note: this is the
 * congestion/heat computation layer, kept separate from any one provider so the app isn't
 * permanently tied to OSRM — swap getCorridorFreeFlowProfile's data source here if a paid
 * traffic API is ever added, without touching callers).
 *
 * congestionRatio = 1 - (currentSpeedKph / freeFlowSpeedKph), clamped [0, 1]. freeFlowSpeedKph is
 * OSRM's routed duration/distance for the bus's assigned corridor (see corridorGeometry.js) — a
 * real, driving-condition-based reference, never a guessed constant. currentSpeedKph is the bus's
 * own most recent reported speed. Never fabricated: if the corridor or OSRM data is unavailable,
 * this reports "unavailable" rather than inventing a value.
 */
const Bus = require("../models/Bus");
const { matchCorridorForBus, isNearAnyTerminal } = require("./freeEtaEngine");
const { getCorridorFreeFlowProfile } = require("./corridorGeometry");
const { getOsrmDiagnostics, ENABLE_OSRM } = require("./osrmTrafficService");
const { matchPointToSegment } = require("./corridorSegments");
const { computeSegmentCongestion } = require("./segmentTrafficStats");
const { computeConfidence } = require("./trafficConfidence");
const { CONGESTION_LEVELS, classifyRatio } = require("./congestionLevels");

/**
 * @returns {Promise<{
 *   status: "ok"|"not_applicable"|"unavailable",
 *   level?: string,
 *   congestionRatio?: number,
 *   currentKph?: number,
 *   freeFlowKph?: number,
 *   freeFlowSource?: "fleet_calibrated"|"osrm_static",
 *   corridorName?: string|null,
 *   reason?: string,
 * }>}
 */
async function computeBusCongestion({ busId, latitude, longitude, speedKph }) {
  if (!ENABLE_OSRM) {
    return { status: "unavailable", reason: "Traffic provider disabled (ENABLE_OSRM=false)" };
  }
  const speed = Number(speedKph);
  if (!Number.isFinite(speed) || speed < 0) {
    return { status: "unavailable", reason: "No current speed reading" };
  }

  // Dwelling at a terminal/stop is not congestion — don't misclassify a parked bus as SEVERE.
  if (Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))) {
    const nearTerminal = await isNearAnyTerminal(Number(latitude), Number(longitude)).catch(() => false);
    if (nearTerminal) return { status: "not_applicable", reason: "Bus is at/near a terminal" };
  }

  // A single GPS+speed reading can't tell "gridlocked" apart from "parked/idle off-route" — this
  // system has no ignition/engine-state signal to disambiguate. Near-zero speed is at least as
  // consistent with "not currently driving" as with "stuck in traffic", so don't claim SEVERE
  // congestion (an alarming, specific claim) for a fully stopped bus without that evidence.
  if (speed < 2) {
    return { status: "not_applicable", reason: "Bus is stationary (parked/idle or awaiting dispatch)" };
  }

  const corridor = await matchCorridorForBus(busId).catch(() => null);
  if (!corridor) {
    return { status: "unavailable", reason: "No assigned corridor for this bus's route" };
  }

  // Prefer real segment-level stats (median of recent observations on this exact road piece,
  // services/segmentTrafficStats.js) over the old single-point "this one speed reading vs. the
  // whole corridor's free-flow number" method. Falls back to that corridor-wide method below when
  // the bus isn't matched to any segment (e.g. corridor has no intermediate stops yet) — never
  // a behavior regression, just a weaker signal when segmentation isn't available.
  const match = await matchPointToSegment(corridor, Number(latitude), Number(longitude)).catch(() => null);
  if (match) {
    const segResult = await computeSegmentCongestion(match.segment.segmentId, corridor).catch(() => null);
    if (segResult && segResult.status === "ok") {
      return {
        status: "ok",
        level: segResult.level,
        congestionRatio: segResult.congestionRatio,
        currentKph: segResult.currentKph,
        freeFlowKph: segResult.referenceKph,
        freeFlowSource: segResult.referenceSource,
        corridorName: corridor.displayName || null,
        // Additive fields — new consumers only, existing ones ignore unknown keys.
        segmentId: segResult.segmentId,
        sampleCount: segResult.sampleCount,
        lastObservationAt: segResult.lastObservationAt,
        confidence: segResult.confidence,
      };
    }
    if (segResult && segResult.status === "insufficient_data") {
      // Genuinely not enough recent samples on this exact segment yet — honest, not an error.
      // Falls through to the corridor-wide single-point method below as a weaker-but-real signal.
    }
  }

  const profile = await getCorridorFreeFlowProfile(corridor).catch(() => null);
  if (!profile) {
    const diag = getOsrmDiagnostics();
    return {
      status: "unavailable",
      reason: diag.online === false ? "Traffic provider offline" : "Corridor geometry unavailable",
    };
  }

  const ratio = Math.max(0, Math.min(1, 1 - speed / profile.freeFlowKph));
  return {
    status: "ok",
    level: classifyRatio(ratio),
    congestionRatio: Math.round(ratio * 100) / 100,
    currentKph: Math.round(speed * 10) / 10,
    freeFlowKph: Math.round(profile.freeFlowKph * 10) / 10,
    freeFlowSource: profile.source || "osrm_static",
    corridorName: corridor.displayName || null,
    sampleCount: 1,
    confidence: computeConfidence({ sampleCount: 1, method: profile.source }),
  };
}

/** Command Center diagnostic summary — real counters, not simulated. */
async function getCongestionEngineDiagnostics() {
  const osrm = getOsrmDiagnostics();
  const activeBuses = await Bus.countDocuments({ status: { $ne: "Inactive" } }).catch(() => null);
  return { trafficProvider: osrm, activeBuses };
}

module.exports = { computeBusCongestion, getCongestionEngineDiagnostics, CONGESTION_LEVELS };
