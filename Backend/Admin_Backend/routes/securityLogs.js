const express = require("express");
const mongoose = require("mongoose");
const SecurityLog = require("../models/SecurityLog");
const AdminAuditLog = require("../models/AdminAuditLog");
const Bus = require("../models/Bus");
const PortalUser = require("../models/PortalUser");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");

function createSecurityLogsRouter() {
  const router = express.Router();
  router.use(requireAdminJwt);

  async function buildAttendantNameFallbackMap(busIds) {
    const ids = Array.from(new Set((busIds || []).map((v) => String(v || "").trim()).filter(Boolean)));
    if (!ids.length) return new Map();
    const buses = await Bus.find({ busId: { $in: ids } })
      .select("busId operatorPortalUserId")
      .lean();
    const portalIds = Array.from(
      new Set(
        buses
          .map((b) => (b?.operatorPortalUserId != null ? String(b.operatorPortalUserId) : ""))
          .filter(Boolean)
      )
    )
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const users = portalIds.length
      ? await PortalUser.find({ _id: { $in: portalIds } }).select("firstName lastName email").lean()
      : [];
    const userById = new Map(
      users.map((u) => {
        const full = `${String(u.firstName || "").trim()} ${String(u.lastName || "").trim()}`.trim();
        return [String(u._id), full || String(u.email || "").trim() || "—"];
      })
    );
    const out = new Map();
    for (const b of buses) {
      const key = String(b.busId || "").trim();
      if (!key) continue;
      const uid = b?.operatorPortalUserId != null ? String(b.operatorPortalUserId) : "";
      const nm = uid ? userById.get(uid) : null;
      if (nm) out.set(key, nm);
    }
    return out;
  }

  /** Recent security / safety events (speed violations, SOS, etc.) for Reports & audit. */
  router.get("/", async (req, res) => {
    try {
      const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
      const typeFilter = String(req.query.type || "").trim();
      const q = typeFilter ? { type: typeFilter } : {};
      const items = await SecurityLog.find(q).sort({ createdAt: -1 }).limit(limit).lean();
      const attendantFallbackByBus = await buildAttendantNameFallbackMap(items.map((d) => d.busId));
      res.json({
        items: items.map((d) => ({
          id: String(d._id),
          type: d.type,
          busId: d.busId,
          message: d.message,
          severity: d.severity,
          latitude: d.latitude,
          longitude: d.longitude,
          assignedRoute: d.assignedRoute,
          source: d.source,
          attendantDisplayName:
            (d.attendantDisplayName != null && String(d.attendantDisplayName).trim()) ||
            attendantFallbackByBus.get(String(d.busId || "").trim()) ||
            null,
          createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message || "list failed" });
    }
  });

  /**
   * Close SOS intercept — requires incident notes for Bukidnon Bus operational record.
   * Body: { resolutionNotes: string }
   */
  router.post("/:id/sos-resolve", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid log id" });
      }
      const resolutionNotes = String(req.body?.resolutionNotes ?? "").trim();
      if (resolutionNotes.length < 8) {
        return res.status(400).json({ error: "Incident notes required (minimum 8 characters)" });
      }
      if (resolutionNotes.length > 4000) {
        return res.status(400).json({ error: "Incident notes too long (max 4000)" });
      }
      const doc = await SecurityLog.findById(id);
      if (!doc) {
        return res.status(404).json({ error: "Security log not found" });
      }
      if (doc.type !== "attendant_sos") {
        return res.status(400).json({ error: "This entry is not an attendant SOS" });
      }
      if (doc.resolvedAt) {
        return res.status(400).json({ error: "SOS already resolved" });
      }
      doc.resolutionNotes = resolutionNotes;
      doc.resolvedAt = new Date();
      doc.resolvedByEmail = req.admin.email;
      await doc.save();

      const stamp = new Date().toISOString();
      const auditLine = `SOS RESOLVED ${stamp} | Bus ${doc.busId} | Plate ${doc.plateNumber ?? "—"} | Attendant ${doc.attendantDisplayName ?? "—"} | Notes: ${resolutionNotes.slice(0, 1500)}`;
      await AdminAuditLog.create({
        email: req.admin.email,
        module: "Reports",
        action: "ADD",
        details: auditLine,
        httpMethod: "POST",
        path: `/api/security/logs/${id}/sos-resolve`,
        statusCode: 200,
        source: "http",
      });

      res.json({ ok: true, id: String(doc._id), resolvedAt: doc.resolvedAt.toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message || "Resolve failed" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const {
        type = "geofence_breach",
        busId,
        message,
        severity = "critical",
        latitude,
        longitude,
        assignedRoute,
        currentTerminal,
        source = "admin_portal",
      } = req.body ?? {};
      if (!busId || typeof busId !== "string") {
        return res.status(400).json({ error: "busId is required" });
      }
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }
      const doc = await SecurityLog.create({
        type,
        busId,
        message,
        severity,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
        assignedRoute: assignedRoute ?? null,
        currentTerminal: currentTerminal ?? null,
        source,
      });
      res.status(201).json({ ok: true, id: String(doc._id) });
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to write security log" });
    }
  });

  return router;
}

module.exports = { createSecurityLogsRouter };
