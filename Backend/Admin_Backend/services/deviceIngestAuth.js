/**
 * LilyGo / field hardware → Admin ingest.
 * Optional env (set at least one in production):
 *   DEVICE_INGEST_SECRET   → header x-device-secret must match
 *   DEVICE_INGEST_API_KEY  → header x-api-key (or x-ingest-api-key) must match
 * If both are set, both headers must match.
 */
function assertDeviceIngestAllowed(req) {
  const apiKey = process.env.DEVICE_INGEST_API_KEY != null ? String(process.env.DEVICE_INGEST_API_KEY).trim() : "";
  const secret = process.env.DEVICE_INGEST_SECRET != null ? String(process.env.DEVICE_INGEST_SECRET).trim() : "";
  const gotKey = String(req.headers["x-api-key"] || req.headers["x-ingest-api-key"] || "").trim();
  const gotSecret = String(req.headers["x-device-secret"] || "").trim();
  if (apiKey) {
    if (!gotKey) {
      const e = new Error(
        "Missing x-api-key header (server has DEVICE_INGEST_API_KEY set — add the same value on the LilyGo as DEVICE_API_KEY / x-api-key)"
      );
      e.statusCode = 401;
      throw e;
    }
    if (gotKey !== apiKey) {
      const e = new Error("Invalid x-api-key (does not match DEVICE_INGEST_API_KEY)");
      e.statusCode = 401;
      throw e;
    }
  }
  if (secret) {
    if (!gotSecret) {
      const e = new Error(
        "Missing x-device-secret header (server has DEVICE_INGEST_SECRET set — add it on the LilyGo config)"
      );
      e.statusCode = 401;
      throw e;
    }
    if (gotSecret !== secret) {
      const e = new Error("Invalid x-device-secret (does not match DEVICE_INGEST_SECRET)");
      e.statusCode = 401;
      throw e;
    }
  }
}

/** Accept JSON { lat, lng } as aliases for ingestDeviceGps { latitude, longitude }. */
function normalizeHardwareLatLngBody(body) {
  const b = { ...(body || {}) };
  if (b.latitude === undefined && b.lat !== undefined) b.latitude = b.lat;
  if (b.longitude === undefined && b.lng !== undefined) b.longitude = b.lng;
  return b;
}

module.exports = { assertDeviceIngestAllowed, normalizeHardwareLatLngBody };
