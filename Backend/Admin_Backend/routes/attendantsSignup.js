const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const { normalizeEmail } = require("../config/adminWhitelist");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireAttendantSignupJwt } = require("../middleware/requireAttendantSignupJwt");
const AttendantSignupOtp = require("../models/AttendantSignupOtp");
const AttendantRegistry = require("../models/AttendantRegistry");
const AttendantAssignmentHistory = require("../models/AttendantAssignmentHistory");
const Bus = require("../models/Bus");
const PortalUser = require("../models/PortalUser");
const { sendAttendantSignupOtpEmail } = require("../services/mailer");
const { allocateUniqueSixDigit } = require("../services/personnelSixDigit");
const { isValidYmd, manilaDayStartUtc, manilaDayEndUtc } = require("../services/manilaTime");
const { ensureAssignmentRecorded } = require("../services/attendantAssignmentHistory");

const MAX_PROFILE_IMAGE_CHARS = 400_000;

function resolveOperatorIdParam(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (mongoose.isValidObjectId(s)) {
    return { kind: "portal", portalUserId: new mongoose.Types.ObjectId(s) };
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    return { kind: "mysql", mysqlOperatorId: Math.trunc(n) };
  }
  return null;
}

async function findRegistryByOperatorParam(raw) {
  const spec = resolveOperatorIdParam(raw);
  if (!spec) return null;
  if (spec.kind === "portal") {
    return AttendantRegistry.findOne({ portalUserId: spec.portalUserId });
  }
  return AttendantRegistry.findOne({ mysqlOperatorId: spec.mysqlOperatorId });
}

/**
 * Ensure registry + PortalUser (+ MySQL employee_id when empty) have a valid 6-digit personnel ID.
 * @param {object} reg - lean AttendantRegistry doc (mutated in memory if you reuse it)
 */
async function ensureRegistrySixDigitPersonnel(reg) {
  const raw = reg.employeeNumber != null ? String(reg.employeeNumber).trim() : "";
  if (/^\d{6}$/.test(raw)) {
    return { employeeId: raw, allocated: false };
  }
  const code = await allocateUniqueSixDigit();
  await AttendantRegistry.updateOne({ _id: reg._id }, { $set: { employeeNumber: code } });
  reg.employeeNumber = code;
  if (reg.portalUserId) {
    await PortalUser.updateOne({ _id: reg.portalUserId }, { $set: { employeeNumber: code } });
  }
  return { employeeId: code, allocated: true };
}

async function emailExistsInTicketing(email) {
  const mongoUser = await PortalUser.findOne({ email }).lean();
  if (mongoUser) return { exists: true, source: "mongo" };
  return { exists: false };
}

function signAttendantSignupToken(email, secret) {
  return jwt.sign(
    { purpose: "attendant_signup", email },
    secret,
    { expiresIn: process.env.ATTENDANT_SIGNUP_JWT_EXPIRES_IN || "20m" }
  );
}

