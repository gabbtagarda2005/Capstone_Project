const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireTicketIssuerJwt } = require("../middleware/requireTicketIssuerJwt");
const { incrementBusTicketsIssued, normalizeBusId } = require("../services/busMaintenance");
const Bus = require("../models/Bus");
const Driver = require("../models/Driver");
const DriverTicketEditLog = require("../models/DriverTicketEditLog");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const PortalUser = require("../models/PortalUser");
const { buildMongoTicketMatch } = require("../utils/mongoTicketQueryFromQuery");
const { computeTicketFare } = require("../services/farePricing");
const { buildOperatorBusQuery } = require("../services/attendantGpsIngest");
const { sendTicketSMS, normalizePhilippineMobileE164 } = require("../services/smsService");

function isMongoTicketId(s) {
  const t = String(s || "").trim();
  return /^[a-f0-9]{24}$/i.test(t) && mongoose.Types.ObjectId.isValid(t);
}

function stableNumberFromString(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483000 || 1;
}

function mapMongoDocToAdminItem(doc) {
  const issuedNum =
    doc.issuerMysqlId != null && Number.isFinite(Number(doc.issuerMysqlId))
      ? Number(doc.issuerMysqlId)
      : stableNumberFromString(doc.issuerSub);
  const dest = doc.destination != null ? String(doc.destination) : "";
  const destLoc = doc.destinationLocation != null && String(doc.destinationLocation).trim() ? String(doc.destinationLocation).trim() : dest;
  return {
    id: String(doc._id),
    passengerId: doc.passengerId,
    startLocation: doc.startLocation,
    destination: dest,
    destinationLocation: destLoc,
    fare: Number(doc.fare),
    busOperatorName: doc.issuedByName ? String(doc.issuedByName).trim() : "",
    issuedByOperatorId: issuedNum,
    busNumber: doc.busNumber || null,
    createdAt: doc.createdAt,
  };
}

function signMongoTicketEditToken({ ticketMongoId, driverMongoId, busNumber, issuerSub }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return jwt.sign(
    {
      typ: "ticket_edit_mongo",
      tid: String(ticketMongoId),
      did: String(driverMongoId),
      bus: String(busNumber || ""),
      opsub: String(issuerSub || ""),
    },
    secret,
    { expiresIn: "10m" }
  );
}

function readMongoTicketEditToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  const p = jwt.verify(String(token || ""), secret);
  if (p.typ !== "ticket_edit_mongo") {
    const err = new Error("Invalid edit token");
    err.statusCode = 403;
    throw err;
  }
  return p;
}

