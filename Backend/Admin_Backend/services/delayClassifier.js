/**
 * Turns a bus's real progress — schedule vs. actual position along its corridor — plus its GPS
 * freshness into a delay tier and an honestly-scoped reason. This used to reapply the congestion
 * engine's ratio to the (already weather-adjusted) ETA, which double-counted the same real-world
 * slowdown twice. Rewritten to the spec's actual method: compare how far along the corridor the
 * bus SHOULD be by now (schedule + corridor free-flow duration) against how far it REALLY is
 * (GPS position projected onto the corridor polyline) — independent of the ETA number entirely.
 *
 * Never computes a delay from a stale/offline GPS fix. Never flags a legitimate stop (terminal or
 * a known route stop, per existing geofence data) as a delay. Never labels a delay "traffic"
 * unless the congestion engine actually measured HEAVY/SEVERE for this bus right now; otherwise
 * reports "Behind schedule" or "Delay reason unavailable" rather than guessing.
 */
const liveDispatchStore = require("./liveDispatchStore");
const { manilaNowMinutes, parseHmToMinutes } = require("./manilaTime");
const { matchCorridorForBus, isNearAnyTerminal } = require("./freeEtaEngine");
const { getCorridorPolyline, getCorridorFreeFlowProfile, progressAlongPolyline } = require("./corridorGeometry");

/** Below this speed, and not at a known stop/terminal, the bus is genuinely not moving — distinct
 *  from a schedule-lag delay. Confirmed over a short window so one noisy near-zero GPS reading
 *  doesn't flip the tier (mirrors the confirm-window pattern already used for the separate
 *  slow-bus dispatch heuristic in attendantGpsIngest.js). */
const STOPPED_SPEED_KPH = 2;
const STOPPED_CONFIRM_MS = 2 * 60_000;
const stoppedSinceByBus = new Map();

/** delayMinutes tiers — documented, not hidden. Negative means the bus is ahead of schedule. */
function tierFromDelayMinutes(delayMinutes) {
  if (delayMinutes < -2) return "EARLY";
  if (delayMinutes <= 2) return "ON_TIME";
  if (delayMinutes <= 5) return "MINOR_DELAY";
  if (delayMinutes <= 10) return "MODERATE_DELAY";
  return "SEVERE_DELAY";
}

function findScheduledDepartureMinutes(busId) {
  const blocks = liveDispatchStore.listBlocks();
  const row = blocks.find((b) => String(b.busId || "").trim() === String(busId) && b.status !== "cancelled");
  if (!row) return null;
  return parseHmToMinutes(row.scheduledDeparture);
}

/**
 * @param {object} args
 * @param {string} args.busId
 * @param {"live"|"recent"|"stale"|"offline"} args.gpsFreshness
 * @param {number} args.latitude
 * @param {number} args.longitude
 * @param {number|null} args.speedKph
 * @param {object|null} args.congestion - result of congestionEngine.computeBusCongestion(); used only for the reason text, never re-multiplied into the delay math.
 * @returns {Promise<{ tier: string, delayMinutes: number|null, reason: string|null, congestionLevel: string|null }>}
 */
async function classifyDelay({ busId, gpsFreshness, latitude, longitude, speedKph, congestion }) {
  const bid = String(busId || "");

  if (gpsFreshness === "stale" || gpsFreshness === "offline") {
    stoppedSinceByBus.delete(bid);
    return { tier: "GPS_STALE", delayMinutes: null, reason: null, congestionLevel: null };
  }

  const lat = Number(latitude);
  const lon = Number(longitude);
  const nearStop = Number.isFinite(lat) && Number.isFinite(lon)
    ? await isNearAnyTerminal(lat, lon).catch(() => false)
    : false;

  if (nearStop) {
    // Dwelling at a terminal/known stop isn't a traffic delay.
    stoppedSinceByBus.delete(bid);
    return { tier: "ON_TIME", delayMinutes: 0, reason: null, congestionLevel: null };
  }

  const speed = Number(speedKph);
  const nowMs = Date.now();
  const isStoppedNow = Number.isFinite(speed) && speed < STOPPED_SPEED_KPH;
  if (isStoppedNow) {
    const prev = stoppedSinceByBus.get(bid);
    const startedAt = prev?.startedAt || nowMs;
    stoppedSinceByBus.set(bid, { startedAt });
    if (nowMs - startedAt >= STOPPED_CONFIRM_MS) {
      return { tier: "STOPPED", delayMinutes: null, reason: null, congestionLevel: congestion?.level || null };
    }
  } else {
    stoppedSinceByBus.delete(bid);
  }

  const corridor = await matchCorridorForBus(bid).catch(() => null);
  const scheduledDepartureMinutes = findScheduledDepartureMinutes(bid);
  if (!corridor || scheduledDepartureMinutes == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { tier: "UNKNOWN", delayMinutes: null, reason: "Delay reason unavailable", congestionLevel: congestion?.level || null };
  }

  const [polyline, profile] = await Promise.all([
    getCorridorPolyline(corridor).catch(() => null),
    getCorridorFreeFlowProfile(corridor).catch(() => null),
  ]);
  if (!polyline || !profile || !profile.durationSeconds) {
    return { tier: "UNKNOWN", delayMinutes: null, reason: "Delay reason unavailable", congestionLevel: congestion?.level || null };
  }

  const progress = progressAlongPolyline(lat, lon, polyline);
  if (!progress) {
    return { tier: "UNKNOWN", delayMinutes: null, reason: "Delay reason unavailable", congestionLevel: congestion?.level || null };
  }

  const corridorFreeFlowDurationMinutes = profile.durationSeconds / 60;
  const elapsedMinutes = manilaNowMinutes() - scheduledDepartureMinutes;
  // Clamp: a trip that hasn't scheduled-departed yet, or a stale/day-wrapped schedule row,
  // shouldn't produce a nonsensical multi-hour "delay" from a day-boundary artifact. 1.5x the
  // corridor's own free-flow duration is already a severe, real delay — no need to go further.
  const expectedProgressRatio =
    corridorFreeFlowDurationMinutes > 0
      ? Math.max(0, Math.min(1.5, elapsedMinutes / corridorFreeFlowDurationMinutes))
      : 0;
  const actualProgressRatio = progress.progressRatio;

  const delayMinutes = Math.round((expectedProgressRatio - actualProgressRatio) * corridorFreeFlowDurationMinutes);
  const tier = tierFromDelayMinutes(delayMinutes);

  let reason = null;
  if (tier === "MINOR_DELAY" || tier === "MODERATE_DELAY" || tier === "SEVERE_DELAY") {
    reason = congestion?.level === "HEAVY" || congestion?.level === "SEVERE" ? "Heavy traffic" : "Behind schedule";
  }

  return { tier, delayMinutes, reason, congestionLevel: congestion?.level || null };
}

module.exports = { classifyDelay, tierFromDelayMinutes };
