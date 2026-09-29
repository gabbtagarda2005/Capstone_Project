const express = require("express");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const { createDevice, listDevices, revokeDevice, updateDeviceSmsSender } = require("../services/deviceRegistry");
const { SMS_GPS_INTERVAL_MS } = require("../config/gpsThresholds");

function classifyVoltage(v) {
  if (!Number.isFinite(v)) return { level: "unknown", label: "Unknown" };
  if (v < 4.6) return { level: "critical", label: "Critical" };
  if (v < 4.9) return { level: "warn", label: "Low" };
  return { level: "safe", label: "Safe" };
}

function classifyLte(sigDbm) {
  if (!Number.isFinite(sigDbm)) return { level: "unknown", label: "Unknown" };
  if (sigDbm < -110) return { level: "critical", label: "Very weak" };
  if (sigDbm < -100) return { level: "warn", label: "Weak" };
  if (sigDbm < -90) return { level: "ok", label: "Fair" };
  return { level: "good", label: "Strong" };
}

/** Attendant app tiers → approximate dBm for the same bar meter as LTE hardware. */
function staffSignalTierToDbm(signalEnum) {
  const s = String(signalEnum || "").trim().toLowerCase();
  if (s === "strong") return -82;
  if (s === "weak") return -100;
  if (s === "offline") return -118;
  return null;
}

function resolveActiveLinkAndSignal(source, lg, voltage, signalStrength, hardwareRecordedAt, signalEnum) {
  const src = String(source || "staff").toLowerCase();
  const now = Date.now();
  const hwMs = hardwareRecordedAt ? new Date(hardwareRecordedAt).getTime() : 0;
  const recentHardware =
    Number.isFinite(hwMs) && hwMs > 0 && now - hwMs < 15 * 60 * 1000 && src === "hardware";

  if (src === "hardware_sms") {
    return { activeLink: "sms", effectiveDbm: null };
  }
  if (src !== "hardware") {
    const dbm = signalStrength != null && Number.isFinite(Number(signalStrength)) ? Number(signalStrength) : staffSignalTierToDbm(signalEnum);
    return { activeLink: "staff", effectiveDbm: dbm };
  }

  const n = String(lg?.network || "")
    .trim()
    .toLowerCase();
  if (n === "wifi" || n === "wlan" || n.includes("wifi")) {
    return { activeLink: "wifi", effectiveDbm: signalStrength };
  }
  if (
    n === "4g" ||
    n === "lte" ||
    n === "5g" ||
    n === "3g" ||
    n === "gsm" ||
    n === "cell" ||
    n === "cellular" ||
    n === "mobile" ||
    n.includes("lte") ||
    n.includes("4g") ||
    n.includes("5g")
  ) {
    return { activeLink: "lte", effectiveDbm: signalStrength };
  }
  if (recentHardware && (voltage != null || (signalStrength != null && Number.isFinite(signalStrength)))) {
    return { activeLink: "lte", effectiveDbm: signalStrength, inferredUplink: true };
  }
  return { activeLink: "unknown", effectiveDbm: signalStrength, inferredUplink: false };
}

