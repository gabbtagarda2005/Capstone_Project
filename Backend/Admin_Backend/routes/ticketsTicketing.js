const express = require("express");
const { getMysqlPool } = require("../db/mysqlPool");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { buildTicketFilters } = require("../utils/ticketFiltersFromQuery");

function nameExpr(alias = "o") {
  return `TRIM(CONCAT_WS(' ', ${alias}.first_name, NULLIF(TRIM(${alias}.middle_name), ''), ${alias}.last_name))`;
}

function createTicketsTicketingRouter() {
  const router = express.Router();
  router.use(requireAdminJwt);

  router.get("/stats", async (req, res) => {
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

  router.get("/", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const { clause, params } = buildTicketFilters(req.query);
    try {
      const [rows] = await pool.query(
        `SELECT t.id, t.passenger_id, t.start_location, t.destination, t.fare, t.issued_by_operator_id,
                COALESCE(NULLIF(TRIM(t.issued_by_name), ''), ${nameExpr("o")}) AS bus_operator_name,
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
          createdAt: t.created_at,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createTicketsTicketingRouter };
