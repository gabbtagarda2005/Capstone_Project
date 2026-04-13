const express = require("express");
const GpsLog = require("../models/GpsLog");
const store = require("../services/liveDispatchStore");
const { broadcastLiveBoard } = require("../sockets/socket");

const GPS_FRESH_MS = 5 * 60 * 1000;

function manilaTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dedupeLatestBlockPerBus(rawBlocks) {
  const m = new Map();
  for (const b of rawBlocks) {
    const bid = String(b.busId);
    const prev = m.get(bid);
    const t = new Date(b.updatedAt || b.createdAt || 0).getTime();
    if (!prev || t >= new Date(prev.updatedAt || prev.createdAt || 0).getTime()) m.set(bid, b);
  }
  return [...m.values()];
}

async function enrichItemsForPublic(rawBlocks) {
  const out = [];
  const today = manilaTodayYmd();
  for (const b of rawBlocks) {
    let log = null;
    try {
      log = await GpsLog.findOne({ busId: String(b.busId) }).sort({ recordedAt: -1 }).lean();
    } catch {
      log = null;
    }
    const fresh =
      log &&
      log.recordedAt &&
      Date.now() - new Date(log.recordedAt).getTime() < GPS_FRESH_MS &&
      b.status !== "cancelled";

    const sig = log?.signal != null && ["strong", "weak", "offline"].includes(String(log.signal)) ? String(log.signal) : null;
    const trackingLost = !fresh;
    const trackingDegraded = Boolean(fresh && sig === "weak");

    const departurePoint =
      (b.departurePoint && String(b.departurePoint).trim()) ||
      store.deriveDeparturePoint(b.routeLabel, null);

    const sd = b.serviceDate != null && String(b.serviceDate).trim() ? String(b.serviceDate).trim().slice(0, 10) : "";
    if (sd && sd < today) continue;

    const isArriving = b.status === "arriving";
    const departureTime =
      isArriving && b.arrivalLockedEta
        ? String(b.arrivalLockedEta).trim()
        : b.status === "cancelled"
          ? b.scheduledDeparture
          : "ESTIMATED";

    const gateDisplay =
      (b.gate != null ? String(b.gate).trim() : "") ||
      (b.currentTerminalGate && String(b.currentTerminalGate).trim()) ||
      (b.arrivalTerminalName && String(b.arrivalTerminalName).trim()) ||
      null;

    out.push({
      id: b.id,
      routeId: b.routeId,
      route: b.routeLabel,
      busId: b.busId,
      status: b.status,
      departurePoint,
      /** Scheduled departure time (HH:mm) — passenger "Departs" column; locked to actual time when ARRIVING */
      departureTime,
      serviceDate: sd || null,
      tracking: !!fresh,
      trackingLost,
      trackingDegraded,
      telemetrySignal: sig,
      gate: gateDisplay,
      currentTerminalGate: b.currentTerminalGate != null ? String(b.currentTerminalGate) : null,
      arrivalTerminalName: b.arrivalTerminalName != null ? String(b.arrivalTerminalName) : null,
      arrivalLockedEta: b.arrivalLockedEta != null ? String(b.arrivalLockedEta) : null,
      arrivalDetectedAt: b.arrivalDetectedAt != null ? String(b.arrivalDetectedAt) : null,
      etaMinutes: Number.isFinite(Number(b.etaMinutes)) ? Math.max(0, Math.round(Number(b.etaMinutes))) : null,
      etaTargetIso: b.etaTargetIso != null ? String(b.etaTargetIso) : null,
      nextTerminal: b.nextTerminal != null ? String(b.nextTerminal) : null,
    });
  }
  return out;
}

function reconcileArrivingCooldowns() {
  const raw = store.listBlocks();
  const fiveMin = 5 * 60 * 1000;
  for (const b of raw) {
    if (b.status !== "arriving" || !b.arrivalDetectedAt) continue;
    const ts = new Date(b.arrivalDetectedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (Date.now() - ts >= fiveMin) store.completeArrivalAfterCooldown(b.id);
  }
}

async function buildPublicPayload() {
  store.syncServiceDatesToManilaToday();
  reconcileArrivingCooldowns();
  const raw = dedupeLatestBlockPerBus(store.listBlocks());
  const items = await enrichItemsForPublic(raw);
  return {
    items,
    holidayBanner: store.getHolidayBanner(),
    serverTime: new Date().toISOString(),
    manilaDate: store.manilaTodayYmd(),
  };
}

function createPublicLiveBoardHandler() {
  return async (_req, res) => {
    try {
      const { isOperationsDeckLive } = require("../services/adminPortalSettingsService");
      const payload = await buildPublicPayload();
      if (!(await isOperationsDeckLive())) {
        payload.items = [];
      }
      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: e.message || "live-board failed" });
    }
  };
}

