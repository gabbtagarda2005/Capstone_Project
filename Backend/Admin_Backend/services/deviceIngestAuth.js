const { verifyDeviceCredential } = require("./deviceRegistry");

/**
 * Legacy fleet-wide shared secret. Kept for devices not yet migrated to a per-device credential.
 * Optional env (set at least one in production if you rely on this path):
 *   DEVICE_INGEST_SECRET   → header x-device-secret must match
 *   DEVICE_INGEST_API_KEY  → header x-api-key (or x-ingest-api-key) must match
 * If both are set, both headers must match.
 */
function assertSharedSecretAllowed(req) {
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

/**
 * Authenticates a LILYGO/field-hardware ingest request. Prefers a per-device credential
 * (x-device-id + x-device-key headers, issued via services/deviceRegistry.js) when present —
 * that is the only mode where the reporting busId is server-verified from a registry rather than
 * trusted from the request body/IMEI lookup. Falls back to the fleet-wide shared secret for
 * devices not yet migrated to a per-device credential (see SECURITY.md for the migration note).
 * @returns {Promise<string|null>} the server-verified busId when a per-device credential was used
 *   (the caller should treat this as authoritative, overriding whatever busId/imei the body
 *   claimed); null when falling back to the legacy shared-secret path, meaning the caller keeps
 *   resolving busId from the request body/IMEI as before.
 */
async function authenticateDeviceIngest(req, claimedBusId) {
  const deviceId = String(req.headers["x-device-id"] || "").trim();
  const deviceKey = String(req.headers["x-device-key"] || "").trim();
  if (deviceId && deviceKey) {
    const result = await verifyDeviceCredential({ deviceId, secret: deviceKey, claimedBusId });
    if (!result.ok) {
      const e = new Error(`Device authentication failed: ${result.reason}`);
      e.statusCode = 401;
      throw e;
    }
    return result.busId;
  }
  assertSharedSecretAllowed(req);
  return null;
}

/** Accept JSON { lat, lng } as aliases for ingestDeviceGps { latitude, longitude }. */
function normalizeHardwareLatLngBody(body) {
  const b = { ...(body || {}) };
  if (b.latitude === undefined && b.lat !== undefined) b.latitude = b.lat;
  if (b.longitude === undefined && b.lng !== undefined) b.longitude = b.lng;
  return b;
}

module.exports = { authenticateDeviceIngest, normalizeHardwareLatLngBody };
