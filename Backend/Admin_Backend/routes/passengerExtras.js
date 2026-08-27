/**
 * Passenger-web-only routes that have no Admin equivalent — ported verbatim from
 * Passenger_Backend/server.js as part of merging that service into Admin_Backend.
 */
const express = require("express");
const mongoose = require("mongoose");
const PassengerTerminalAffinity = require("../models/PassengerTerminalAffinity");

/** Default map center: Malaybalay, Bukidnon */
const DEFAULT_MAP = {
  center: { lat: 8.158, lng: 125.1236 },
  zoom: 11,
  label: "Malaybalay · Bukidnon",
};

function createPassengerExtrasRouter() {
  const r = express.Router();

  r.get("/passenger/map-config", (_req, res) => {
    res.json({
      ...DEFAULT_MAP,
      tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
  });

  /** Log nearest terminal coverage id when a passenger enables location (no coordinates persisted). */
  r.post("/passenger/terminal-affinity", async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(204).send();
      }
      const id = String(req.body?.coverageId || "").trim();
      if (!/^[a-f0-9]{24}$/i.test(id)) {
        return res.status(400).json({ error: "Invalid coverageId" });
      }
      await PassengerTerminalAffinity.findOneAndUpdate(
        { coverageId: id },
        { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } },
        { upsert: true, new: true }
      );
      return res.status(204).send();
    } catch (e) {
      console.error("[terminal-affinity]", e.message || e);
      return res.status(500).json({ error: "Could not record terminal affinity" });
    }
  });

  /** Legacy stub — passenger web uses Admin live-board + broadcast via fetchPassengerNotificationFeed. */
  r.get("/passenger/notifications", (_req, res) => {
    res.json({ items: [] });
  });

  return r;
}

module.exports = { createPassengerExtrasRouter };
