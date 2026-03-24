const express = require("express");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const GpsHistory = require("../models/GpsHistory");
const { broadcastLocationUpdate } = require("../sockets/socket");

function createBusesRouter(io) {
  const router = express.Router();

  /** Latest positions for admin / passenger maps */
  router.get("/live", async (_req, res) => {
    try {
      const logs = await GpsLog.find().lean();
      res.json({ items: logs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/", async (_req, res) => {
    try {
      const buses = await Bus.find().lean();
      res.json({ items: buses });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * LilyGo / device ping — body: { busId, latitude, longitude, speedKph?, heading? }
   * Optional header: x-device-secret matching DEVICE_INGEST_SECRET
   */
  router.post("/ping", async (req, res) => {
    const secret = process.env.DEVICE_INGEST_SECRET;
    if (secret && req.headers["x-device-secret"] !== secret) {
      return res.status(401).json({ error: "Invalid device secret" });
    }

    const { busId, latitude, longitude, speedKph, heading } = req.body || {};
    if (!busId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "busId, latitude, longitude required" });
    }

    const recordedAt = new Date();

    try {
      await GpsLog.findOneAndUpdate(
        { busId: String(busId) },
        {
          busId: String(busId),
          latitude: Number(latitude),
          longitude: Number(longitude),
          speedKph: speedKph != null ? Number(speedKph) : null,
          heading: heading != null ? Number(heading) : null,
          recordedAt,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await GpsHistory.create({
        busId: String(busId),
        latitude: Number(latitude),
        longitude: Number(longitude),
        speedKph: speedKph != null ? Number(speedKph) : null,
        heading: heading != null ? Number(heading) : null,
        recordedAt,
      });

      await Bus.updateOne({ busId: String(busId) }, { lastSeenAt: recordedAt }).catch(() => {});

      const payload = {
        busId: String(busId),
        latitude: Number(latitude),
        longitude: Number(longitude),
        speedKph: speedKph != null ? Number(speedKph) : null,
        heading: heading != null ? Number(heading) : null,
        recordedAt: recordedAt.toISOString(),
      };
      broadcastLocationUpdate(io, payload);

      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createBusesRouter };
