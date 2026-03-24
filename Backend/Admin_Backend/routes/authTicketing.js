const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { getMysqlPool, isMysqlConfigured } = require("../db/mysqlPool");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");
const PortalUser = require("../models/PortalUser");
const PasswordResetToken = require("../models/PasswordResetToken");

function mapOperatorRow(row) {
  if (!row) return null;
  return {
    operatorId: row.operator_id,
    firstName: row.first_name,
    lastName: row.last_name,
    middleName: row.middle_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
  };
}

function mapMongoUser(doc) {
  if (!doc) return null;
  return {
    operatorId: doc._id.toString(),
    firstName: doc.firstName,
    lastName: doc.lastName,
    middleName: doc.middleName,
    email: doc.email,
    phone: doc.phone,
    role: doc.role,
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

    const pool = getMysqlPool();

    try {
      if (pool) {
        const [rows] = await pool.query(
          `SELECT operator_id, first_name, last_name, middle_name, email, phone, role, password
           FROM bus_operators WHERE LOWER(email) = ? LIMIT 1`,
          [email]
        );
        const row = rows[0];
        if (!row) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        if (row.role !== "Admin") {
          return res.status(403).json({ error: "Admin portal: sign in with an Admin account" });
        }
        const ok = await bcrypt.compare(password, row.password);
        if (!ok) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        await pool.query("INSERT INTO login_logs (operator_id) VALUES (?)", [row.operator_id]);
        const token = signToken(
          { sub: row.operator_id, role: row.role, email: row.email },
          secret
        );
        return res.json({ token, user: mapOperatorRow({ ...row, password: undefined }) });
      }

      const doc = await PortalUser.findOne({ email });
      if (!doc || doc.role !== "Admin") {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const ok = await bcrypt.compare(password, doc.password);
      if (!ok) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const token = signToken(
        { sub: doc._id.toString(), role: doc.role, email: doc.email, authStore: "mongo" },
        secret
      );
      return res.json({ token, user: mapMongoUser(doc) });
    } catch (e) {
      res.status(500).json({ error: e.message });
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

    const pool = getMysqlPool();

    try {
      if (pool) {
        const [rows] = await pool.query(
          `SELECT operator_id, first_name, last_name, middle_name, email, phone, role, password
           FROM bus_operators WHERE LOWER(email) = ? LIMIT 1`,
          [email]
        );
        const row = rows[0];
        if (!row) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        if (row.role !== "Operator") {
          return res.status(403).json({ error: "Attendant app: sign in with an Operator account" });
        }
        const ok = await bcrypt.compare(password, row.password);
        if (!ok) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        await pool.query("INSERT INTO login_logs (operator_id) VALUES (?)", [row.operator_id]);
        const token = signToken(
          { sub: row.operator_id, role: row.role, email: row.email },
          secret
        );
        return res.json({ token, user: mapOperatorRow({ ...row, password: undefined }) });
      }

      const doc = await PortalUser.findOne({ email });
      if (!doc || doc.role !== "Operator") {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const ok = await bcrypt.compare(password, doc.password);
      if (!ok) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const token = signToken(
        { sub: doc._id.toString(), role: doc.role, email: doc.email, authStore: "mongo" },
        secret
      );
      return res.json({ token, user: mapMongoUser(doc) });
    } catch (e) {
      res.status(500).json({ error: e.message });
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
      const pool = getMysqlPool();

      if (payload.authStore === "mongo") {
        const doc = await PortalUser.findById(payload.sub);
        const user = mapMongoUser(doc);
        if (!user) return res.status(401).json({ error: "User not found" });
        if (!isAuthorizedAdminEmail(user.email)) {
          return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
        }
        return res.json({ user });
      }

      if (pool) {
        const [rows] = await pool.query(
          `SELECT operator_id, first_name, last_name, middle_name, email, phone, role
           FROM bus_operators WHERE operator_id = ? LIMIT 1`,
          [payload.sub]
        );
        const user = mapOperatorRow(rows[0]);
        if (!user) return res.status(401).json({ error: "User not found" });
        if (!isAuthorizedAdminEmail(user.email)) {
          return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
        }
        return res.json({ user });
      }

      const oid =
        mongoose.Types.ObjectId.isValid(payload.sub) && String(payload.sub).length === 24
          ? payload.sub
          : null;
      const doc = oid ? await PortalUser.findById(oid) : null;
      const user = mapMongoUser(doc);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (!isAuthorizedAdminEmail(user.email)) {
        return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
      }
      return res.json({ user });
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

    const pool = getMysqlPool();

    try {
      if (pool) {
        const [users] = await pool.query(
          `SELECT operator_id, role FROM bus_operators WHERE LOWER(email) = ? LIMIT 1`,
          [email]
        );
        const u = users[0];
        if (!u || u.role !== "Admin") {
          return res.status(404).json({ error: "No admin account found for this email" });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await pool.query("DELETE FROM admin_password_resets WHERE email = ?", [email]);
        await pool.query(
          "INSERT INTO admin_password_resets (email, token, expires_at) VALUES (?, ?, ?)",
          [email, token, expiresAt]
        );

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
      }

      const user = await PortalUser.findOne({ email, role: "Admin" });
      if (!user) {
        return res.status(404).json({ error: "No admin account found for this email" });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await PasswordResetToken.deleteMany({ email });
      await PasswordResetToken.create({ email, token, expiresAt });

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
      if (e.code === "ER_NO_SUCH_TABLE") {
        return res.status(503).json({
          error:
            "Password reset table missing — run Backend/Admin_Backend/sql/admin_password_resets.sql",
        });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/validate-reset-token", async (req, res) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ error: "token required" });

    const pool = getMysqlPool();

    try {
      if (pool) {
        const [rows] = await pool.query(
          "SELECT email, expires_at FROM admin_password_resets WHERE token = ? LIMIT 1",
          [token]
        );
        const row = rows[0];
        if (!row || new Date(row.expires_at) < new Date()) {
          return res.json({ valid: false });
        }
        const em = String(row.email);
        const masked = em.replace(/(^.).*(@.*$)/, "$1***$2");
        return res.json({ valid: true, emailMasked: masked });
      }

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

    const pool = getMysqlPool();

    try {
      if (pool) {
        const [rows] = await pool.query(
          "SELECT email, expires_at FROM admin_password_resets WHERE token = ? LIMIT 1",
          [token]
        );
        const row = rows[0];
        if (!row || new Date(row.expires_at) < new Date()) {
          return res.status(400).json({ error: "Invalid or expired reset link" });
        }

        const email = normalizeEmail(row.email);
        if (!isAuthorizedAdminEmail(email)) {
          return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        const [upd] = await pool.query(
          "UPDATE bus_operators SET password = ? WHERE LOWER(email) = ? AND role = 'Admin'",
          [hash, email]
        );
        if (upd.affectedRows === 0) {
          return res.status(404).json({ error: "Admin account not found" });
        }

        await pool.query("DELETE FROM admin_password_resets WHERE token = ? OR email = ?", [
          token,
          email,
        ]);

        return res.json({ message: "Password updated. You can sign in with your new password." });
      }

      const row = await PasswordResetToken.findOne({ token });
      if (!row || row.expiresAt < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
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

      await PasswordResetToken.deleteMany({ $or: [{ token }, { email }] });

      return res.json({ message: "Password updated. You can sign in with your new password." });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createAuthTicketingRouter, mapOperatorRow };
