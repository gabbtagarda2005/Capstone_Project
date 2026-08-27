/**
 * BusAttendant-app-only routes that have no other Admin equivalent — ported from
 * BusAttendant_Backend/server.js as part of merging that service into Admin_Backend.
 * Gated with requireTicketIssuerJwt, same as every other attendant-facing route in this app.
 */
const express = require("express");
const { requireTicketIssuerJwt } = require("../middleware/requireTicketIssuerJwt");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");

/** Demo passenger directory — never had real data behind it in BusAttendant_Backend either. */
const MOCK_PASSENGERS = [
  { id: "PAX-1001", name: "Ana Lopez", category: "regular", lastTrip: "Malaybalay → Valencia" },
  { id: "PAX-1002", name: "Jose Dela Cruz", category: "student", lastTrip: "Valencia → Maramag" },
  { id: "PAX-1003", name: "Rita Flores", category: "senior", lastTrip: "Maramag → Don Carlos" },
];

function createAttendantExtrasRouter() {
  const r = express.Router();

  /**
   * Same aggregation BusAttendant_Backend did over Admin's /api/tickets/recent/me — now a direct
   * in-process Mongo query instead of an HTTP round-trip to itself. The old mock-fallback branch
   * (used when the two-hop proxy couldn't reach Admin) no longer applies here.
   */
  r.get("/dashboard/summary", requireTicketIssuerJwt, async (req, res) => {
    try {
      const sub = String(req.ticketingUser.sub || "").trim();
      const docs = await IssuedTicketRecord.find({ issuerSub: sub }).sort({ createdAt: -1 }).limit(60).lean();
      const items = docs.map((t) => ({
        from: t.startLocation,
        to: t.destination,
        fare: Number(t.fare),
        passengerId: t.passengerId,
        createdAt: t.createdAt,
      }));

      const today = new Date();
      const isSameDay = (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return false;
        return (
          d.getFullYear() === today.getFullYear() &&
          d.getMonth() === today.getMonth() &&
          d.getDate() === today.getDate()
        );
      };
      const todayItems = items.filter((t) => isSameDay(t.createdAt));
      const todayRevenue = todayItems.reduce((sum, t) => sum + Number(t.fare || 0), 0);

      const paxIds = new Set();
      for (const t of todayItems) {
        const id = String(t.passengerId || "").trim();
        if (id) paxIds.add(id);
      }
      const activePassengers = paxIds.size > 0 ? paxIds.size : todayItems.length;

      const countRoutes = (list) => {
        const m = new Map();
        for (const t of list) {
          const a = String(t.from || "").trim();
          const b = String(t.to || "").trim();
          if (!a && !b) continue;
          const k = `${a} → ${b}`;
          m.set(k, (m.get(k) || 0) + 1);
        }
        return m;
      };

      let topRoute = "—";
      let best = 0;
      for (const [k, c] of countRoutes(todayItems)) {
        if (c > best) {
          best = c;
          topRoute = k;
        }
      }
      if (best === 0 && items.length) {
        for (const [k, c] of countRoutes(items)) {
          if (c > best) {
            best = c;
            topRoute = k;
          }
        }
      }
      if (topRoute === "—") topRoute = "No routes yet";

      res.json({
        busNumber: "BUK-000",
        todayTickets: todayItems.length,
        todayRevenue,
        activePassengers,
        topRoute,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || "dashboard summary failed" });
    }
  });

  r.get("/passengers", requireTicketIssuerJwt, (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const filtered = q
      ? MOCK_PASSENGERS.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      : MOCK_PASSENGERS;
    res.json({ items: filtered });
  });

  /** Superseded by /api/staff-profile (real data) — kept as a lightweight compatibility shim. */
  r.get("/profile/me", requireTicketIssuerJwt, (req, res) => {
    res.json({
      id: String(req.ticketingUser.sub || ""),
      firstName: "Bus",
      lastName: "Attendant",
      email: String(req.ticketingUser.email || ""),
      role: String(req.ticketingUser.role || "Bus Attendant"),
      busNumber: "BUK-000",
      phone: "0991-577-4040",
    });
  });

  return r;
}

module.exports = { createAttendantExtrasRouter };
