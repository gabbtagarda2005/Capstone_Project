const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Driver = require("../models/Driver");
const DriverTicketEditLog = require("../models/DriverTicketEditLog");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { allocateUniqueSixDigit, isSixDigitTaken } = require("../services/personnelSixDigit");

function mapDriver(d) {
  if (!d) return null;
  return {
    id: d._id.toString(),
    driverId: d.driverId,
    firstName: d.firstName,
    lastName: d.lastName,
    middleName: d.middleName || null,
    email: d.email || null,
    phone: d.phone || null,
    licenseNumber: d.licenseNumber || null,
    licenseExpiresAt: d.licenseExpiresAt ? d.licenseExpiresAt.toISOString() : null,
    yearsExperience: d.yearsExperience != null ? Number(d.yearsExperience) : null,
    profileImageUrl: d.profileImageUrl || null,
    licenseScanUrl: d.licenseScanUrl || null,
    otpVerified: Boolean(d.verifiedViaOtpAt),
    active: d.active !== false,
    hasTicketEditPin: Boolean(d.ticketEditPinHash),
  };
}

function createDriversRouter() {
  const router = express.Router();
  router.use(requireAdminJwt);

  router.get("/", async (_req, res) => {
    try {
      const rows = await Driver.find({ active: { $ne: false } }).sort({ lastName: 1, firstName: 1 }).lean();
      res.json({ items: rows.map(mapDriver) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Gmail OTP–verified drivers only (for bus assignment dropdowns). */
  router.get("/verified", async (_req, res) => {
    try {
      const rows = await Driver.find({
        verifiedViaOtpAt: { $exists: true, $ne: null },
        active: { $ne: false },
      })
        .sort({ lastName: 1, firstName: 1 })
        .lean();
      res.json({ items: rows.map(mapDriver) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/", async (req, res) => {
    const { driverId, firstName, lastName, phone, licenseNumber } = req.body || {};
    const fn = String(firstName || "").trim();
    const ln = String(lastName || "").trim();
    if (!fn || !ln) {
      return res.status(400).json({ error: "firstName and lastName are required" });
    }
    let idKey = String(driverId || "").trim();
    if (!idKey) {
      try {
        idKey = await allocateUniqueSixDigit();
      } catch (e) {
        return res.status(500).json({ error: e.message || "Could not allocate driver ID" });
      }
    } else if (/^\d{6}$/.test(idKey)) {
      try {
        if (await isSixDigitTaken(idKey)) {
          return res.status(409).json({ error: "This 6-digit ID is already assigned to an attendant or driver" });
        }
      } catch (e) {
        return res.status(500).json({ error: e.message || "ID check failed" });
      }
    }
    try {
      const payload = {
        driverId: idKey,
        firstName: fn,
        lastName: ln,
        phone: phone != null ? String(phone).trim() || null : null,
        licenseNumber: licenseNumber != null ? String(licenseNumber).trim() || null : null,
        active: true,
      };
      // Same rule as OTP driver signup: 6-digit roster ID doubles as default ticket-correction PIN (hashed).
      if (/^\d{6}$/.test(idKey)) {
        payload.ticketEditPinHash = await bcrypt.hash(idKey, 10);
      }
      const doc = await Driver.create(payload);
      res.status(201).json(mapDriver(doc.toObject()));
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ error: "Driver ID already exists" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id/ticket-edit-auth", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      const driverMongoId = req.params.id;
      const [count, logs] = await Promise.all([
        DriverTicketEditLog.countDocuments({ driverId: driverMongoId }),
        DriverTicketEditLog.find({ driverId: driverMongoId })
          .sort({ createdAt: -1 })
          .limit(40)
          .lean(),
      ]);
      res.json({
        editCount: count,
        items: logs.map((x) => ({
          id: x._id.toString(),
          ticketMysqlId: x.ticketMysqlId,
          attendantOperatorId: x.attendantOperatorId,
          attendantName: x.attendantName || "",
          busNumber: x.busNumber || "",
          createdAt: x.createdAt ? new Date(x.createdAt).toISOString() : null,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      const d = await Driver.findById(req.params.id).lean();
      const out = mapDriver(d);
      if (!out) return res.status(404).json({ error: "Not found" });
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Update profile, license metadata, scan URL, expiry, experience. */
  router.patch("/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const body = req.body || {};
    const $set = {};

    if (body.firstName !== undefined) {
      const fn = String(body.firstName || "").trim();
      if (!fn) return res.status(400).json({ error: "firstName cannot be empty" });
      $set.firstName = fn;
    }
    if (body.lastName !== undefined) {
      const ln = String(body.lastName || "").trim();
      if (!ln) return res.status(400).json({ error: "lastName cannot be empty" });
      $set.lastName = ln;
    }
    if (body.middleName !== undefined) {
      $set.middleName =
        body.middleName != null && String(body.middleName).trim() ? String(body.middleName).trim() : null;
    }
    if (body.email !== undefined) {
      const em = body.email != null && String(body.email).trim() ? String(body.email).trim().toLowerCase() : null;
      if (em) {
        const clash = await Driver.findOne({ email: em, _id: { $ne: req.params.id } }).lean();
        if (clash) return res.status(409).json({ error: "Email already in use" });
      }
      $set.email = em;
    }
    if (body.phone !== undefined) {
      $set.phone = body.phone != null && String(body.phone).trim() ? String(body.phone).trim() : null;
    }

    if (body.licenseNumber !== undefined) {
      $set.licenseNumber = body.licenseNumber != null && String(body.licenseNumber).trim()
        ? String(body.licenseNumber).trim()
        : null;
    }
    if (body.licenseScanUrl !== undefined) {
      $set.licenseScanUrl =
        body.licenseScanUrl != null && String(body.licenseScanUrl).trim()
          ? String(body.licenseScanUrl).trim()
          : null;
    }
    if (body.licenseExpiresAt !== undefined) {
      if (body.licenseExpiresAt == null || body.licenseExpiresAt === "") {
        $set.licenseExpiresAt = null;
      } else {
        const dt = new Date(body.licenseExpiresAt);
        if (!Number.isFinite(dt.getTime())) {
          return res.status(400).json({ error: "Invalid licenseExpiresAt" });
        }
        $set.licenseExpiresAt = dt;
      }
    }
    if (body.yearsExperience !== undefined) {
      const y = Number(body.yearsExperience);
      $set.yearsExperience = Number.isFinite(y) && y >= 0 ? y : null;
    }

    if (body.ticketEditPin !== undefined) {
      const raw = String(body.ticketEditPin || "").trim();
      if (raw === "" || raw === null) {
        $set.ticketEditPinHash = null;
      } else if (!/^\d{6}$/.test(raw)) {
        return res.status(400).json({ error: "ticketEditPin must be exactly 6 digits" });
      } else {
        $set.ticketEditPinHash = await bcrypt.hash(raw, 10);
      }
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    try {
      const d = await Driver.findByIdAndUpdate(req.params.id, { $set }, { new: true }).lean();
      const out = mapDriver(d);
      if (!out) return res.status(404).json({ error: "Not found" });
      res.json(out);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ error: "Email already in use" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  /** Soft-delete (hide from roster and verified lists). */
  router.delete("/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      // Clear email so the address can be used again for driver signup (schema has unique email).
      const d = await Driver.findByIdAndUpdate(
        req.params.id,
        { active: false, email: null },
        { new: true }
      ).lean();
      if (!d) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createDriversRouter };