function createTicketsTicketingRouter() {
  const router = express.Router();

  router.get("/stats", requireAdminJwt, async (req, res) => {
    try {
      const match = buildMongoTicketMatch(req.query);
      const totalTicketCount = await IssuedTicketRecord.countDocuments({});
      const agg = await IssuedTicketRecord.aggregate([
        { $match: match },
        { $group: { _id: null, c: { $sum: 1 }, revenue: { $sum: "$fare" } } },
      ]);
      const row = agg[0];
      return res.json({
        totalTicketCount,
        filteredCount: row ? row.c : 0,
        filteredRevenue: row ? Number(row.revenue) : 0,
        ticketingDisabled: false,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get("/", requireAdminJwt, async (req, res) => {
    try {
      const match = buildMongoTicketMatch(req.query);
      const docs = await IssuedTicketRecord.find(match).sort({ createdAt: -1 }).limit(3000).lean();
      return res.json({ items: docs.map(mapMongoDocToAdminItem), ticketingDisabled: false });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * Issue ticket (Bus Attendant app). Persists to `issued_ticket_records`; increments Mongo bus counter when busNumber is sent.
   */
  router.post("/issue", requireTicketIssuerJwt, async (req, res) => {
    const {
      passengerId,
      startLocation,
      destination,
      fare,
      issuedByName,
      busNumber,
      passengerCategory,
      passengerPhone,
    } = req.body || {};
    const pid = String(passengerId || "").trim();
    const start = String(startLocation || "").trim();
    const dest = String(destination || "").trim();
    const fareNum = fare != null ? Number(fare) : NaN;

    if (!pid || !start || !dest) {
      return res.status(400).json({ error: "passengerId, startLocation, and destination are required" });
    }

    const catRaw = String(passengerCategory || "adult").trim().toLowerCase();
    const pricing = await computeTicketFare({
      startLocation: start,
      destination: dest,
      category: catRaw,
      clientFare: fareNum,
    });

    if (!pricing.matched && (!Number.isFinite(pricing.fare) || pricing.fare < 0)) {
      return res.status(400).json({
        error:
          "fare must be a non-negative number when no fare matrix applies to this route (or add a matrix row in Admin)",
      });
    }

    const fareNumFinal = pricing.fare;
    const issuerSub = String(req.ticketingUser.sub || "").trim();
    const busNorm = busNumber != null && String(busNumber).trim() ? normalizeBusId(busNumber) : null;

    const catStore = String(pricing.categoryUsed || catRaw || "regular").trim().toLowerCase() || "regular";
    const pricingPayload = pricing.matched
      ? {
          matched: true,
          baseFarePesos: pricing.baseFarePesos,
          discountPct: pricing.discountPct,
          passengerCategory: pricing.categoryUsed,
          pricingMode: pricing.pricingMode,
          farePerKmPesos: pricing.farePerKmPesos,
          extraDistanceKm: pricing.extraDistanceKm,
          distanceChargePesos: pricing.distanceChargePesos,
          hubStartLabel: pricing.hubStartLabel,
          hubEndLabel: pricing.hubEndLabel,
          subtotalRoundedHalfPeso: pricing.subtotalRoundedHalfPeso,
          preTerminalDestination: pricing.preTerminalDestination,
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
        }
      : { matched: false, pricingMode: pricing.pricingMode };

    const nameRaw = String(issuedByName || "").trim();
    let issuedName = nameRaw;
    if (!issuedName) {
      if (/^[a-f0-9]{24}$/i.test(issuerSub)) {
        try {
          const user = await PortalUser.findById(issuerSub).select("firstName lastName email").lean();
          if (user) {
            issuedName =
              [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || String(user.email || "").trim();
          }
        } catch {
          /* ignore */
        }
      }
      if (!issuedName) {
        issuedName = String(req.ticketingUser.email || "").trim() || "Operator";
      }
    }
    const issuerMysqlId = Number(issuerSub);
    const roleCompact = String(req.ticketingUser.role || "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "");
    if (req.ticketingUser.role !== "Admin" && (roleCompact === "operator" || roleCompact === "busattendant")) {
      const q = buildOperatorBusQuery(issuerSub);
      if (q) {
        const assignBus = await Bus.findOne(q).select("status").lean();
        if (assignBus && String(assignBus.status || "").trim() === "Inactive") {
          return res.status(403).json({
            error:
              "Your assigned bus has been deactivated. You cannot issue tickets until an administrator reactivates it.",
          });
        }
      }
    }
    const phoneRaw = passengerPhone != null ? String(passengerPhone).trim() : "";
    const phoneStored = phoneRaw || null;

    try {
      const doc = await IssuedTicketRecord.create({
        passengerId: pid,
        passengerName: String(req.body?.passengerName || "").trim() || "Walk-in Passenger",
        passengerPhone: phoneStored,
        startLocation: start,
        destination: dest,
        destinationLocation: dest,
        fare: fareNumFinal,
        passengerCategory: catStore,
        issuerSub,
        issuerMysqlId: Number.isFinite(issuerMysqlId) && issuerMysqlId >= 1 ? issuerMysqlId : null,
        issuedByName: issuedName,
        busNumber: busNorm,
        boardingStatus: "boarded",
      });
      let busCounter = null;
      if (busNorm) {
        busCounter = await incrementBusTicketsIssued(busNorm);
      }
      const idStr = String(doc._id);
      const opOut = Number.isFinite(issuerMysqlId) && issuerMysqlId >= 1 ? issuerMysqlId : stableNumberFromString(issuerSub);

      let sms = { attempted: false, ok: false };
      const toE164 = phoneRaw ? normalizePhilippineMobileE164(phoneRaw) : null;
      if (toE164) {
        sms.attempted = true;
        const shortId = idStr.slice(-6).toUpperCase();
        try {
          const r = await sendTicketSMS(toE164, {
            ticketId: shortId,
            origin: start,
            destination: dest,
            fare: fareNumFinal,
            category: catStore,
          });
          sms.ok = r.success === true;
          if (!r.success && r.error) sms.error = r.error;
          if (r.skipped) sms.skipped = true;
        } catch (smsErr) {
          console.warn("[tickets/issue] SMS failed:", smsErr.message || smsErr);
          sms.error = smsErr.message || String(smsErr);
        }
      } else if (phoneRaw) {
        sms = { attempted: true, ok: false, error: "Invalid Philippine mobile number" };
      }

      return res.status(201).json({
        id: idStr,
        ticketCode: `TKT-${idStr.slice(-8).toUpperCase()}`,
        passengerId: pid,
        passengerName: doc.passengerName,
        passengerPhone: phoneStored,
        startLocation: start,
        destination: dest,
        destinationLocation: dest,
        fare: fareNumFinal,
        category: catStore,
        createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
        pricing: pricingPayload,
        issuedByOperatorId: opOut,
        busNumber: busNorm,
        busTicketCounter: busCounter,
        sms,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.get("/recent/me", requireTicketIssuerJwt, async (req, res) => {
    try {
      const sub = String(req.ticketingUser.sub || "").trim();
      const docs = await IssuedTicketRecord.find({ issuerSub: sub }).sort({ createdAt: -1 }).limit(60).lean();
      return res.json({
        items: docs.map((t) => ({
          id: String(t._id),
          ticketCode: `TKT-${String(t._id).slice(-8).toUpperCase()}`,
          passengerId: t.passengerId,
          passengerName: t.passengerName || "Passenger",
          from: t.startLocation,
          to: t.destination,
          category:
            t.passengerCategory != null && String(t.passengerCategory).trim()
              ? String(t.passengerCategory).trim()
              : "regular",
          fare: Number(t.fare),
          busNumber: t.busNumber || null,
          createdAt: t.createdAt,
        })),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  /**
   * Driver 6-digit PIN → short-lived token for PATCH /tickets/:id (Mongo tickets only).
   */
  router.post("/verify-edit-pin", requireTicketIssuerJwt, async (req, res) => {
    const { busNumber, pin, ticketId } = req.body || {};
    const pinStr = String(pin || "").trim();
    const busRaw = String(busNumber || "").trim();
    const ticketIdStr = String(ticketId || "").trim();
    if (!busRaw || !pinStr || !ticketIdStr) {
      return res.status(400).json({ error: "busNumber, pin, and ticketId are required" });
    }
    if (!/^\d{6}$/.test(pinStr)) {
      return res.status(400).json({ error: "PIN must be exactly 6 digits" });
    }
    if (!isMongoTicketId(ticketIdStr)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    const busNorm = normalizeBusId(busRaw);
    const issuerSub = String(req.ticketingUser.sub || "").trim();

    try {
      const doc = await IssuedTicketRecord.findById(ticketIdStr).lean();
      if (!doc) return res.status(404).json({ error: "Ticket not found" });
      if (String(doc.issuerSub || "") !== issuerSub) {
        return res.status(403).json({ error: "You can only edit tickets you issued" });
      }
      const ticketBus = doc.busNumber ? normalizeBusId(doc.busNumber) : null;
      if (!ticketBus || ticketBus !== busNorm) {
        return res.status(400).json({ error: "Ticket does not match this bus. Check assignment." });
      }

      const busDoc = await Bus.findOne({ busId: busNorm }).select("driverId").lean();
      if (!busDoc?.driverId) {
        return res.status(400).json({ error: "No driver assigned to this bus in fleet registry" });
      }
      const driver = await Driver.findById(busDoc.driverId).select("ticketEditPinHash firstName lastName").lean();
      if (!driver?.ticketEditPinHash) {
        return res.status(403).json({
          error: "Driver has no ticket-edit PIN set. Admin can set a 6-digit PIN in Driver management.",
        });
      }
      const pinOk = await bcrypt.compare(pinStr, driver.ticketEditPinHash);
      if (!pinOk) {
        return res.status(401).json({ error: "Incorrect driver PIN" });
      }

      const editToken = signMongoTicketEditToken({
        ticketMongoId: String(doc._id),
        driverMongoId: String(driver._id),
        busNumber: busNorm,
        issuerSub,
      });

      return res.json({
        ok: true,
        editToken,
        driverName: [driver.firstName, driver.lastName].filter(Boolean).join(" ").trim() || "Driver",
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  /** Admin portal: correct ticket rows (no operator PIN). */
  router.patch("/portal/:id", requireAdminJwt, async (req, res) => {
    const ticketKey = String(req.params.id || "").trim();
    if (!isMongoTicketId(ticketKey)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    const body = req.body || {};
    const start = body.startLocation != null ? String(body.startLocation).trim() : null;
    const dest = body.destination != null ? String(body.destination).trim() : null;
    const fareRaw = body.fare;
    const pid = body.passengerId != null ? String(body.passengerId).trim() : null;
    if (!start || !dest) {
      return res.status(400).json({ error: "startLocation and destination are required" });
    }
    const fareNum = fareRaw != null ? Number(fareRaw) : NaN;
    if (!Number.isFinite(fareNum) || fareNum < 0) {
      return res.status(400).json({ error: "fare must be a non-negative number" });
    }
    try {
      const doc = await IssuedTicketRecord.findById(ticketKey).lean();
      if (!doc) return res.status(404).json({ error: "Ticket not found" });
      const $set = {
        startLocation: start,
        destination: dest,
        destinationLocation: dest,
        fare: fareNum,
      };
      if (pid) {
        $set.passengerId = pid;
      }
      await IssuedTicketRecord.updateOne({ _id: ticketKey }, { $set });
      const updated = await IssuedTicketRecord.findById(ticketKey).lean();
      return res.json(mapMongoDocToAdminItem(updated));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.delete("/portal/:id", requireAdminJwt, async (req, res) => {
    const ticketKey = String(req.params.id || "").trim();
    if (!isMongoTicketId(ticketKey)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    try {
      const r = await IssuedTicketRecord.deleteOne({ _id: ticketKey });
      if (!r.deletedCount) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      return res.json({ ok: true, deletedId: ticketKey });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.patch("/:id", requireTicketIssuerJwt, async (req, res) => {
    const ticketKey = String(req.params.id || "").trim();
    const editTok = String(req.headers["x-ticket-edit-token"] || "").trim();
    if (!editTok) {
      return res.status(400).json({ error: "X-Ticket-Edit-Token header required" });
    }

    const body = req.body || {};
    const start = body.startLocation != null ? String(body.startLocation).trim() : null;
    const dest = body.destination != null ? String(body.destination).trim() : null;
    const fareRaw = body.fare;
    const catRaw = body.passengerCategory != null ? String(body.passengerCategory).trim().toLowerCase() : null;

    if (!start || !dest) {
      return res.status(400).json({ error: "startLocation and destination are required" });
    }
    const fareNum = fareRaw != null ? Number(fareRaw) : NaN;
    if (!Number.isFinite(fareNum) || fareNum < 0) {
      return res.status(400).json({ error: "fare must be a non-negative number" });
    }

    const cat = catRaw && catRaw.length ? catRaw : "regular";
    const issuerSub = String(req.ticketingUser.sub || "").trim();

    if (!isMongoTicketId(ticketKey)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }

    let mclaims;
    try {
      mclaims = readMongoTicketEditToken(editTok);
    } catch (e) {
      const code = e.statusCode || 401;
      return res.status(code).json({ error: e.message || "Invalid edit token" });
    }
    if (String(mclaims.tid) !== ticketKey || String(mclaims.opsub || "") !== issuerSub) {
      return res.status(403).json({ error: "Edit token does not match this ticket or operator" });
    }

    let issuedName = String(body.issuedByName || "").trim();
    if (!issuedName) {
      if (/^[a-f0-9]{24}$/i.test(issuerSub)) {
        try {
          const user = await PortalUser.findById(issuerSub).select("firstName lastName email").lean();
          if (user) {
            issuedName =
              [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || String(user.email || "").trim();
          }
        } catch {
          /* ignore */
        }
      }
      if (!issuedName) {
        issuedName = String(req.ticketingUser.email || "").trim() || "Operator";
      }
    }

    try {
      const doc = await IssuedTicketRecord.findById(ticketKey).lean();
      if (!doc) return res.status(404).json({ error: "Ticket not found" });
      if (String(doc.issuerSub || "") !== issuerSub) {
        return res.status(403).json({ error: "You can only edit tickets you issued" });
      }
      const ticketBus = doc.busNumber ? normalizeBusId(doc.busNumber) : null;
      if (!ticketBus || ticketBus !== mclaims.bus) {
        return res.status(403).json({ error: "Ticket bus does not match authorization" });
      }

      const ur = await IssuedTicketRecord.updateOne(
        { _id: ticketKey, issuerSub },
        {
          $set: {
            startLocation: start,
            destination: dest,
            destinationLocation: dest,
            fare: fareNum,
            passengerCategory: cat,
            issuedByName: issuedName,
          },
        }
      );
      if (!ur.matchedCount) {
        return res.status(404).json({ error: "Ticket not updated" });
      }

      const opNum = Number(issuerSub);
      await DriverTicketEditLog.create({
        driverId: mclaims.did,
        ticketMysqlId: null,
        ticketMongoId: new mongoose.Types.ObjectId(String(mclaims.tid)),
        attendantOperatorId: Number.isFinite(opNum) && opNum >= 1 ? opNum : null,
        attendantIssuerSub: issuerSub,
        attendantName: issuedName,
        busNumber: mclaims.bus,
      });

      const tail = String(mclaims.tid).slice(-8).toUpperCase();
      return res.json({
        ok: true,
        id: String(mclaims.tid),
        ticketCode: `TKT-${tail}`,
        startLocation: start,
        destination: dest,
        destinationLocation: dest,
        fare: fareNum,
        category: cat,
        lastEditedByDriverId: String(mclaims.did),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createTicketsTicketingRouter };