function createFleetHardwareRouter() {
  const router = express.Router();

  router.get("/hardware-status", async (_req, res) => {
    try {
      const [buses, logs] = await Promise.all([
        Bus.find().select("busId busNumber route driverId").populate("driverId", "firstName lastName").lean(),
        GpsLog.find()
          .select(
            "busId source network signal signalStrength voltage hardwareRecordedAt recordedAt attendantRecordedAt " +
              "deviceId smsFallbackStatus lastSmsAt cellularConnected gpsFixAcquired telemetryStatus"
          )
          .lean(),
      ]);
      const logByBus = new Map(logs.map((l) => [String(l.busId), l]));
      const now = Date.now();
      const items = buses
        .map((b) => {
          const bid = String(b.busId);
          const lg = logByBus.get(bid);
          const source = lg?.source != null ? String(lg.source) : "staff";
          const signalStrengthRaw =
            lg?.signalStrength != null && Number.isFinite(Number(lg.signalStrength)) ? Number(lg.signalStrength) : null;
          const voltage = lg?.voltage != null && Number.isFinite(Number(lg.voltage)) ? Number(lg.voltage) : null;
          const { activeLink, effectiveDbm, inferredUplink } = resolveActiveLinkAndSignal(
            source,
            lg,
            voltage,
            signalStrengthRaw,
            lg?.hardwareRecordedAt,
            lg?.signal
          );
          const lastSeenRaw = lg?.hardwareRecordedAt ?? lg?.recordedAt ?? lg?.attendantRecordedAt ?? null;
          const lastSeenIso = lastSeenRaw ? new Date(lastSeenRaw).toISOString() : null;
          const lastSeenMs = lastSeenRaw ? new Date(lastSeenRaw).getTime() : 0;
          const staleSec = Number.isFinite(lastSeenMs) && lastSeenMs > 0 ? Math.max(0, Math.floor((now - lastSeenMs) / 1000)) : null;
          const vCls = classifyVoltage(voltage != null ? voltage : Number.NaN);
          const sCls = classifyLte(effectiveDbm != null ? effectiveDbm : Number.NaN);
          const alertRedPulse =
            (effectiveDbm != null && effectiveDbm < -110) || (voltage != null && voltage < 4.6) || String(lg?.signal || "").toLowerCase() === "offline";
          const driverName =
            b.driverId && typeof b.driverId === "object"
              ? `${String(b.driverId.firstName || "").trim()} ${String(b.driverId.lastName || "").trim()}`.trim() || null
              : null;
          const lastSmsAtIso = lg?.lastSmsAt ? new Date(lg.lastSmsAt).toISOString() : null;
          const nextSmsExpectedAt =
            lg?.smsFallbackStatus === "active" && lg?.lastSmsAt
              ? new Date(new Date(lg.lastSmsAt).getTime() + SMS_GPS_INTERVAL_MS).toISOString()
              : null;
          return {
            busId: bid,
            busNumber: b.busNumber || bid,
            route: b.route || null,
            source,
            activeLink,
            uplinkInferred: Boolean(inferredUplink),
            signalStrengthDbm: effectiveDbm,
            signalLevel: sCls.level,
            signalLabel: sCls.label,
            voltage,
            voltageLevel: vCls.level,
            voltageLabel: vCls.label,
            alertRedPulse,
            lastSeenAt: lastSeenIso,
            staleSeconds: staleSec,
            driverName,
            attendantSignalTier: source !== "hardware" && source !== "hardware_sms" && lg?.signal != null ? String(lg.signal) : null,
            deviceId: lg?.deviceId != null ? String(lg.deviceId) : null,
            smsFallbackStatus: lg?.smsFallbackStatus != null ? String(lg.smsFallbackStatus) : null,
            lastSmsAt: lastSmsAtIso,
            nextSmsExpectedAt,
            cellularConnected: lg?.cellularConnected != null ? Boolean(lg.cellularConnected) : null,
            gpsFixAcquired: lg?.gpsFixAcquired != null ? Boolean(lg.gpsFixAcquired) : null,
            telemetryStatus: lg?.telemetryStatus != null ? String(lg.telemetryStatus) : null,
          };
        })
        .sort((a, b) => a.busId.localeCompare(b.busId));
      res.json({ items, generatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to read hardware telemetry" });
    }
  });

  /**
   * Per-device LILYGO credentials (see services/deviceRegistry.js + SECURITY.md). Mounted under
   * /api/fleet, already gated by requireAdminJwt at the app level.
   */
  router.get("/devices", async (_req, res) => {
    try {
      const items = await listDevices();
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to list devices" });
    }
  });

  /** Returns the plaintext secret ONCE — the caller must copy it into the device's config now.
   *  smsSenderNumber (E.164, this device's own SIM) is optional — set it here or later via PATCH
   *  to authorize this device to report GPS via SMS fallback (see services/smsGpsReceiver.js). */
  router.post("/devices", async (req, res) => {
    try {
      const { deviceId, busId, label, smsSenderNumber } = req.body || {};
      const result = await createDevice({ deviceId, busId, label, smsSenderNumber });
      res.status(201).json(result);
    } catch (e) {
      const code = e.statusCode || 500;
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message || "Failed to create device" });
    }
  });

  /** Set/clear a registered device's SMS-fallback sender number (E.164). Pass smsSenderNumber:
   *  null to clear it (disallows SMS-fallback GPS from this device until set again). */
  router.patch("/devices/:deviceId", async (req, res) => {
    try {
      const { smsSenderNumber } = req.body || {};
      const result = await updateDeviceSmsSender(req.params.deviceId, smsSenderNumber);
      res.json(result);
    } catch (e) {
      const code = e.statusCode || 500;
      res.status(code >= 400 && code < 600 ? code : 500).json({ error: e.message || "Failed to update device" });
    }
  });

  router.post("/devices/:deviceId/revoke", async (req, res) => {
    try {
      const found = await revokeDevice(req.params.deviceId);
      if (!found) return res.status(404).json({ error: "Device not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to revoke device" });
    }
  });

  return router;
}

module.exports = { createFleetHardwareRouter };

