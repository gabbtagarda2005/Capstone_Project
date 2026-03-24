const express = require("express");
const bcrypt = require("bcryptjs");
const { getMysqlPool } = require("../db/mysqlPool");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { mapOperatorRow } = require("./authTicketing");

function nameExpr(alias = "o") {
  return `TRIM(CONCAT_WS(' ', ${alias}.first_name, NULLIF(TRIM(${alias}.middle_name), ''), ${alias}.last_name))`;
}

function createOperatorsTicketingRouter() {
  const router = express.Router();
  router.use(requireAdminJwt);

  router.get("/", async (_req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    try {
      const [rows] = await pool.query(
        `SELECT operator_id, first_name, last_name, middle_name, email, phone, role
         FROM bus_operators ORDER BY operator_id DESC`
      );
      res.json({ items: rows.map((r) => mapOperatorRow(r)) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/login-logs", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [rows] = await pool.query(
        `SELECT log_id, operator_id, login_timestamp FROM login_logs
         WHERE operator_id = ? ORDER BY login_timestamp DESC`,
        [id]
      );
      res.json({
        items: rows.map((r) => ({
          logId: r.log_id,
          operatorId: r.operator_id,
          loginTimestamp: r.login_timestamp,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/ticket-stats", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(fare), 0) AS revenue FROM tickets WHERE issued_by_operator_id = ?`,
        [id]
      );
      res.json({
        ticketCount: rows[0].cnt,
        totalRevenue: Number(rows[0].revenue),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/tickets", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [rows] = await pool.query(
        `SELECT t.id, t.passenger_id, t.start_location, t.destination, t.fare, t.issued_by_operator_id,
                COALESCE(NULLIF(TRIM(t.issued_by_name), ''), ${nameExpr("o")}) AS bus_operator_name,
                t.created_at
         FROM tickets t
         LEFT JOIN bus_operators o ON o.operator_id = t.issued_by_operator_id
         WHERE t.issued_by_operator_id = ?
         ORDER BY t.created_at DESC`,
        [id]
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

  router.get("/:id", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [rows] = await pool.query(
        `SELECT operator_id, first_name, last_name, middle_name, email, phone, role
         FROM bus_operators WHERE operator_id = ? LIMIT 1`,
        [id]
      );
      const op = mapOperatorRow(rows[0]);
      if (!op) return res.status(404).json({ error: "Not found" });
      res.json(op);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const { firstName, lastName, middleName, email, password, phone, role } = req.body || {};
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "firstName, lastName, email, password required" });
    }
    const hash = await bcrypt.hash(String(password), 10);
    try {
      const [result] = await pool.query(
        `INSERT INTO bus_operators (first_name, last_name, middle_name, email, password, phone, role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          String(firstName).trim(),
          String(lastName).trim(),
          middleName ? String(middleName).trim() : null,
          String(email).trim().toLowerCase(),
          hash,
          phone ? String(phone).trim() : null,
          role === "Admin" ? "Admin" : "Operator",
        ]
      );
      res.status(201).json({ operatorId: result.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Email already registered" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/:id", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const { firstName, lastName, middleName, email, phone, password, role } = req.body || {};
    const fields = [];
    const params = [];

    if (firstName !== undefined) {
      fields.push("first_name = ?");
      params.push(String(firstName).trim());
    }
    if (lastName !== undefined) {
      fields.push("last_name = ?");
      params.push(String(lastName).trim());
    }
    if (middleName !== undefined) {
      fields.push("middle_name = ?");
      params.push(middleName ? String(middleName).trim() : null);
    }
    if (email !== undefined) {
      fields.push("email = ?");
      params.push(String(email).trim().toLowerCase());
    }
    if (phone !== undefined) {
      fields.push("phone = ?");
      params.push(phone ? String(phone).trim() : null);
    }
    if (role !== undefined) {
      fields.push("role = ?");
      params.push(role === "Admin" ? "Admin" : "Operator");
    }
    if (password !== undefined && String(password).length > 0) {
      fields.push("password = ?");
      params.push(await bcrypt.hash(String(password), 10));
    }

    if (!fields.length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(id);
    try {
      const [result] = await pool.query(
        `UPDATE bus_operators SET ${fields.join(", ")} WHERE operator_id = ?`,
        params
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Email already in use" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    if (id === req.admin.operatorId) {
      return res.status(400).json({ error: "Cannot delete your own admin account" });
    }

    try {
      const [counts] = await pool.query(
        "SELECT COUNT(*) AS c FROM tickets WHERE issued_by_operator_id = ?",
        [id]
      );
      if (counts[0].c > 0) {
        return res.status(409).json({
          error: "Operator has issued tickets; delete or reassign tickets first",
          ticketCount: counts[0].c,
        });
      }
      const [result] = await pool.query("DELETE FROM bus_operators WHERE operator_id = ?", [id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createOperatorsTicketingRouter };
