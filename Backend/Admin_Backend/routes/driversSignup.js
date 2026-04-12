const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { normalizeEmail } = require("../config/adminWhitelist");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireDriverSignupJwt } = require("../middleware/requireDriverSignupJwt");
const DriverSignupOtp = require("../models/DriverSignupOtp");
const Driver = require("../models/Driver");
const PortalUser = require("../models/PortalUser");
const { sendDriverSignupOtpEmail } = require("../services/mailer");
const { allocateUniqueSixDigit } = require("../services/personnelSixDigit");

const MAX_URL_LEN = 400_000;

function checkDriverEmailDomainWhitelist(email) {
  const raw = process.env.DRIVER_SIGNUP_EMAIL_DOMAINS?.trim();
  if (!raw) return { ok: true };
  const dom = email.split("@")[1]?.toLowerCase();
  if (!dom) return { ok: false, error: "Invalid email" };
  const allowed = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(dom)) {
    return {
      ok: false,
      error: `Email domain must be allowed for driver signup. Configured: ${allowed.join(", ")}`,
    };
  }
  return { ok: true };
}

async function emailAvailableForDriverSignup(email) {
  const existing = await Driver.findOne({ email }).lean();
  if (existing) {
    // Soft-deleted drivers keep the document but must not block re-registration (unique index on email).
    if (existing.active === false) {
      await Driver.updateOne({ _id: existing._id }, { $set: { email: null } });
    } else {
      return { ok: false, error: "This email is already registered to a driver" };
    }
  }

  const pu = await PortalUser.findOne({ email }).lean();
  if (pu) {
    return { ok: false, error: "This email is already used by a portal account" };
  }

  return { ok: true };
}

function signDriverSignupToken(email, secret) {
  return jwt.sign(
    { purpose: "driver_signup", email },
    secret,
    { expiresIn: process.env.DRIVER_SIGNUP_JWT_EXPIRES_IN || "20m" }
  );
}

function createDriversSignupRouter() {
  const router = express.Router();

  /** Public JSON ping — use to confirm admin-api serves driver signup (avoids 404 HTML from wrong port/process). */
  router.get("/ready", (_req, res) => {
    res.json({ ok: true, postVerifyEmail: true });
  });

  router.post("/verify-email", requireAdminJwt, async (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(503).json({ error: "JWT_SECRET not configured" });

    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: "Email is required" });
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!validEmail) return res.status(400).json({ error: "Invalid email format" });

      const wl = checkDriverEmailDomainWhitelist(email);
      if (!wl.ok) return res.status(400).json({ error: wl.error });

      const avail = await emailAvailableForDriverSignup(email);
      if (!avail.ok) return res.status(409).json({ error: avail.error });

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const count = await DriverSignupOtp.countDocuments({ email, createdAt: { $gte: oneHourAgo } });
      if (count >= 5) {
        return res.status(429).json({ error: "Too many OTP requests for this email. Try again in about an hour." });
      }

      const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const otpDoc = await DriverSignupOtp.create({
        email,
        otpHash,
        expiresAt,
        consumed: false,
        attempts: 0,
      });

      let sent;
      try {
        sent = await sendDriverSignupOtpEmail({ to: email, otp });
      } catch (mailErr) {
        await DriverSignupOtp.deleteOne({ _id: otpDoc._id });
        return res.status(502).json({
          error: mailErr.message || "Could not send email. Check SMTP_* settings in .env.",
        });
      }

      const payload = {
        message: sent.simulated
          ? "OTP generated. Email was not sent (configure SMTP in .env to deliver by mail)."
          : "OTP sent to the driver’s email.",
        simulatedEmail: sent.simulated === true,
      };

      if (sent.simulated && process.env.NODE_ENV !== "production") {
        console.info(`[driver signup OTP] ${email} → ${otp} (expires in 5 min — SMTP not configured)`);
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

  router.post("/verify-otp", requireAdminJwt, async (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(503).json({ error: "JWT_SECRET not configured" });

    try {
      const email = normalizeEmail(req.body?.email);
      const otp = String(req.body?.otp || "").trim();
      if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "OTP must be 6 digits" });

      const row = await DriverSignupOtp.findOne({ email, consumed: false }).sort({ createdAt: -1 });
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

      const signupToken = signDriverSignupToken(email, secret);
      return res.json({
        message: "OTP verified",
        signupToken,
        email,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "OTP verification failed" });
    }
  });

  router.post("/save-driver", requireDriverSignupJwt, async (req, res) => {
    const email = req.driverSignup.email;
    const body = req.body || {};
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const middleName = body.middleName != null ? String(body.middleName).trim() : "";
    const phone = body.phone != null ? String(body.phone).trim() : "";
    const licenseNumber = String(body.licenseNumber || "").trim();
    const yearsExperience =
      body.yearsExperience != null && body.yearsExperience !== ""
        ? Number(body.yearsExperience)
        : null;

    let profileImageUrl =
      body.profileImageUrl != null && String(body.profileImageUrl).trim()
        ? String(body.profileImageUrl).trim()
        : null;
    let licenseScanUrl =
      body.licenseScanUrl != null && String(body.licenseScanUrl).trim()
        ? String(body.licenseScanUrl).trim()
        : null;

    if ((profileImageUrl && profileImageUrl.length > MAX_URL_LEN) || (licenseScanUrl && licenseScanUrl.length > MAX_URL_LEN)) {
      return res.status(400).json({ error: "Image URL payload is too large" });
    }

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "firstName and lastName are required" });
    }
    if (!licenseNumber) {
      return res.status(400).json({ error: "licenseNumber is required" });
    }
    if (yearsExperience == null || !Number.isFinite(yearsExperience) || yearsExperience < 0) {
      return res.status(400).json({ error: "yearsExperience must be a non-negative number" });
    }

    const avail = await emailAvailableForDriverSignup(email);
    if (!avail.ok) {
      return res.status(409).json({ error: "This email was registered while you were completing the form" });
    }

    const licDup = await Driver.findOne({
      licenseNumber: new RegExp(`^${licenseNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      active: { $ne: false },
    })
      .select("_id")
      .lean();
    if (licDup) {
      return res.status(409).json({ error: "A driver with this license number already exists" });
    }

    try {
      const driverId = await allocateUniqueSixDigit();
      const ticketEditPinHash = await bcrypt.hash(driverId, 10);
      const doc = await Driver.create({
        driverId,
        firstName,
        lastName,
        middleName: middleName || null,
        email,
        phone: phone || null,
        licenseNumber,
        yearsExperience,
        profileImageUrl,
        licenseScanUrl,
        verifiedViaOtpAt: new Date(),
        active: true,
        ticketEditPinHash,
      });

      return res.status(201).json({
        message: "Driver verified and registered",
        id: doc._id.toString(),
        driverId: doc.driverId,
        email,
        otpVerified: true,
      });
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ error: "Duplicate driver email or ID" });
      }
      return res.status(500).json({ error: e.message || "Failed to save driver" });
    }
  });

  return router;
}

module.exports = { createDriversSignupRouter };
