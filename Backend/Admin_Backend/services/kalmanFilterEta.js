/**
 * Kalman Filter for ETA smoothing.
 * Prevents "flickering" ETA (jumping from 5 mins to 8 mins and back).
 * Uses optimal state estimation given measurements and process noise.
 */

class KalmanFilterETA {
  /**
   * @param {number} processNoise - Process noise (Q): how much the ETA can change naturally. Default ~1 min²
   * @param {number} measurementNoise - Measurement noise (R): GPS/speed uncertainty. Default ~2.5 min²
   * @param {number} initialEstimate - Starting ETA estimate in minutes
   */
  constructor(processNoise = 1, measurementNoise = 2.5, initialEstimate = 10) {
    this.Q = processNoise; // process noise covariance
    this.R = measurementNoise; // measurement noise covariance
    this.x = initialEstimate; // state (ETA in minutes)
    this.P = initialEstimate * 0.5; // initial error covariance
    this.lastUpdateMs = Date.now();
  }

  /**
   * Update filter with new ETA measurement.
   * Returns smoothed (filtered) ETA.
   */
  update(measuredEtaMinutes) {
    const now = Date.now();
    const dtSeconds = (now - this.lastUpdateMs) / 1000;
    this.lastUpdateMs = now;

    // Clamp to reasonable bounds
    const measurement = Math.max(0.5, Math.min(240, Number(measuredEtaMinutes) || 10));

    // Prediction step: ETA decreases naturally over time (bus gets closer)
    // Assume ETA decreases by ~1 minute per second of elapsed time (until very close)
    const dtMinutes = Math.min(dtSeconds / 60, 0.5); // cap at 0.5 min per update
    const predictedState = Math.max(0.5, this.x - dtMinutes);
    this.P = this.P + this.Q; // increase uncertainty (process noise)

    // Kalman gain: how much to trust the measurement vs prediction
    const K = this.P / (this.P + this.R);

    // Update step: blend prediction with measurement
    this.x = predictedState + K * (measurement - predictedState);
    this.P = (1 - K) * this.P;

    // Clamp final ETA to reasonable range
    return Math.max(1, Math.min(240, Math.round(this.x)));
  }

  /**
   * Get current smoothed ETA without updating.
   */
  getSmoothedEta() {
    return Math.max(1, Math.min(240, Math.round(this.x)));
  }

  /**
   * Reset filter to a new starting value.
   */
  reset(initialEstimate = 10) {
    this.x = initialEstimate;
    this.P = initialEstimate * 0.5;
    this.lastUpdateMs = Date.now();
  }
}

/**
 * Global ETA filter cache by busId.
 * Persists filters across multiple ETA calculations.
 */
const etaFiltersByBusId = new Map();
const FILTER_CACHE_TTL_MS = 3600000; // 1 hour
const FILTER_CLEANUP_INTERVAL_MS = 300000; // 5 minutes

// Periodic cleanup of old filters
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [busId, { lastAccessMs }] of etaFiltersByBusId) {
    if (now - lastAccessMs > FILTER_CACHE_TTL_MS) {
      etaFiltersByBusId.delete(busId);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[KalmanFilterETA] Cleaned up ${removed} expired filters`);
  }
}, FILTER_CLEANUP_INTERVAL_MS);

/**
 * Get or create a Kalman filter for a specific bus.
 * @param {string} busId - Bus identifier
 * @param {number} initialEta - Initial ETA if creating new filter (minutes)
 * @returns {KalmanFilterETA} Filter instance
 */
function getEtaFilter(busId, initialEta = 10) {
  const now = Date.now();
  let entry = etaFiltersByBusId.get(busId);

  if (!entry) {
    entry = {
      filter: new KalmanFilterETA(1.0, 2.5, initialEta),
      lastAccessMs: now,
    };
    etaFiltersByBusId.set(busId, entry);
  }

  entry.lastAccessMs = now;
  return entry.filter;
}

/**
 * Apply Kalman smoothing to a raw ETA value.
 * @param {string} busId - Bus identifier
 * @param {number} rawEtaMinutes - Raw calculated ETA
 * @returns {number} Smoothed ETA in minutes
 */
function smoothEtaWithKalman(busId, rawEtaMinutes) {
  const filter = getEtaFilter(busId, rawEtaMinutes);
  return filter.update(rawEtaMinutes);
}

/**
 * Reset ETA filter for a bus (e.g., when starting new trip).
 */
function resetEtaFilter(busId) {
  const entry = etaFiltersByBusId.get(busId);
  if (entry) {
    entry.filter.reset();
  }
}

module.exports = {
  KalmanFilterETA,
  getEtaFilter,
  smoothEtaWithKalman,
  resetEtaFilter,
};
