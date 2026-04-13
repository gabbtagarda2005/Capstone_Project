const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");
const { getAdminTier } = require("../config/adminRoles");
const { getRbacRoleForEmail } = require("../services/adminRbac");
const {
  isLockedOut,
  recordFailedLoginAttempt,
  clearLockoutOnSuccess,
} = require("../services/adminAuthLockout");
const PortalUser = require("../models/PortalUser");
const Bus = require("../models/Bus");
const PasswordResetToken = require("../models/PasswordResetToken");
const AdminOtpCode = require("../models/AdminOtpCode");
const OperatorPasswordResetOtp = require("../models/OperatorPasswordResetOtp");
const { sendOtpEmail, sendOperatorPasswordResetOtpEmail } = require("../services/mailer");
const { verifyFirebaseIdToken } = require("../config/firebaseAdmin");
const { getPortalSettingsLean } = require("../services/adminPortalSettingsService");

const BUS_ASSIGNMENT_REQUIRED_MSG =
  "No bus assigned to your account. Ask your administrator to assign you to a bus in Management before signing in.";

function mapMongoUser(doc) {
  if (!doc) return null;
  return {
    operatorId: doc._id.toString(),
    employeeId: doc.employeeNumber != null && String(doc.employeeNumber).trim() ? String(doc.employeeNumber).trim() : null,
    firstName: doc.firstName,
    lastName: doc.lastName,
    middleName: doc.middleName,
    email: doc.email,
    phone: doc.phone,
    role: doc.role,
    photoURL: doc.photoURL || null,
  };
}

async function withAdminProfile(user) {
  if (!user) return user;
  if (user.role !== "Admin") return { ...user, adminTier: null, rbacRole: null };
  const rbacRole = await getRbacRoleForEmail(user.email);
  return { ...user, adminTier: getAdminTier(user.email), rbacRole };
}

function withNonAdminUser(user) {
  if (!user) return user;
  return { ...user, adminTier: null, rbacRole: null };
}

/** Match attendant/operator by email only (OTP sent to inbox — same idea as admin forgot-password-otp). */
async function findBusAttendantAccountByEmail(email) {
  const em = normalizeEmail(email);
  if (!em) return null;
  const doc = await PortalUser.findOne({
    email: em,
    role: { $in: ["BusAttendant", "Operator"] },
  })
    .select("_id")
    .lean();
  if (doc) return { portalUserId: doc._id };
  return null;
}

/** Same as account lookup plus display preview for attendant recovery UI (name, staff id, optional photo). */
async function findBusAttendantRecoveryPreview(email) {
  const em = normalizeEmail(email);
  if (!em) return null;
  const doc = await PortalUser.findOne({
    email: em,
    role: { $in: ["BusAttendant", "Operator"] },
  })
    .select("firstName lastName employeeNumber photoURL")
    .lean();
  if (!doc) return null;
  const fn = doc.firstName != null ? String(doc.firstName).trim() : "";
  const ln = doc.lastName != null ? String(doc.lastName).trim() : "";
  const displayName = `${fn} ${ln}`.trim() || "Attendant";
  const staffId =
    doc.employeeNumber != null && String(doc.employeeNumber).trim()
      ? String(doc.employeeNumber).trim()
      : String(doc._id);
  const avatarUrl =
    doc.photoURL != null && String(doc.photoURL).trim() ? String(doc.photoURL).trim() : null;
  return {
    mysqlOperatorId: null,
    portalUserId: doc._id,
    preview: { displayName, staffId, avatarUrl },
  };
}

async function applyOperatorPasswordUpdate(email, newPassword, _mysqlOperatorIdLegacy, portalUserId) {
  const hash = await bcrypt.hash(newPassword, 10);
  const em = normalizeEmail(email);
  if (portalUserId) {
    const upd = await PortalUser.updateOne(
      { _id: portalUserId, email: em, role: { $in: ["BusAttendant", "Operator"] } },
      { $set: { password: hash } }
    );
    if (upd.matchedCount === 0) {
      const e = new Error("Account not found");
      e.code = "NOT_FOUND";
      throw e;
    }
    return;
  }
  const e = new Error("Reset record is missing account linkage");
  e.code = "NO_LINK";
  throw e;
}

