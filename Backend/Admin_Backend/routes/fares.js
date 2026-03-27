const express = require("express");
const mongoose = require("mongoose");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const { requireTicketIssuerJwt } = require("../middleware/requireTicketIssuerJwt");
const FareGlobalSettings = require("../models/FareGlobalSettings");
const FareMatrixEntry = require("../models/FareMatrixEntry");
const FareChangeLog = require("../models/FareChangeLog");
const {
  getGlobalSettingsLean,
  discountPctForCategory,
  applyDiscount,
  findMatrixEntryByLabels,
  resolveEndpointToken,
  listFareLocationOptions,
  listFareLocationEndpointPairs,
} = require("../services/farePricing");

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function createFaresRouter() {
  const router = express.Router();

  router.get("/location-options", requireTicketIssuerJwt, async (_req, res) => {
    try {
      const options = await listFareLocationOptions();
      res.json({ options });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/location-endpoints", requireAdminJwt, async (_req, res) => {
    try {
      const { startOptions, endOptions } = await listFareLocationEndpointPairs();
      res.json({ startOptions, endOptions });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/settings", requireAdminJwt, async (_req, res) => {
    try {
      const doc = await getGlobalSettingsLean();
      res.json({
        studentDiscountPct: doc.studentDiscountPct,
        pwdDiscountPct: doc.pwdDiscountPct,
        seniorDiscountPct: doc.seniorDiscountPct,
        updatedAt: doc.updatedAt,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put("/settings", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const student = Number(body.studentDiscountPct);
      const pwd = Number(body.pwdDiscountPct);
      const senior = Number(body.seniorDiscountPct);
      if (![student, pwd, senior].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
        return res.status(400).json({ error: "Each discount must be a number from 0 to 100" });
      }

      const prev = await getGlobalSettingsLean();
      const doc = await FareGlobalSettings.findOneAndUpdate(
        { singletonKey: "global" },
        {
          $set: {
            singletonKey: "global",
            studentDiscountPct: student,
            pwdDiscountPct: pwd,
            seniorDiscountPct: senior,
          },
        },
        { upsert: true, new: true }
      ).lean();

      await FareChangeLog.create({
        kind: "discounts",
        actorEmail: req.admin?.email || "",
        summary: `Global discounts updated (Student ${student}%, PWD ${pwd}%, Senior ${senior}%)`,
        meta: {
          before: {
            studentDiscountPct: prev.studentDiscountPct,
            pwdDiscountPct: prev.pwdDiscountPct,
            seniorDiscountPct: prev.seniorDiscountPct,
          },
          after: { studentDiscountPct: student, pwdDiscountPct: pwd, seniorDiscountPct: senior },
        },
      });

      res.json({
        studentDiscountPct: doc.studentDiscountPct,
        pwdDiscountPct: doc.pwdDiscountPct,
        seniorDiscountPct: doc.seniorDiscountPct,
        updatedAt: doc.updatedAt,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/matrix", requireAdminJwt, async (_req, res) => {
    try {
      const items = await FareMatrixEntry.find().sort({ updatedAt: -1 }).lean();
      res.json({
        items: items.map((r) => ({
          _id: String(r._id),
          startLabel: r.startLabel,
          endLabel: r.endLabel,
          baseFarePesos: r.baseFarePesos,
          startCoverageId: String(r.startCoverageId),
          startKind: r.startKind,
          startStopSequence: r.startStopSequence,
          endCoverageId: String(r.endCoverageId),
          endKind: r.endKind,
          endStopSequence: r.endStopSequence,
          updatedAt: r.updatedAt,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/matrix", requireAdminJwt, async (req, res) => {
    try {
      const body = req.body || {};
      const startTok = body.startEndpoint;
      const endTok = body.endEndpoint;
      const base = Number(body.baseFarePesos);
      if (!Number.isFinite(base) || base < 0) {
        return res.status(400).json({ error: "baseFarePesos must be a non-negative number" });
      }

      const [a, b] = await Promise.all([resolveEndpointToken(startTok), resolveEndpointToken(endTok)]);
      if (a.error) return res.status(400).json({ error: `Start: ${a.error}` });
      if (b.error) return res.status(400).json({ error: `Destination: ${b.error}` });

      if (a.coverageId === b.coverageId && a.kind === b.kind && a.stopSequence === b.stopSequence) {
        return res.status(400).json({ error: "Start and destination must be different points" });
      }

      const doc = await FareMatrixEntry.findOneAndUpdate(
        {
          startCoverageId: a.coverageId,
          startKind: a.kind,
          startStopSequence: a.stopSequence,
          endCoverageId: b.coverageId,
          endKind: b.kind,
          endStopSequence: b.stopSequence,
        },
        {
          $set: {
            startNorm: a.norm,
            endNorm: b.norm,
            startLabel: a.label,
            endLabel: b.label,
            baseFarePesos: Math.round(base * 100) / 100,
          },
        },
        { upsert: true, new: true }
      ).lean();

      await FareChangeLog.create({
        kind: "matrix_upsert",
        actorEmail: req.admin?.email || "",
        summary: `Base fare ₱${doc.baseFarePesos.toFixed(2)}: ${doc.startLabel} → ${doc.endLabel}`,
        meta: {
          matrixId: String(doc._id),
          baseFarePesos: doc.baseFarePesos,
          startLabel: doc.startLabel,
          endLabel: doc.endLabel,
        },
      });

      res.status(201).json({
        _id: String(doc._id),
        startLabel: doc.startLabel,
        endLabel: doc.endLabel,
        baseFarePesos: doc.baseFarePesos,
      });
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ error: "A matrix row for this route already exists" });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/matrix/:id", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    const id = String(req.params.id || "");
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });
    try {
      const r = await FareMatrixEntry.findByIdAndDelete(id).lean();
      if (!r) return res.status(404).json({ error: "Not found" });
      await FareChangeLog.create({
        kind: "matrix_delete",
        actorEmail: req.admin?.email || "",
        summary: `Removed fare row: ${r.startLabel} → ${r.endLabel}`,
        meta: { startLabel: r.startLabel, endLabel: r.endLabel },
      });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/history", requireAdminJwt, async (_req, res) => {
    try {
      const rows = await FareChangeLog.find().sort({ createdAt: -1 }).limit(100).lean();
      res.json({
        items: rows.map((x) => ({
          id: String(x._id),
          kind: x.kind,
          actorEmail: x.actorEmail,
          summary: x.summary,
          createdAt: x.createdAt,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/quote", requireTicketIssuerJwt, async (req, res) => {
    try {
      const body = req.body || {};
      const start = String(body.startLocation || "").trim();
      const dest = String(body.destination || "").trim();
      const category = String(body.passengerCategory || "adult").trim().toLowerCase();

      if (!start || !dest) {
        return res.status(400).json({ error: "startLocation and destination are required" });
      }

      const entry = await findMatrixEntryByLabels(start, dest);
      const settings = await getGlobalSettingsLean();

      if (!entry) {
        return res.json({
          matched: false,
          baseFarePesos: null,
          discountPct: null,
          fare: null,
          passengerCategory: category === "regular" ? "adult" : category,
          message: "No fare matrix row for this origin/destination pair",
        });
      }

      const cat =
        category === "regular" ? "adult" : ["student", "pwd", "senior"].includes(category) ? category : "adult";
      const pct = discountPctForCategory(settings, cat);
      const fare = applyDiscount(entry.baseFarePesos, pct);

      res.json({
        matched: true,
        baseFarePesos: entry.baseFarePesos,
        discountPct: pct,
        fare,
        passengerCategory: cat,
        startLabel: entry.startLabel,
        endLabel: entry.endLabel,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createFaresRouter };