function createLiveDispatchRouter(io) {
  const router = express.Router();

  async function pushBoard() {
    try {
      const payload = await buildPublicPayload();
      broadcastLiveBoard(io, payload);
    } catch (e) {
      console.warn("[live-dispatch] broadcast failed:", e.message);
    }
  }

  router.get("/blocks", async (_req, res) => {
    store.syncServiceDatesToManilaToday();
    reconcileArrivingCooldowns();
    res.json({
      items: dedupeLatestBlockPerBus(store.listBlocks()),
      holidayBanner: store.getHolidayBanner(),
      manilaDate: store.manilaTodayYmd(),
    });
  });

  router.post("/blocks", async (req, res) => {
    const { busId, routeId, routeLabel, scheduledDeparture, status, departurePoint, serviceDate } = req.body || {};
    if (!busId || !routeId || !scheduledDeparture) {
      return res.status(400).json({ error: "busId, routeId, and scheduledDeparture are required" });
    }
    const b = store.createBlock({
      busId,
      routeId,
      routeLabel,
      scheduledDeparture,
      status,
      departurePoint,
      serviceDate,
    });
    await pushBoard();
    res.status(201).json(b);
  });

  router.patch("/blocks/:id", async (req, res) => {
    const { id } = req.params;
    const patch = req.body || {};
    const allowed = {};
    if (patch.status != null) allowed.status = patch.status;
    if (patch.scheduledDeparture != null) allowed.scheduledDeparture = patch.scheduledDeparture;
    if (patch.busId != null) allowed.busId = patch.busId;
    if (patch.routeId != null) allowed.routeId = patch.routeId;
    if (patch.routeLabel != null) allowed.routeLabel = patch.routeLabel;
    if (patch.departurePoint != null) allowed.departurePoint = patch.departurePoint;
    if (patch.arrivalDetectedAt != null) allowed.arrivalDetectedAt = patch.arrivalDetectedAt;
    if (patch.arrivalTerminalName != null) allowed.arrivalTerminalName = patch.arrivalTerminalName;
    if (patch.gate != null) allowed.gate = patch.gate;
    if (patch.arrivalLockedEta != null) allowed.arrivalLockedEta = patch.arrivalLockedEta;
    const next = store.updateBlock(id, allowed);
    if (!next) return res.status(404).json({ error: "Block not found" });
    await pushBoard();
    res.json(next);
  });

  router.delete("/blocks/:id", async (req, res) => {
    const ok = store.deleteBlock(req.params.id);
    if (!ok) return res.status(404).json({ error: "Block not found" });
    await pushBoard();
    res.status(204).end();
  });

  router.post("/publish-today", async (req, res) => {
    try {
      const { busId, routeId, routeLabel, departurePoint, departureTime } = req.body || {};
      const created = store.replaceSingleTripForBus({
        busId,
        routeId,
        routeLabel,
        departurePoint,
        departureTime,
      });
      await pushBoard();
      res.status(201).json({ item: created });
    } catch (e) {
      res.status(400).json({ error: e.message || "publish failed" });
    }
  });

  router.post("/bulk-weekly", async (req, res) => {
    try {
      const { busId, routeId, routeLabel, departurePoint, departureTime, startDate, endDate, weekdays } = req.body || {};
      const created = store.bulkWeeklyDepartures({
        busId,
        routeId,
        routeLabel,
        departurePoint,
        departureTime,
        startDate,
        endDate,
        weekdays: Array.isArray(weekdays) ? weekdays : [],
      });
      await pushBoard();
      res.status(201).json({ items: created, count: created.length });
    } catch (e) {
      res.status(400).json({ error: e.message || "weekly plan failed" });
    }
  });

  router.post("/bulk-peak", async (req, res) => {
    try {
      const { routeLabel, routeId, startTime, intervalMinutes, count, busIds } = req.body || {};
      if (!routeId) return res.status(400).json({ error: "routeId required" });
      const created = store.bulkPeakTemplate({
        routeLabel,
        routeId,
        startTime: startTime || "06:00",
        intervalMinutes: intervalMinutes ?? 15,
        count: count ?? 12,
        busIds: Array.isArray(busIds) ? busIds : [],
      });
      await pushBoard();
      res.status(201).json({ items: created });
    } catch (e) {
      res.status(400).json({ error: e.message || "bulk failed" });
    }
  });

  router.post("/holiday-override", async (req, res) => {
    const { holidayName, message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message required" });
    }
    const h = store.setHoliday({ holidayName, message });
    await pushBoard();
    res.json(h);
  });

  router.delete("/holiday-override", async (_req, res) => {
    store.clearHoliday();
    await pushBoard();
    res.status(204).end();
  });

  return router;
}

module.exports = {
  createLiveDispatchRouter,
  createPublicLiveBoardHandler,
  buildPublicPayload,
};
