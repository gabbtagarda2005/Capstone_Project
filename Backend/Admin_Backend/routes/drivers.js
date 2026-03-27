const express = require("express");
const mongoose = require("mongoose");
const Driver = require("../models/Driver");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");

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
    yearsExperience: d.yearsExperience != null ? Number(d.yearsExperience) : null,
    profileImageUrl: d.profileImageUrl || null,
    licenseScanUrl: d.licenseScanUrl || null,
    otpVerified: Boolean(d.verifiedViaOtpAt),
    active: d.active !== false,
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
    const idKey = String(driverId || "").trim();
    const fn = String(firstName || "").trim();
    const ln = String(lastName || "").trim();
    if (!idKey || !fn || !ln) {
      return res.status(400).json({ error: "driverId, firstName, and lastName are required" });
    }
    try {
      const doc = await Driver.create({
        driverId: idKey,
        firstName: fn,
        lastName: ln,
        phone: phone != null ? String(phone).trim() || null : null,
        licenseNumber: licenseNumber != null ? String(licenseNumber).trim() || null : null,
        active: true,
      });
      res.status(201).json(mapDriver(doc.toObject()));
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ error: "Driver ID already exists" });
      }
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

  /** Soft-delete (hide from roster and verified lists). */
  router.delete("/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    try {
      const d = await Driver.findByIdAndUpdate(req.params.id, { active: false }, { new: true }).lean();
      if (!d) return res.status(404).json({ error: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createDriversRouter };