function createAttendantsSignupRouter() {
  const router = express.Router();

  /**
   * Attendants who completed Gmail OTP and are eligible for bus assignment.
   * Links use portalUserId and/or legacy mysqlOperatorId on the registry document.
   */
  router.get("/verified", requireAdminJwt, async (_req, res) => {
    try {
      const regs = await AttendantRegistry.find({
        verifiedViaOtpAt: { $exists: true, $ne: null },
        $or: [
          { mysqlOperatorId: { $exists: true, $ne: null } },
          { portalUserId: { $exists: true, $ne: null } },
        ],
      })
        .sort({ lastName: 1, firstName: 1 })
        .lean();

      for (const reg of regs) {
        const raw = reg.employeeNumber != null ? String(reg.employeeNumber).trim() : "";
        if (/^\d{6}$/.test(raw)) continue;
        try {
          await ensureRegistrySixDigitPersonnel(reg);
        } catch (backErr) {
          console.error("[attendants/verified] employeeNumber backfill:", backErr.message || backErr);
        }
      }

      const items = regs
        .map((r) => {
          const attendantId =
            r.portalUserId != null ? String(r.portalUserId) : r.mysqlOperatorId != null ? String(r.mysqlOperatorId) : null;
          if (!attendantId) return null;
          return {
            operatorId: attendantId,
            employeeId: r.employeeNumber || null,
            firstName: r.firstName,
            lastName: r.lastName,
            middleName: r.middleName,
            email: r.email,
            phone: r.phone,
            role: "Operator",
            otpVerified: true,
            profileImageUrl: r.profileImageUrl || null,
          };
        })
        .filter(Boolean);

      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Day-by-day trail of which bus this attendant was assigned to (Management → Attendants →
   * assignment history). Optional `date=YYYY-MM-DD` (Manila calendar day) also resolves which
   * single assignment, if any, was active that day.
   */
  router.get("/:id/assignment-history", requireAdminJwt, async (req, res) => {
    try {
      const spec = resolveOperatorIdParam(req.params.id);
      if (!spec) return res.status(400).json({ error: "Invalid attendant id" });
      const key = spec.kind === "portal" ? `portal:${String(spec.portalUserId)}` : `mysql:${spec.mysqlOperatorId}`;

      // Self-heal: an assignment made before this feature existed (or otherwise missed) has no
      // history row yet — backfill from the bus's own current assignment before reading history.
      const currentBusQuery =
        spec.kind === "portal" ? { operatorPortalUserId: spec.portalUserId } : { operatorMysqlId: spec.mysqlOperatorId };
      const currentBus = await Bus.findOne(currentBusQuery)
        .select("busId busNumber operatorPortalUserId operatorMysqlId createdAt lastUpdated")
        .lean();
      if (currentBus) {
        await ensureAssignmentRecorded(currentBus).catch((e) =>
          console.warn("[assignment-history] ensureAssignmentRecorded:", e.message || e)
        );
      }

      const dateRaw = typeof req.query.date === "string" ? req.query.date.trim() : "";
      let activeOnDate = null;
      if (dateRaw) {
        if (!isValidYmd(dateRaw)) {
          return res.status(400).json({ error: "date must be YYYY-MM-DD" });
        }
        const dayStart = manilaDayStartUtc(dateRaw);
        const dayEnd = manilaDayEndUtc(dateRaw);
        const row = await AttendantAssignmentHistory.findOne({
          attendantKey: key,
          assignedAt: { $lte: dayEnd },
          $or: [{ unassignedAt: null }, { unassignedAt: { $gte: dayStart } }],
        })
          .sort({ assignedAt: -1 })
          .lean();
        activeOnDate = row
          ? { busId: row.busId, busNumber: row.busNumber, assignedAt: row.assignedAt, unassignedAt: row.unassignedAt }
          : null;
      }

      const rows = await AttendantAssignmentHistory.find({ attendantKey: key })
        .sort({ assignedAt: -1 })
        .limit(200)
        .lean();

      res.json({
        items: rows.map((r) => ({
          busId: r.busId,
          busNumber: r.busNumber,
          assignedAt: r.assignedAt,
          unassignedAt: r.unassignedAt,
        })),
        date: dateRaw || null,
        activeOnDate,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || "Could not load assignment history" });
    }
  });

  /** Assign or reveal the 6-digit personnel ID for a verified attendant (admin). */
  router.post("/registry/:operatorId/ensure-personnel-id", requireAdminJwt, async (req, res) => {
    try {
      const regDoc = await findRegistryByOperatorParam(req.params.operatorId);
      if (!regDoc) {
        return res.status(404).json({ error: "Verified attendant not found" });
      }
      const reg = regDoc.toObject ? regDoc.toObject() : { ...regDoc };
      const out = await ensureRegistrySixDigitPersonnel(reg);
      return res.json({ employeeId: out.employeeId, allocated: out.allocated });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Could not assign personnel ID" });
    }
  });

  /**
   * Update a verified attendant (registry + PortalUser and/or MySQL bus_operators).
   */
  router.patch("/registry/:operatorId", requireAdminJwt, async (req, res) => {
    try {
      const reg = await findRegistryByOperatorParam(req.params.operatorId);
      if (!reg) {
        return res.status(404).json({ error: "Verified attendant not found" });
      }
      const body = req.body || {};
      const firstName = body.firstName !== undefined ? String(body.firstName).trim() : undefined;
      const lastName = body.lastName !== undefined ? String(body.lastName).trim() : undefined;
      const middleName =
        body.middleName !== undefined ? (body.middleName ? String(body.middleName).trim() : null) : undefined;
      const phone = body.phone !== undefined ? (body.phone ? String(body.phone).trim() : null) : undefined;

      if (firstName !== undefined) reg.firstName = firstName;
      if (lastName !== undefined) reg.lastName = lastName;
      if (middleName !== undefined) reg.middleName = middleName;
      if (phone !== undefined) reg.phone = phone;
      if (!reg.firstName || !reg.lastName) {
        return res.status(400).json({ error: "firstName and lastName are required" });
      }
      await reg.save();

      if (reg.portalUserId) {
        const pu = {};
        if (firstName !== undefined) pu.firstName = reg.firstName;
        if (lastName !== undefined) pu.lastName = reg.lastName;
        if (middleName !== undefined) pu.middleName = reg.middleName;
        if (phone !== undefined) pu.phone = reg.phone;
        if (Object.keys(pu).length) {
          await PortalUser.updateOne({ _id: reg.portalUserId }, { $set: pu });
        }
      }

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Update failed" });
    }
  });

  /**
   * Remove attendant: registry + PortalUser and/or MySQL row (ticket safety same as operators).
   */
  router.delete("/registry/:operatorId", requireAdminJwt, async (req, res) => {
    try {
      const reg = await findRegistryByOperatorParam(req.params.operatorId);

      if (reg) {
        let ticketCount = 0;
        if (reg.portalUserId) {
          ticketCount = await IssuedTicketRecord.countDocuments({ issuerSub: String(reg.portalUserId) });
        }
        if (ticketCount === 0 && reg.mysqlOperatorId != null) {
          ticketCount = await IssuedTicketRecord.countDocuments({ issuerMysqlId: reg.mysqlOperatorId });
        }
        if (ticketCount > 0) {
          return res.status(409).json({
            error: "This attendant has issued tickets; reassign or delete tickets first",
            ticketCount,
          });
        }
        if (reg.portalUserId) {
          await PortalUser.deleteOne({ _id: reg.portalUserId });
        }
        await AttendantRegistry.deleteOne({ _id: reg._id });
        return res.status(204).send();
      }

      const spec = resolveOperatorIdParam(req.params.operatorId);
      if (spec?.kind === "mysql") {
        const id = spec.mysqlOperatorId;
        const ticketCount = await IssuedTicketRecord.countDocuments({ issuerMysqlId: id });
        if (ticketCount > 0) {
          return res.status(409).json({
            error: "Operator has issued tickets; delete or reassign tickets first",
            ticketCount,
          });
        }
        return res.status(404).json({ error: "Attendant not found" });
      }

      return res.status(404).json({ error: "Attendant not found" });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Delete failed" });
    }
  });

  /**
   * Step 1: ensure email is free, issue OTP to attendant Gmail.
   */
  router.post("/verify-email", requireAdminJwt, async (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(503).json({ error: "JWT_SECRET not configured" });

    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: "Email is required" });
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!validEmail) return res.status(400).json({ error: "Invalid email format" });

      const dup = await emailExistsInTicketing(email);
      if (dup.exists) {
        return res.status(409).json({ error: "This email is already registered" });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const count = await AttendantSignupOtp.countDocuments({ email, createdAt: { $gte: oneHourAgo } });
      if (count >= 5) {
        return res.status(429).json({ error: "Too many OTP requests for this email. Try again in about an hour." });
      }

      const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const otpDoc = await AttendantSignupOtp.create({
        email,
        otpHash,
        expiresAt,
        consumed: false,
        attempts: 0,
      });

      let sent;
      try {
        sent = await sendAttendantSignupOtpEmail({ to: email, otp });
      } catch (mailErr) {
        await AttendantSignupOtp.deleteOne({ _id: otpDoc._id });
        return res.status(502).json({
          error: mailErr.message || "Could not send email. Check SMTP_* settings in .env.",
        });
      }

      const payload = {
        message: sent.simulated
          ? "OTP generated. Email was not sent (configure SMTP in .env to deliver by mail)."
          : "OTP sent to the attendant’s email.",
        simulatedEmail: sent.simulated === true,
      };

      if (sent.simulated && process.env.NODE_ENV !== "production") {
        console.info(`[attendant signup OTP] ${email} → ${otp} (expires in 5 min — SMTP not configured)`);
        payload.hint =
          "No email was sent. The OTP is in the Admin_Backend terminal. Configure SMTP_* or set OTP_DEV_REVEAL=true.";
        if (process.env.OTP_DEV_REVEAL === "true") {
          payload.devOtp = otp;
        }
      }

      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to send OTP" });
    }
  });

  /**
   * Step 2: verify OTP; return short-lived JWT to unlock profile form.
   */
  router.post("/verify-otp", requireAdminJwt, async (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(503).json({ error: "JWT_SECRET not configured" });

    try {
      const email = normalizeEmail(req.body?.email);
      const otp = String(req.body?.otp || "").trim();
      if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "OTP must be 6 digits" });

      const row = await AttendantSignupOtp.findOne({ email, consumed: false }).sort({ createdAt: -1 });
      if (!row || row.expiresAt < new Date()) {
        return res.status(400).json({ error: "OTP is invalid or expired" });
      }
      if (row.attempts >= 5) {
        return res.status(429).json({ error: "Too many invalid attempts. Request a new OTP." });
      }

      const ok = await bcrypt.compare(otp, row.otpHash);
      if (!ok) {
        row.attempts += 1;
        await row.save();
        return res.status(400).json({ error: "Invalid OTP" });
      }

      row.consumed = true;
      await row.save();

      const signupToken = signAttendantSignupToken(email, secret);
      return res.json({
        message: "OTP verified",
        signupToken,
        email,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "OTP verification failed" });
    }
  });

  /**
   * Step 3: persist profile (JWT from verify-otp). MySQL bus_operators when configured, else PortalUser.
   */
  router.post("/save-attendant", requireAttendantSignupJwt, async (req, res) => {
    const email = req.attendantSignup.email;
    const body = req.body || {};
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const middleName = body.middleName != null ? String(body.middleName).trim() : "";
    const phone = body.phone != null ? String(body.phone).trim() : "";
    const password = String(body.password || "");
    let profileImageUrl =
      body.profileImageUrl != null && String(body.profileImageUrl).trim()
        ? String(body.profileImageUrl).trim()
        : null;

    if (profileImageUrl && profileImageUrl.length > MAX_PROFILE_IMAGE_CHARS) {
      return res.status(400).json({ error: "Profile image data is too large; use a shorter URL or smaller image." });
    }

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "firstName and lastName are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }

    const dup = await emailExistsInTicketing(email);
    if (dup.exists) {
      return res.status(409).json({ error: "This email was registered while you were completing the form" });
    }

    try {
      const employeeId = await allocateUniqueSixDigit();
      const hash = await bcrypt.hash(password, 10);
      const doc = await PortalUser.create({
        email,
        password: hash,
        firstName,
        lastName,
        middleName: middleName || null,
        phone: phone || null,
        role: "BusAttendant",
        photoURL: profileImageUrl,
        authProvider: "password",
        employeeNumber: employeeId,
      });

      await AttendantRegistry.create({
        email,
        firstName,
        lastName,
        middleName: middleName || null,
        phone: phone || null,
        profileImageUrl,
        role: "BusAttendant",
        portalUserId: doc._id,
        employeeNumber: employeeId,
        verifiedViaOtpAt: new Date(),
      });

      return res.status(201).json({
        message: "Attendant verified and added",
        operatorId: doc._id.toString(),
        employeeId,
        email,
        otpVerified: true,
        authStore: "mongo",
      });
    } catch (e) {
      if (e.code === 11000 && e.keyPattern?.email) {
        return res.status(409).json({ error: "Email already registered" });
      }
      return res.status(500).json({ error: e.message || "Failed to save attendant" });
    }
  });

  return router;
}

module.exports = { createAttendantsSignupRouter };
