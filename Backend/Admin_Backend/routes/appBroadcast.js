const mongoose = require("mongoose");
const AppBroadcast = require("../models/AppBroadcast");

const SEVERITY = new Set(["normal", "medium", "critical"]);

async function handleGetPublicBroadcast(target, res) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ message: "", severity: "normal", updatedAt: null });
    }
    const row = await AppBroadcast.findOne({ target }).lean();
    return res.json({
      message: row?.message ? String(row.message) : "",
      severity: SEVERITY.has(row?.severity) ? row.severity : "normal",
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "broadcast read failed" });
  }
}

function createPostAdminBroadcastHandler(io) {
  return async (req, res) => {
    try {
      if (req.admin.rbacRole === "auditor") {
        return res.status(403).json({ error: "Read-only role cannot send broadcasts" });
      }
      const body = req.body || {};
      const message = String(body.message ?? "").trim().slice(0, 2000);
      if (!message) {
        return res.status(400).json({ error: "message is required" });
      }
      const sev = String(body.severity ?? "normal").toLowerCase();
      const severity = SEVERITY.has(sev) ? sev : "normal";
      const now = new Date();

      let targets = [];
      if (Array.isArray(body.targets) && body.targets.length > 0) {
        targets = [...new Set(body.targets.map((t) => String(t).trim()))].filter((t) => t === "passenger" || t === "attendant");
      } else {
        const target = body.target;
        if (target === "passenger" || target === "attendant") {
          targets = [target];
        }
      }
      if (targets.length === 0) {
        return res.status(400).json({ error: "Select at least one target: passenger and/or attendant" });
      }

      const broadcasts = [];
      for (const target of targets) {
        const row = await AppBroadcast.findOneAndUpdate(
          { target },
          { $set: { message, severity, updatedAt: now } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        const payload = {
          target,
          message,
          severity,
          updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : now.toISOString(),
        };
        broadcasts.push(payload);
        if (io) {
          io.emit("appBroadcast", payload);
        }
      }

      res.json({
        ok: true,
        broadcasts,
        broadcast: broadcasts[0],
      });
    } catch (e) {
      res.status(500).json({ error: e.message || "broadcast failed" });
    }
  };
}

module.exports = {
  handleGetPublicBroadcast,
  createPostAdminBroadcastHandler,
};
