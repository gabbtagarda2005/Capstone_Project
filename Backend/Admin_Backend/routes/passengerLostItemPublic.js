const mongoose = require("mongoose");
const SecurityLog = require("../models/SecurityLog");
const { broadcastCommandAlert } = require("../sockets/socket");
const { sendDailyOperationsDigestEmail } = require("../services/mailer");
const { getPortalSettingsLean } = require("../services/adminPortalSettingsService");
const { loadBusContextForLostItem } = require("../services/passengerLostItemBusContext");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeBusIdForStorage(raw) {
  const busId = String(raw || "").trim();
  const low = busId.toLowerCase();
  if (!busId || low === "__unsure__" || low === "unsure" || low === "unknown") {
    return "UNKNOWN";
  }
  return busId;
}

/**
 * @param {import("socket.io").Server} io
 */
function createHandlePostPassengerLostItem(io) {
  return async function handlePostPassengerLostItem(req, res) {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const body = req.body || {};
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      const lastSeenRaw = body.lastSeenAt != null ? String(body.lastSeenAt).trim() : "";
      const lastSeen = new Date(lastSeenRaw);
      if (!Number.isFinite(lastSeen.getTime())) {
        return res.status(400).json({ error: "lastSeenAt must be a valid date (ISO string)" });
      }
      const busStored = normalizeBusIdForStorage(body.busId);
      const busLabel = body.busLabel != null ? String(body.busLabel).trim().slice(0, 320) : "";
      const details = body.details != null ? String(body.details).trim().slice(0, 2000) : "";
      const lastSeenLabel = lastSeen.toISOString();

      const message = [
        `Passenger lost-item | Last seen (UTC): ${lastSeenLabel}`,
        busLabel ? `Bus / route: ${busLabel}` : `Bus id: ${busStored}`,
        `Contact: ${email}`,
        details ? `Details: ${details}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const doc = await SecurityLog.create({
        type: "passenger_lost_item",
        busId: busStored,
        message,
        severity: "info",
        latitude: null,
        longitude: null,
        assignedRoute: busLabel || null,
        source: "passenger_app",
      });

      const ctx = await loadBusContextForLostItem(busStored);
      const routeForDisplay = busLabel || ctx.routeFromDb || ctx.busNumber;
      const staffParts = [ctx.driverDisplayName, ctx.attendantDisplayName].filter(Boolean);
      const staffLine = staffParts.length > 0 ? staffParts.join(" · ") : "";

      const subtitle = `${email} · ${busLabel || busStored}${details ? ` — ${details.slice(0, 140)}` : ""}`;
      broadcastCommandAlert(io, {
        kind: "lost_item",
        id: String(doc._id),
        busId: busStored,
        busLabel: busLabel || null,
        message: subtitle,
        createdAt: doc.createdAt.toISOString(),
        passengerEmail: email,
        lastSeenAt: lastSeenLabel,
        details: details || null,
        fullMessage: message,
        busNumber: ctx.busNumber,
        busPlate: ctx.busPlate,
        routeName: routeForDisplay || null,
        driverId: ctx.driverMongoId || null,
        driverName: ctx.driverDisplayName || null,
        attendantName: ctx.attendantDisplayName || null,
        staffLine: staffLine || null,
      });

      try {
        const settings = await getPortalSettingsLean();
        const to = String(settings.companyEmail || settings.sosEmail || "").trim();
        if (to && EMAIL_RE.test(to)) {
          const subj = `[Lost item] ${busStored} · ${email}`;
          const text = message;
          const html = `<p style="font-family:system-ui,sans-serif;line-height:1.55;white-space:pre-wrap">${escHtml(
            message
          )}</p>`;
          void sendDailyOperationsDigestEmail({ to, subject: subj, text, html });
        }
      } catch {
        /* non-fatal */
      }

      return res.status(201).json({ ok: true, id: String(doc._id) });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to save report" });
    }
  };
}

module.exports = { createHandlePostPassengerLostItem };
