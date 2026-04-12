const express = require("express");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");

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

function createFleetHardwareRouter() {
  const router = express.Router();

  router.get("/hardware-status", async (_req, res) => {
    try {
      const [buses, logs] = await Promise.all([
        Bus.find().select("busId busNumber route driverId").populate("driverId", "firstName lastName").lean(),
        GpsLog.find().select("busId source network signalStrength voltage hardwareRecordedAt recordedAt attendantRecordedAt").lean(),
      ]);
      const logByBus = new Map(logs.map((l) => [String(l.busId), l]));
      const now = Date.now();
      const items = buses
        .map((b) => {
          const bid = String(b.busId);
          const lg = logByBus.get(bid);
          const source = lg?.source != null ? String(lg.source) : "staff";
          const net = lg?.network != null ? String(lg.network) : "unknown";
          const signalStrength =
            lg?.signalStrength != null && Number.isFinite(Number(lg.signalStrength)) ? Number(lg.signalStrength) : null;
          const voltage = lg?.voltage != null && Number.isFinite(Number(lg.voltage)) ? Number(lg.voltage) : null;
          const lastSeenRaw = lg?.hardwareRecordedAt ?? lg?.recordedAt ?? lg?.attendantRecordedAt ?? null;
          const lastSeenIso = lastSeenRaw ? new Date(lastSeenRaw).toISOString() : null;
          const lastSeenMs = lastSeenRaw ? new Date(lastSeenRaw).getTime() : 0;
          const staleSec = Number.isFinite(lastSeenMs) && lastSeenMs > 0 ? Math.max(0, Math.floor((now - lastSeenMs) / 1000)) : null;
          const vCls = classifyVoltage(voltage != null ? voltage : Number.NaN);
          const sCls = classifyLte(signalStrength != null ? signalStrength : Number.NaN);
          const alertRedPulse = (signalStrength != null && signalStrength < -110) || (voltage != null && voltage < 4.6);
          const driverName =
            b.driverId && typeof b.driverId === "object"
              ? `${String(b.driverId.firstName || "").trim()} ${String(b.driverId.lastName || "").trim()}`.trim() || null
              : null;
          return {
            busId: bid,
            busNumber: b.busNumber || bid,
            route: b.route || null,
            source,
            activeLink: net === "wifi" ? "wifi" : net === "4g" ? "lte" : "unknown",
            signalStrengthDbm: signalStrength,
            signalLevel: sCls.level,
            signalLabel: sCls.label,
            voltage,
            voltageLevel: vCls.level,
            voltageLabel: vCls.label,
            alertRedPulse,
            lastSeenAt: lastSeenIso,
            staleSeconds: staleSec,
            driverName,
          };
        })
        .sort((a, b) => a.busId.localeCompare(b.busId));
      res.json({ items, generatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to read hardware telemetry" });
    }
  });

  return router;
}

module.exports = { createFleetHardwareRouter };

