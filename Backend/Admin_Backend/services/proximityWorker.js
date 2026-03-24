/**
 * Periodically evaluates buses against geofences (geofences / geofence_events collections).
 * Expand to load Geofence model and write geofence_events; call notifyBusProximity on entry.
 */
function startProximityWorker(io) {
  const intervalMs = Number(process.env.PROXIMITY_TICK_MS) || 15_000;

  const timer = setInterval(() => {
    void io;
    // Placeholder: query latest GpsLog + geofences, emit anomalies / proximity
  }, intervalMs);

  return () => clearInterval(timer);
}

module.exports = { startProximityWorker };