/** Match ticketing MySQL operator or Mongo PortalUser bus attendant for self-service password reset. */
async function findBusAttendantForPasswordReset(email, personnelId) {
  const em = normalizeEmail(email);
  const pid = String(personnelId || "").trim();
  if (!em || !pid) return null;

  const oid = mongoose.Types.ObjectId.isValid(pid) && String(pid).length === 24 ? pid : null;
  const doc = await PortalUser.findOne({ email: em, role: { $in: ["BusAttendant", "Operator"] } }).lean();
  if (doc) {
    const en = doc.employeeNumber != null ? String(doc.employeeNumber).trim() : "";
    if (en && en === pid) return { portalUserId: doc._id };
    if (oid && String(doc._id) === oid) return { portalUserId: doc._id };
  }

  return null;
}

/** Lookup bus attendant email by 6-digit personnel ID (employee_id / employeeNumber). */
async function findBusAttendantEmailByPersonnelId(personnelId) {
  const pid = String(personnelId || "").trim();
  if (!/^\d{6}$/.test(pid)) return null;

  const doc = await PortalUser.findOne({
    employeeNumber: pid,
    role: { $in: ["BusAttendant", "Operator"] },
  })
    .select("email")
    .lean();
  if (!doc?.email) return null;
  return normalizeEmail(doc.email);
}

function splitName(displayName) {
  const raw = String(displayName || "").trim();
  if (!raw) return { firstName: "Admin", lastName: "User" };
  const parts = raw.split(/\s+/);
  return {
    firstName: parts[0] || "Admin",
    lastName: parts.slice(1).join(" ") || "User",
  };
}

function signToken(userPayload, secret) {
  const base = {
    sub: String(userPayload.sub),
    role: userPayload.role,
    email: userPayload.email,
  };
  if (userPayload.authStore === "mongo") {
    base.authStore = "mongo";
  }
  return jwt.sign(base, secret, { expiresIn: process.env.JWT_EXPIRES_IN || "8h" });
}

