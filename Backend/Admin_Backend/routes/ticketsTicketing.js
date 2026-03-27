const express = require("express");
const { getMysqlPool } = require("../db/mysqlPool");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireTicketIssuerJwt } = require("../middleware/requireTicketIssuerJwt");
const { buildTicketFilters } = require("../utils/ticketFiltersFromQuery");
const { incrementBusTicketsIssued, normalizeBusId } = require("../services/busMaintenance");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const RouteCoverage = require("../models/RouteCoverage");
const { computeTicketFare } = require("../services/farePricing");

function nameExpr(alias = "o") {
  return `TRIM(CONCAT_WS(' ', ${alias}.first_name, NULLIF(TRIM(${alias}.middle_name), ''), ${alias}.last_name))`;
}

function metersBetween(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createTicketsTicketingRouter() {
  const router = express.Router();

  router.get("/stats", requireAdminJwt, async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const { clause, params } = buildTicketFilters(req.query);
    try {
      const [[tot]] = await pool.query("SELECT COUNT(*) AS c FROM tickets");
      const [[agg]] = await pool.query(
        `SELECT COUNT(*) AS c, COALESCE(SUM(t.fare), 0) AS revenue FROM tickets t WHERE 1=1 ${clause}`,
        params
      );
      res.json({
        totalTicketCount: tot.c,
        filteredCount: agg.c,
        filteredRevenue: Number(agg.revenue),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/", requireAdminJwt, async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const { clause, params } = buildTicketFilters(req.query);
    try {
      const [rows] = await pool.query(
        `SELECT t.id, t.passenger_id, t.start_location, t.destination, t.fare, t.issued_by_operator_id,
                COALESCE(NULLIF(TRIM(t.issued_by_name), ''), ${nameExpr("o")}) AS bus_operator_name,
                t.bus_number,
                t.created_at
         FROM tickets t
         LEFT JOIN bus_operators o ON o.operator_id = t.issued_by_operator_id
         WHERE 1=1 ${clause}
         ORDER BY t.created_at DESC`,
        params
      );
      res.json({
        items: rows.map((t) => ({
          id: t.id,
          passengerId: t.passenger_id,
          startLocation: t.start_location,
          destination: t.destination,
          fare: Number(t.fare),
          busOperatorName: t.bus_operator_name || "",
          issuedByOperatorId: t.issued_by_operator_id,
          busNumber: t.bus_number || null,
          createdAt: t.created_at,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Issue ticket (Bus Attendant app). Increments Mongo `ticketsIssued` on the registered bus when busNumber is sent.
   * Requires `bus_number` column on `tickets` — run sql/ticketing-migration-bus-number.sql if needed.
   */
  router.post("/issue", requireTicketIssuerJwt, async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });

    const {
      passengerId,
      startLocation,
      destination,
      fare,
      issuedByName,
      busNumber,
      passengerCategory,
    } = req.body || {};
    const pid = String(passengerId || "").trim();
    const start = String(startLocation || "").trim();
    const dest = String(destination || "").trim();
    const fareNum = fare != null ? Number(fare) : NaN;

    if (!pid || !start || !dest) {
      return res.status(400).json({ error: "passengerId, startLocation, and destination are required" });
    }

    const catRaw = String(passengerCategory || "adult").trim().toLowerCase();
    const pricing = await computeTicketFare({
      startLocation: start,
      destination: dest,
      category: catRaw,
      clientFare: fareNum,
    });

    if (!pricing.matched && (!Number.isFinite(pricing.fare) || pricing.fare < 0)) {
      return res.status(400).json({
        error:
          "fare must be a non-negative number when no fare matrix applies to this route (or add a matrix row in Admin)",
      });
    }

    const fareNumFinal = pricing.fare;

    const opId = Number(req.ticketingUser.sub);
    if (!Number.isFinite(opId)) {
      return res.status(400).json({
        error: "Operator id must be numeric (MySQL ticketing). Mongo-only operator accounts cannot issue tickets yet.",
      });
    }

    const nameRaw = String(issuedByName || "").trim();
    let issuedName = nameRaw;
    if (!issuedName) {
      try {
        const [rows] = await pool.query(
          `SELECT ${nameExpr("o")} AS full_name FROM bus_operators o WHERE o.operator_id = ? LIMIT 1`,
          [opId]
        );
        issuedName = rows[0]?.full_name ? String(rows[0].full_name).trim() : "Operator";
      } catch {
        issuedName = "Operator";
      }
    }

    const busNorm = busNumber != null && String(busNumber).trim() ? normalizeBusId(busNumber) : null;

    try {
      if (busNorm) {
        const busDoc = await Bus.findOne({ busId: busNorm }).select("strictPickup busId").lean();
        if (busDoc?.strictPickup !== false) {
          const gps = await GpsLog.findOne({ busId: busNorm }).select("latitude longitude").lean();
          if (!gps || !Number.isFinite(Number(gps.latitude)) || !Number.isFinite(Number(gps.longitude))) {
            return res.status(403).json({
              error: "Pickups are not allowed at this location (no live GPS for strict pickup bus).",
              code: "STRICT_PICKUP_GPS_REQUIRED",
            });
          }
          const zones = await RouteCoverage.find()
            .select("terminal.latitude terminal.longitude terminal.geofenceRadiusM stops")
            .lean();
          let allowed = false;
          const busLat = Number(gps.latitude);
          const busLng = Number(gps.longitude);
          for (const z of zones) {
            const t = z.terminal;
            if (t && t.pickupOnly !== false && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) {
              const d = metersBetween(busLat, busLng, t.latitude, t.longitude);
              if (d <= Number(t.geofenceRadiusM || 500)) {
                allowed = true;
                break;
              }
            }
            if (allowed) break;
            for (const s of z.stops || []) {
              if (s.pickupOnly === false) continue;
              if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
              const d = metersBetween(busLat, busLng, s.latitude, s.longitude);
              if (d <= Number(s.geofenceRadiusM || 100)) {
                allowed = true;
                break;
              }
            }
            if (allowed) break;
          }
          if (!allowed) {
            return res.status(403).json({
              error: "Pickups are not allowed at this location.",
              code: "STRICT_PICKUP_GEOFENCE_BLOCK",
            });
          }
        }
      }

      const [result] = await pool.query(
        `INSERT INTO tickets (passenger_id, start_location, destination, fare, issued_by_operator_id, issued_by_name, bus_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pid, start, dest, fareNumFinal, opId, issuedName, busNorm]
      );

      let busCounter = null;
      if (busNorm) {
        busCounter = await incrementBusTicketsIssued(busNorm);
      }

      res.status(201).json({
        id: result.insertId,
        passengerId: pid,
        startLocation: start,
        destination: dest,
        fare: fareNumFinal,
        pricing: pricing.matched
          ? {
              matched: true,
              baseFarePesos: pricing.baseFarePesos,
              discountPct: pricing.discountPct,
              passengerCategory: pricing.categoryUsed,
            }
          : { matched: false },
        issuedByOperatorId: opId,
        busNumber: busNorm,
        busTicketCounter: busCounter,
      });
    } catch (e) {
      const msg = String(e.message || "");
      if (msg.includes("Unknown column") && msg.includes("bus_number")) {
        return res.status(503).json({
          error:
            "Database missing bus_number column on tickets. Run Backend/Admin_Backend/sql/ticketing-migration-bus-number.sql",
        });
      }
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createTicketsTicketingRouter };
