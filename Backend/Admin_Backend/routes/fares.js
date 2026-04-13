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
  findMatrixEntryByLabels,
  normalizeLocationLabel,
  resolveEndpointToken,
  listFareLocationOptions,
  listFareLocationEndpointPairs,
  computeTicketFare,
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
      const farePerKmPesos = Number(doc.farePerKmPesos);
      res.json({
        studentDiscountPct: doc.studentDiscountPct,
        pwdDiscountPct: doc.pwdDiscountPct,
        seniorDiscountPct: doc.seniorDiscountPct,
        farePerKmPesos: Number.isFinite(farePerKmPesos) ? farePerKmPesos : 0,
        hubChainCoverageIds: Array.isArray(doc.hubChainCoverageIds)
          ? doc.hubChainCoverageIds.map((id) => String(id))
          : [],
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
      const farePerKmPesos = Number(body.farePerKmPesos);
      if (![student, pwd, senior].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
        return res.status(400).json({ error: "Each discount must be a number from 0 to 100" });
      }
      if (!Number.isFinite(farePerKmPesos) || farePerKmPesos < 0) {
        return res.status(400).json({ error: "farePerKmPesos must be a non-negative number" });
      }

      const roundedFarePerKm = Math.round(farePerKmPesos * 100) / 100;
      const prev = await getGlobalSettingsLean();

      let hubChainCoverageIds = Array.isArray(prev.hubChainCoverageIds) ? prev.hubChainCoverageIds : [];
      if (body.hubChainCoverageIds !== undefined) {
        const raw = Array.isArray(body.hubChainCoverageIds) ? body.hubChainCoverageIds : [];
        hubChainCoverageIds = raw
          .map((id) => String(id || "").trim())
          .filter((id) => isOid(id))
          .map((id) => new mongoose.Types.ObjectId(id));
      }

      const doc = await FareGlobalSettings.findOneAndUpdate(
        { singletonKey: "global" },
        {
          $set: {
            singletonKey: "global",
            studentDiscountPct: student,
            pwdDiscountPct: pwd,
            seniorDiscountPct: senior,
            farePerKmPesos: roundedFarePerKm,
            hubChainCoverageIds,
          },
        },
        { upsert: true, new: true }
      ).lean();

      await FareChangeLog.create({
        kind: "discounts",
        actorEmail: req.admin?.email || "",
        summary: `Global fare settings updated (₱${roundedFarePerKm}/km; Student ${student}%, PWD ${pwd}%, Senior ${senior}%)`,
        meta: {
          before: {
            studentDiscountPct: prev.studentDiscountPct,
            pwdDiscountPct: prev.pwdDiscountPct,
            seniorDiscountPct: prev.seniorDiscountPct,
            farePerKmPesos: prev.farePerKmPesos,
          },
          after: {
            studentDiscountPct: student,
            pwdDiscountPct: pwd,
            seniorDiscountPct: senior,
            farePerKmPesos: roundedFarePerKm,
            hubChainCoverageIds: (hubChainCoverageIds || []).map(String),
          },
        },
      });

      const outFarePerKm = Number(doc?.farePerKmPesos);
      res.json({
        studentDiscountPct: doc.studentDiscountPct,
        pwdDiscountPct: doc.pwdDiscountPct,
        seniorDiscountPct: doc.seniorDiscountPct,
        farePerKmPesos: Number.isFinite(outFarePerKm) ? outFarePerKm : roundedFarePerKm,
        hubChainCoverageIds: Array.isArray(doc.hubChainCoverageIds)
          ? doc.hubChainCoverageIds.map((id) => String(id))
          : [],
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

      if (a.kind !== "terminal" || b.kind !== "terminal") {
        return res.status(400).json({
          error:
            "Matrix base fares must be between hub terminals only. Configure bus stops under Location management (optional km from start) and Fare per km — sub-stop surcharges are computed automatically.",
        });
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

  router.patch("/matrix/:id", requireAdminJwt, async (req, res) => {
    const id = String(req.params.id || "");
    if (!isOid(id)) return res.status(400).json({ error: "Invalid id" });
    const base = Number((req.body || {}).baseFarePesos);
    if (!Number.isFinite(base) || base < 0) {
      return res.status(400).json({ error: "baseFarePesos must be a non-negative number" });
    }
    const rounded = Math.round(base * 100) / 100;
    try {
      const prev = await FareMatrixEntry.findById(id).lean();
      if (!prev) return res.status(404).json({ error: "Not found" });
      const doc = await FareMatrixEntry.findByIdAndUpdate(id, { $set: { baseFarePesos: rounded } }, { new: true }).lean();
      await FareChangeLog.create({
        kind: "matrix_patch",
        actorEmail: req.admin?.email || "",
        summary: `Base fare ₱${doc.baseFarePesos.toFixed(2)}: ${doc.startLabel} → ${doc.endLabel}`,
        meta: {
          matrixId: String(doc._id),
          before: prev.baseFarePesos,
          after: doc.baseFarePesos,
          startLabel: doc.startLabel,
          endLabel: doc.endLabel,
        },
      });
      res.json({
        _id: String(doc._id),
        startLabel: doc.startLabel,
        endLabel: doc.endLabel,
        baseFarePesos: doc.baseFarePesos,
        updatedAt: doc.updatedAt,
      });
    } catch (e) {
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

      const cat =
        category === "regular" ? "adult" : ["student", "pwd", "senior"].includes(category) ? category : "adult";
      const pricing = await computeTicketFare({
        startLocation: start,
        destination: dest,
        category: cat,
        clientFare: null,
      });

      if (!pricing.matched) {
        const custom =
          typeof pricing.message === "string" && pricing.message.trim() ? pricing.message.trim() : "";
        return res.json({
          matched: false,
          baseFarePesos: null,
          discountPct: null,
          fare: null,
          passengerCategory: cat,
          pricingMode: pricing.pricingMode || "unmatched",
          message: custom
            ? custom
            : pricing.pricingMode === "pre_terminal_unpriced"
              ? "Early drop-off fare needs Fare per Km in Admin (Fare Management)."
              : "No priced path for this trip — add hub-to-hub matrix legs for each segment, and/or set the linear hub chain in Admin (Fare Management).",
        });
      }

      const entry = await findMatrixEntryByLabels(start, dest);
      const sn = normalizeLocationLabel(start);
      const en = normalizeLocationLabel(dest);
      const entryLabelsForTicket =
        entry && entry.startNorm === sn && entry.endNorm === en
          ? { startLabel: entry.startLabel, endLabel: entry.endLabel }
          : entry
            ? { startLabel: start, endLabel: dest }
            : null;
      const matrixLabels =
        (pricing.pricingMode === "hub_matrix_plus_distance" ||
          pricing.pricingMode === "hub_multi_segment_matrix" ||
          pricing.pricingMode === "hub_linear_chain_matrix") &&
        pricing.hubStartLabel &&
        pricing.hubEndLabel
          ? { startLabel: pricing.hubStartLabel, endLabel: pricing.hubEndLabel }
          : pricing.pricingMode === "intra_hub_per_km"
            ? { startLabel: start, endLabel: dest }
            : entryLabelsForTicket || { startLabel: start, endLabel: dest };

      res.json({
        matched: true,
        baseFarePesos: pricing.baseFarePesos,
        discountPct: pricing.discountPct,
        fare: pricing.fare,
        passengerCategory: pricing.categoryUsed,
        startLabel: matrixLabels.startLabel,
        endLabel: matrixLabels.endLabel,
        pricingMode: pricing.pricingMode,
        farePerKmPesos: pricing.farePerKmPesos,
        extraDistanceKm: pricing.extraDistanceKm,
        distanceChargePesos: pricing.distanceChargePesos,
        subtotalRoundedHalfPeso: pricing.subtotalRoundedHalfPeso,
        hubStartLabel: pricing.hubStartLabel,
        hubEndLabel: pricing.hubEndLabel,
        preTerminalDestination: pricing.preTerminalDestination,
        originSpurKm: pricing.originSpurKm ?? null,
        destinationSpurKm: pricing.destinationSpurKm ?? null,
        pricingSummary:
          typeof pricing.pricingSummary === "string" && pricing.pricingSummary.trim()
            ? pricing.pricingSummary.trim()
            : null,
        fareBreakdownDisplay:
          typeof pricing.fareBreakdownDisplay === "string" && pricing.fareBreakdownDisplay.trim()
            ? pricing.fareBreakdownDisplay.trim()
            : null,
        segmentFares: Array.isArray(pricing.segmentFares)
          ? pricing.segmentFares.map((s) => ({
              fromLabel: s.fromLabel,
              toLabel: s.toLabel,
              basePesos: s.basePesos,
            }))
          : null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createFaresRouter };
