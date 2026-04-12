const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const { mapMongoUser } = require("./authTicketing");
const AttendantRegistry = require("../models/AttendantRegistry");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const PortalUser = require("../models/PortalUser");
const { allocateUniqueSixDigit } = require("../services/personnelSixDigit");

function stableNumFromString(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483000 || 1;
}

function mapIssuedMongoToOperatorTicketRow(doc) {
  const issuedNum =
    doc.issuerMysqlId != null && Number.isFinite(Number(doc.issuerMysqlId))
      ? Number(doc.issuerMysqlId)
      : stableNumFromString(doc.issuerSub);
  const ca = doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString();
  return {
    id: String(doc._id),
    passengerId: doc.passengerId,
    startLocation: doc.startLocation,
    destination: doc.destination,
    fare: Number(doc.fare),
    busOperatorName: doc.issuedByName ? String(doc.issuedByName).trim() : "",
    issuedByOperatorId: issuedNum,
    createdAt: ca,
  };
}

function isPortalIssuerSub(rawId) {
  return /^[a-f0-9]{24}$/i.test(String(rawId || "").trim());
}

function attendantPortalRole(doc) {
  const r = String(doc?.role || "").trim();
  return r === "Operator" || r === "BusAttendant" || r === "Bus Attendant";
}

async function countTicketsForOperatorParam(rawId) {
  const s = String(rawId || "").trim();
  if (mongoose.isValidObjectId(s)) {
    return IssuedTicketRecord.countDocuments({ issuerSub: s });
  }
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1) {
    return IssuedTicketRecord.countDocuments({ issuerMysqlId: n });
  }
  return 0;
}

function createOperatorsTicketingRouter() {
  const router = express.Router();
  router.use(requireAdminJwt);

  router.get("/", async (_req, res) => {
    try {
      const docs = await PortalUser.find({
        role: { $in: ["Operator", "BusAttendant"] },
      })
        .sort({ createdAt: -1 })
        .lean();
      const emails = docs.map((d) => String(d.email || "").toLowerCase()).filter(Boolean);
      const regs =
        emails.length > 0 ? await AttendantRegistry.find({ email: { $in: emails } }).select("email").lean() : [];
      const verifiedEmails = new Set(regs.map((r) => String(r.email || "").toLowerCase()));
      res.json({
        items: docs.map((d) => ({
          ...mapMongoUser(d),
          otpVerified: verifiedEmails.has(String(d.email || "").toLowerCase()),
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/login-logs", async (_req, res) => {
    res.json({ items: [] });
  });

  router.get("/:id/ticket-stats", async (req, res) => {
    const rawId = String(req.params.id || "").trim();
    try {
      if (isPortalIssuerSub(rawId)) {
        const agg = await IssuedTicketRecord.aggregate([
          { $match: { issuerSub: rawId } },
          { $group: { _id: null, cnt: { $sum: 1 }, revenue: { $sum: "$fare" } } },
        ]);
        const row = agg[0];
        return res.json({
          ticketCount: row ? row.cnt : 0,
          totalRevenue: row ? Number(row.revenue) : 0,
        });
      }
      const n = Number(rawId);
      let match = null;
      if (Number.isFinite(n) && n >= 1) match = { issuerMysqlId: n };
      if (!match) return res.json({ ticketCount: 0, totalRevenue: 0 });
      const agg = await IssuedTicketRecord.aggregate([
        { $match: match },
        { $group: { _id: null, cnt: { $sum: 1 }, revenue: { $sum: "$fare" } } },
      ]);
      const row = agg[0];
      return res.json({
        ticketCount: row ? row.cnt : 0,
        totalRevenue: row ? Number(row.revenue) : 0,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/tickets", async (req, res) => {
    const rawId = String(req.params.id || "").trim();
    try {
      if (isPortalIssuerSub(rawId)) {
        const docs = await IssuedTicketRecord.find({ issuerSub: rawId }).sort({ createdAt: -1 }).limit(500).lean();
        return res.json({ items: docs.map(mapIssuedMongoToOperatorTicketRow) });
      }
      const n = Number(rawId);
      let docs = [];
      if (Number.isFinite(n) && n >= 1) {
        docs = await IssuedTicketRecord.find({ issuerMysqlId: n }).sort({ createdAt: -1 }).limit(500).lean();
      }
      return res.json({ items: docs.map(mapIssuedMongoToOperatorTicketRow) });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id", async (req, res) => {
    const raw = String(req.params.id || "").trim();
    if (!mongoose.isValidObjectId(raw)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      const doc = await PortalUser.findById(raw).lean();
      if (!doc || !attendantPortalRole(doc)) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json(mapMongoUser(doc));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", async (req, res) => {
    const { firstName, lastName, middleName, email, password, phone, role } = req.body || {};
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "firstName, lastName, email, password required" });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const roleStr = String(role || "Operator").trim();
    const puRole = roleStr === "BusAttendant" || roleStr === "Bus Attendant" ? "BusAttendant" : "Operator";

    try {
      const employeeNumber = await allocateUniqueSixDigit();
      const doc = await PortalUser.create({
        email: String(email).trim().toLowerCase(),
        password: hash,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        middleName: middleName ? String(middleName).trim() : null,
        phone: phone ? String(phone).trim() : null,
        role: puRole,
        employeeNumber,
        authProvider: "password",
      });
      res.status(201).json({ operatorId: doc._id.toString(), employeeId: employeeNumber });
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ error: "Email already registered" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/:id", async (req, res) => {
    const raw = String(req.params.id || "").trim();
    if (!mongoose.isValidObjectId(raw)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const { firstName, lastName, middleName, email, phone, password, role } = req.body || {};
    const $set = {};

    if (firstName !== undefined) $set.firstName = String(firstName).trim();
    if (lastName !== undefined) $set.lastName = String(lastName).trim();
    if (middleName !== undefined) $set.middleName = middleName ? String(middleName).trim() : null;
    if (email !== undefined) $set.email = String(email).trim().toLowerCase();
    if (phone !== undefined) $set.phone = phone ? String(phone).trim() : null;
    if (role !== undefined) {
      const roleStr = String(role).trim();
      $set.role = roleStr === "BusAttendant" || roleStr === "Bus Attendant" ? "BusAttendant" : "Operator";
    }
    if (password !== undefined && String(password).length > 0) {
      $set.password = await bcrypt.hash(String(password), 10);
    }

    if (!Object.keys($set).length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    try {
      const upd = await PortalUser.updateOne(
        { _id: raw, role: { $in: ["Operator", "BusAttendant"] } },
        { $set }
      );
      if (upd.matchedCount === 0) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true });
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ error: "Email already in use" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/:id", requireSuperAdmin, async (req, res) => {
    const raw = String(req.params.id || "").trim();
    if (!mongoose.isValidObjectId(raw)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    if (String(raw) === String(req.admin.operatorId)) {
      return res.status(400).json({ error: "Cannot delete your own admin account" });
    }

    try {
      const ticketCount = await countTicketsForOperatorParam(raw);
      if (ticketCount > 0) {
        return res.status(409).json({
          error: "Operator has issued tickets; delete or reassign tickets first",
          ticketCount,
        });
      }
      const result = await PortalUser.deleteOne({
        _id: raw,
        role: { $in: ["Operator", "BusAttendant"] },
      });
      if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createOperatorsTicketingRouter };
