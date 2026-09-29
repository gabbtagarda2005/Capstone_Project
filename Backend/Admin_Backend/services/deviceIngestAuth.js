const { verifyDeviceCredential } = require("./deviceRegistry");

/**
 * Legacy fleet-wide shared secret. Kept for devices not yet migrated to a per-device credential.
 * Optional env (set at least one in production if you rely on this path):
 *   DEVICE_INGEST_SECRET   → header x-device-secret (or query ?device_secret=) must match
 *   DEVICE_INGEST_API_KEY  → header x-api-key/x-ingest-api-key (or query ?api_key=) must match
 * If both are set, both must match.
 *
 * Query-string fallback exists because some field modems' AT+HTTP engines cannot set arbitrary
 * custom headers at all (confirmed on a real LilyGO T-A7670E: AT+HTTPPARA="USERDATA",... errors
 * unconditionally on that firmware build, A011B07A7670M7_F — see hardware/lilygo_ta7670e_cellular_telemetry),
 * while AT+HTTPPARA="URL",... always works. A query param is not as clean as a header, but it's the
 * only auth channel guaranteed available to every modem's AT+HTTP engine regardless of firmware quirks.
 */
function assertSharedSecretAllowed(req) {
  const apiKey = process.env.DEVICE_INGEST_API_KEY != null ? String(process.env.DEVICE_INGEST_API_KEY).trim() : "";
  const secret = process.env.DEVICE_INGEST_SECRET != null ? String(process.env.DEVICE_INGEST_SECRET).trim() : "";
  const gotKey = String(req.headers["x-api-key"] || req.headers["x-ingest-api-key"] || req.query?.api_key || "").trim();
  const gotSecret = String(req.headers["x-device-secret"] || req.query?.device_secret || "").trim();
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
  const deviceId = String(req.headers["x-device-id"] || req.query?.device_id || "").trim();
  const deviceKey = String(req.headers["x-device-key"] || req.query?.device_key || "").trim();
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
