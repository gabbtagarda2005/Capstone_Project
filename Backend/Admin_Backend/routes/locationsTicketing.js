const express = require("express");
const { getMysqlPool } = require("../db/mysqlPool");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");

function createLocationsTicketingRouter() {
  const router = express.Router();

  router.get("/", requireAdminJwt, async (_req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    try {
      const [rows] = await pool.query(
        "SELECT id, location_name FROM locations ORDER BY location_name ASC"
      );
      res.json({
        items: rows.map((r) => ({ id: r.id, locationName: r.location_name })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", requireAdminJwt, async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const name = String(req.body?.locationName || "").trim();
    if (!name) return res.status(400).json({ error: "locationName required" });
    try {
      const [result] = await pool.query("INSERT INTO locations (location_name) VALUES (?)", [name]);
      res.status(201).json({ id: result.insertId, locationName: name });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Location already exists" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id", requireAdminJwt, async (req, res) => {
    const pool = getMysqlPool();
    if (!pool) return res.status(503).json({ error: "MySQL not configured" });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const [result] = await pool.query("DELETE FROM locations WHERE id = ?", [id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createLocationsTicketingRouter };