function createAuthTicketingRouter() {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "JWT_SECRET not configured" });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    if (!isAuthorizedAdminEmail(email)) {
      return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
    }

    try {
      const doc = await PortalUser.findOne({ email });
      if (!doc || doc.role !== "Admin") {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (!doc.password) {
        return res.status(401).json({ error: "Use Google Login for this account" });
      }
      const portal = await getPortalSettingsLean();
      const applyLock = portal.securityPolicyApplyAdmin !== false;
      if (applyLock) {
        const lock = await isLockedOut(email, "admin");
        if (lock.locked) {
          return res.status(403).json({
            error: "Account temporarily locked after failed sign-in attempts. Try again later.",
            lockedUntil: lock.lockedUntil.toISOString(),
          });
        }
      }
      const ok = await bcrypt.compare(password, doc.password);
      if (!ok) {
        if (applyLock) await recordFailedLoginAttempt(email, "admin");
        return res.status(401).json({ error: "Invalid credentials" });
      }
      await clearLockoutOnSuccess(email, "admin");
      const token = signToken(
        { sub: doc._id.toString(), role: doc.role, email: doc.email, authStore: "mongo" },
        secret
      );
      return res.json({ token, user: await withAdminProfile(mapMongoUser(doc)) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/google-login", async (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(503).json({ error: "JWT_SECRET not configured" });

    const idToken = String(req.body?.idToken || "");
    if (!idToken) return res.status(400).json({ error: "idToken is required" });

    try {
      const decoded = await verifyFirebaseIdToken(idToken);
      const email = normalizeEmail(decoded.email);
      if (!email) return res.status(400).json({ error: "Google account has no email" });
      if (!isAuthorizedAdminEmail(email)) {
        return res.status(403).json({
          error:
            "This Google account is not authorized. Only whitelisted admin emails may use the admin portal.",
        });
      }

      const names = splitName(decoded.name);
      const doc = await PortalUser.findOneAndUpdate(
        { email },
        {
          $set: {
            email,
            role: "Admin",
            authProvider: "google",
            firebaseUid: decoded.uid || null,
            photoURL: decoded.picture || null,
            firstName: names.firstName,
            lastName: names.lastName,
          },
          $setOnInsert: {
            password: await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10),
          },
        },
        { upsert: true, new: true }
      );

      await clearLockoutOnSuccess(email, "admin");
      const token = signToken(
        { sub: doc._id.toString(), role: doc.role, email: doc.email, authStore: "mongo" },
        secret
      );
      return res.json({ token, user: await withAdminProfile(mapMongoUser(doc)) });
    } catch (e) {
      return res.status(401).json({ error: e.message || "Google login failed" });
    }
  });

  router.post("/operator-login", async (req, res) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "JWT_SECRET not configured" });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    try {
      const doc = await PortalUser.findOne({ email });
      const roleNorm = String(doc?.role || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "");
      const allowedMongoAttendant = roleNorm === "operator" || roleNorm === "busattendant";
      if (!doc || !allowedMongoAttendant) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const portal = await getPortalSettingsLean();
      const applyLock = portal.securityPolicyApplyAttendant !== false;
      if (applyLock) {
        const lock = await isLockedOut(email, "attendant");
        if (lock.locked) {
          return res.status(403).json({
            error: "Account temporarily locked after failed sign-in attempts. Try again later.",
            lockedUntil: lock.lockedUntil.toISOString(),
          });
        }
      }
      const ok = await bcrypt.compare(password, doc.password);
      if (!ok) {
        if (applyLock) await recordFailedLoginAttempt(email, "attendant");
        return res.status(401).json({ error: "Invalid credentials" });
      }
      await clearLockoutOnSuccess(email, "attendant");
      const assignedBus = await Bus.findOne({ operatorPortalUserId: doc._id }).select("_id status").lean();
      if (!assignedBus) {
        return res.status(403).json({ error: BUS_ASSIGNMENT_REQUIRED_MSG });
      }
      if (String(assignedBus.status || "").trim() === "Inactive") {
        return res.status(403).json({
          error:
            "Your assigned bus has been deactivated. You cannot sign in until an administrator reactivates the unit in Fleet management.",
        });
      }
      const token = signToken(
        { sub: doc._id.toString(), role: doc.role, email: doc.email, authStore: "mongo" },
        secret
      );
      return res.json({ token, user: withNonAdminUser(mapMongoUser(doc)) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Bus attendant app: request 6-digit OTP after verifying email + personnel ID (employee_id or legacy operator_id / Mongo id).
   */
  router.post("/operator-forgot-email", async (req, res) => {
    try {
      const personnelId = String(req.body?.personnelId || "").trim();
      if (!/^\d{6}$/.test(personnelId)) {
        return res.status(400).json({ error: "Personnel ID must be exactly 6 digits." });
      }
      const email = await findBusAttendantEmailByPersonnelId(personnelId);
      if (!email) {
        return res.status(404).json({ error: "No attendant account matches that Personnel ID." });
      }
      return res.json({ email });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Email lookup failed." });
    }
  });

  router.post("/operator-forgot-password", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const personnelId = String(req.body?.personnelId || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      if (!personnelId) {
        return res.status(400).json({ error: "Personnel ID is required (6-digit ID on your roster card)" });
      }

      const acc = await findBusAttendantForPasswordReset(email, personnelId);
      if (!acc) {
        return res.status(404).json({
          error: "No attendant account matches that email and personnel ID. Check with your administrator.",
        });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await OperatorPasswordResetOtp.countDocuments({
        email,
        createdAt: { $gte: oneHourAgo },
      });
      if (recent >= 4) {
        return res.status(429).json({ error: "Too many reset requests. Try again in about an hour." });
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await OperatorPasswordResetOtp.create({
        email,
        otpHash,
        expiresAt,
        consumed: false,
        attempts: 0,
        mysqlOperatorId: acc.mysqlOperatorId != null ? Number(acc.mysqlOperatorId) : null,
        portalUserId: acc.portalUserId || null,
      });

      let sent;
      try {
        sent = await sendOperatorPasswordResetOtpEmail({ to: email, otp });
      } catch (mailErr) {
        await OperatorPasswordResetOtp.deleteMany({ email, consumed: false });
        return res.status(502).json({
          error: mailErr.message || "Could not send email. Configure SMTP_* or SENDGRID_API_KEY in Admin_Backend .env.",
        });
      }

      const payload = {
        message: sent.simulated
          ? "Reset code generated. Email was not sent — configure SMTP on the server, or read the code from the API terminal in development."
          : "A 6-digit code was sent to your email. Enter it below with your new password.",
        simulatedEmail: sent.simulated === true,
      };

      if (sent.simulated && process.env.NODE_ENV !== "production") {
        console.info(`[operator password reset OTP] ${email} → ${otp} (expires in 10 min)`);
        if (process.env.OTP_DEV_REVEAL === "true") {
          payload.devOtp = otp;
        }
      }

      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: e.message || "Request failed" });
    }
  });

  /**
   * Bus attendant app: confirm OTP and set new password (MySQL bus_operators or Mongo PortalUser).
   */
  router.post("/operator-reset-password", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otp = String(req.body?.otp || "").trim();
      const newPassword = String(req.body?.newPassword || "");
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Enter the 6-digit code from your email" });
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const row = await OperatorPasswordResetOtp.findOne({ email, consumed: false }).sort({ createdAt: -1 });
      if (!row || row.expiresAt < new Date()) {
        return res.status(400).json({ error: "Code is invalid or expired. Request a new code." });
      }
      if (row.attempts >= 6) {
        return res.status(429).json({ error: "Too many wrong attempts. Request a new code." });
      }

      const ok = await bcrypt.compare(otp, row.otpHash);
      if (!ok) {
        row.attempts += 1;
        await row.save();
        return res.status(400).json({ error: "Invalid code" });
      }

      try {
        await applyOperatorPasswordUpdate(
          email,
          newPassword,
          row.mysqlOperatorId != null ? Number(row.mysqlOperatorId) : null,
          row.portalUserId || null
        );
      } catch (e) {
        if (e.code === "NOT_FOUND") {
          return res.status(404).json({ error: e.message });
        }
        if (e.code === "NO_LINK") {
          return res.status(500).json({ error: e.message });
        }
        throw e;
      }

      row.consumed = true;
      await row.save();
      await OperatorPasswordResetOtp.deleteMany({ email });

      return res.json({ message: "Password updated. You can sign in with your new password." });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Reset failed" });
    }
  });

  /**
   * Bus attendant app: email-only OTP request (same flow as admin forgot-password-otp).
   */
  router.post("/operator-forgot-password-otp", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email is required" });
      }

      const acc = await findBusAttendantRecoveryPreview(email);
      if (!acc) {
        return res.status(404).json({ error: "No attendant account found for this email." });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await OperatorPasswordResetOtp.countDocuments({
        email,
        createdAt: { $gte: oneHourAgo },
      });
      if (recent >= 4) {
        return res.status(429).json({ error: "Too many reset requests. Try again in about an hour." });
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await OperatorPasswordResetOtp.create({
        email,
        otpHash,
        expiresAt,
        consumed: false,
        attempts: 0,
        mysqlOperatorId: acc.mysqlOperatorId != null ? Number(acc.mysqlOperatorId) : null,
        portalUserId: acc.portalUserId || null,
      });

      let sent;
      try {
        sent = await sendOperatorPasswordResetOtpEmail({ to: email, otp });
      } catch (mailErr) {
        await OperatorPasswordResetOtp.deleteMany({ email, consumed: false });
        return res.status(502).json({
          error: mailErr.message || "Could not send email. Configure SMTP_* or SENDGRID_API_KEY in Admin_Backend .env.",
        });
      }

      const payload = {
        message: sent.simulated
          ? "OTP generated. Email was not sent — configure SMTP on the server, or read the code from the API terminal in development."
          : "A 6-digit code was sent to your email.",
        simulatedEmail: sent.simulated === true,
        preview: acc.preview,
      };

      if (sent.simulated && process.env.NODE_ENV !== "production") {
        console.info(`[operator password reset OTP] ${email} → ${otp} (expires in 10 min)`);
        payload.hint =
          "No email was sent. The OTP is in the Admin_Backend terminal. Add SMTP_* to .env to email it, or set OTP_DEV_REVEAL=true to show the code in the app.";
        if (process.env.OTP_DEV_REVEAL === "true") {
          payload.devOtp = otp;
        }
      }

      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: e.message || "Request failed" });
    }
  });

  /**
   * Bus attendant app: verify OTP and return a short-lived reset token (admin-style), then POST operator-reset-password-token.
   */
  router.post("/operator-verify-reset-otp", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otp = String(req.body?.otp || "").trim();
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Enter the 6-digit code from your email" });

      const row = await OperatorPasswordResetOtp.findOne({ email, consumed: false }).sort({ createdAt: -1 });
      if (!row || row.expiresAt < new Date()) {
        return res.status(400).json({ error: "Code is invalid or expired. Request a new code." });
      }
      if (row.attempts >= 6) {
        return res.status(429).json({ error: "Too many wrong attempts. Request a new code." });
      }

      const ok = await bcrypt.compare(otp, row.otpHash);
      if (!ok) {
        row.attempts += 1;
        await row.save();
        return res.status(400).json({ error: "Invalid code" });
      }

      row.consumed = true;
      await row.save();
      await OperatorPasswordResetOtp.deleteMany({ email });

      const resetToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await PasswordResetToken.deleteMany({ email, purpose: "operator" });
      await PasswordResetToken.create({
        email,
        token: resetToken,
        expiresAt,
        purpose: "operator",
        mysqlOperatorId: row.mysqlOperatorId != null && Number.isFinite(Number(row.mysqlOperatorId)) ? Number(row.mysqlOperatorId) : null,
        portalUserId: row.portalUserId || null,
      });

      return res.json({
        message: "Code verified. Enter your new password below.",
        resetToken,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Verification failed" });
    }
  });

  router.post("/operator-reset-password-token", async (req, res) => {
    try {
      const token = String(req.body?.token || "");
      const newPassword = String(req.body?.password || "");
      const confirm = String(req.body?.confirmPassword ?? req.body?.confirm ?? "");
      if (!token || !newPassword) {
        return res.status(400).json({ error: "Token and new password required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (confirm && newPassword !== confirm) {
        return res.status(400).json({ error: "Passwords do not match" });
      }

      const row = await PasswordResetToken.findOne({ token, purpose: "operator" });
      if (!row || row.expiresAt < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset link. Request a new code." });
      }

      const email = normalizeEmail(row.email);
      try {
        await applyOperatorPasswordUpdate(
          email,
          newPassword,
          row.mysqlOperatorId != null && Number.isFinite(Number(row.mysqlOperatorId)) ? Number(row.mysqlOperatorId) : null,
          row.portalUserId || null
        );
      } catch (e) {
        if (e.code === "NOT_FOUND") {
          return res.status(404).json({ error: e.message });
        }
        if (e.code === "NO_LINK") {
          return res.status(500).json({ error: e.message });
        }
        throw e;
      }

      await PasswordResetToken.deleteMany({ $or: [{ token }, { email, purpose: "operator" }] });

      return res.json({ message: "Password updated. You can sign in with your new password." });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Reset failed" });
    }
  });

  router.get("/me", async (req, res) => {
    const secret = process.env.JWT_SECRET;
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const payload = jwt.verify(h.slice(7), secret);
      const oid = String(payload.sub || "");
      if (!mongoose.Types.ObjectId.isValid(oid)) {
        return res.status(401).json({ error: "Invalid token" });
      }
      const doc = await PortalUser.findById(oid);
      const user = mapMongoUser(doc);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (!isAuthorizedAdminEmail(user.email)) {
        return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
      }
      if (user.role === "Admin") {
        return res.json({ user: await withAdminProfile(user) });
      }
      return res.json({ user: { ...user, adminTier: null, rbacRole: null } });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  router.post("/forgot-password", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!isAuthorizedAdminEmail(email)) {
      return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
    }

    try {
      const user = await PortalUser.findOne({ email, role: "Admin" });
      if (!user) {
        return res.status(404).json({ error: "No admin account found for this email" });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await PasswordResetToken.deleteMany({ email, $or: [{ purpose: { $exists: false } }, { purpose: "admin" }] });
      await PasswordResetToken.create({ email, token, expiresAt, purpose: "admin" });

      const frontendBase =
        process.env.ADMIN_FRONTEND_URL || process.env.PUBLIC_APP_URL || "http://localhost:5173";
      const resetLink = `${frontendBase.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;

      const payload = {
        message:
          "Password reset link has been generated. In production this would be emailed to your inbox.",
        simulated: true,
      };

      if (process.env.NODE_ENV !== "production" || process.env.EXPOSE_RESET_LINK === "true") {
        payload.resetLink = resetLink;
      }

      return res.json(payload);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/forgot-password-otp", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: "Email is required" });
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!validEmail) return res.status(400).json({ error: "Invalid email format" });
      if (!isAuthorizedAdminEmail(email)) {
        return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const count = await AdminOtpCode.countDocuments({ email, createdAt: { $gte: oneHourAgo } });
      if (count >= 3) {
        return res.status(429).json({ error: "Too many OTP requests. Try again in about an hour." });
      }

      const user = await PortalUser.findOne({ email, role: "Admin" });
      if (!user) return res.status(404).json({ error: "No admin account found for this email" });

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const otpDoc = await AdminOtpCode.create({
        email,
        otpHash,
        expiresAt,
        consumed: false,
        attempts: 0,
      });

      let sent;
      try {
        sent = await sendOtpEmail({ to: email, otp });
      } catch (mailErr) {
        await AdminOtpCode.deleteOne({ _id: otpDoc._id });
        return res.status(502).json({
          error: mailErr.message || "Could not send email. Check SMTP_* settings in .env.",
        });
      }

      const payload = {
        message: sent.simulated
          ? "OTP generated. Email was not sent (configure SMTP in .env to deliver by mail)."
          : "OTP sent to your email.",
        simulatedEmail: sent.simulated === true,
      };

      if (sent.simulated && process.env.NODE_ENV !== "production") {
        console.info(`[admin OTP] ${email} → ${otp} (expires in 5 min — SMTP not configured)`);
        payload.hint =
          "No email was sent. The OTP is in the Admin_Backend terminal. Add SMTP_* to .env to email it, or set OTP_DEV_REVEAL=true to show the code in this window.";
        if (process.env.OTP_DEV_REVEAL === "true") {
          payload.devOtp = otp;
        }
      }

      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to send OTP" });
    }
  });

  router.post("/verify-otp", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otp = String(req.body?.otp || "").trim();
      if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "OTP must be 6 digits" });

      const row = await AdminOtpCode.findOne({ email, consumed: false }).sort({ createdAt: -1 });
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

      const resetToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await PasswordResetToken.deleteMany({ email, $or: [{ purpose: { $exists: false } }, { purpose: "admin" }] });
      await PasswordResetToken.create({ email, token: resetToken, expiresAt, purpose: "admin" });

      return res.json({
        message: "OTP verified",
        resetToken,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "OTP verification failed" });
    }
  });

  router.get("/validate-reset-token", async (req, res) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ error: "token required" });

    try {
      const doc = await PasswordResetToken.findOne({ token });
      if (!doc || doc.expiresAt < new Date()) {
        return res.json({ valid: false });
      }
      const em = String(doc.email);
      const masked = em.replace(/(^.).*(@.*$)/, "$1***$2");
      return res.json({ valid: true, emailMasked: masked });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/reset-password", async (req, res) => {
    const token = String(req.body?.token || "");
    const newPassword = String(req.body?.password || "");
    const confirm = String(req.body?.confirmPassword ?? req.body?.confirm ?? "");

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    if (confirm && newPassword !== confirm) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    try {
      const row = await PasswordResetToken.findOne({ token });
      if (!row || row.expiresAt < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
      }
      if (row.purpose === "operator") {
        return res.status(400).json({ error: "This reset link is for the attendant app, not the admin portal." });
      }

      const email = normalizeEmail(row.email);
      if (!isAuthorizedAdminEmail(email)) {
        return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      const upd = await PortalUser.updateOne(
        { email, role: "Admin" },
        { $set: { password: hash } }
      );
      if (upd.matchedCount === 0) {
        return res.status(404).json({ error: "Admin account not found" });
      }

      await PasswordResetToken.deleteOne({ token });
      await PasswordResetToken.deleteMany({
        email,
        $or: [{ purpose: { $exists: false } }, { purpose: "admin" }],
      });

      return res.json({ message: "Password updated. You can sign in with your new password." });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createAuthTicketingRouter, mapMongoUser };
