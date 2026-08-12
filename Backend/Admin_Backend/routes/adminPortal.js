const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const { ADMIN_EMAIL_WHITELIST, normalizeEmail } = require("../config/adminWhitelist");
const AdminAuditLog = require("../models/AdminAuditLog");
const AdminItAccountOtp = require("../models/AdminItAccountOtp");
const AdminRbacAssignment = require("../models/AdminRbacAssignment");
const AttendantRegistry = require("../models/AttendantRegistry");
const Bus = require("../models/Bus");
const CorridorRoute = require("../models/CorridorRoute");
const Driver = require("../models/Driver");
const FareMatrixEntry = require("../models/FareMatrixEntry");
const FareRoute = require("../models/FareRoute");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const PasswordResetToken = require("../models/PasswordResetToken");
const PortalUser = require("../models/PortalUser");
const RouteCoverage = require("../models/RouteCoverage");
const liveDispatchStore = require("../services/liveDispatchStore");
const { getPortalSettingsLean, updatePortalSettings } = require("../services/adminPortalSettingsService");
const { getRbacRoleForEmail } = require("../services/adminRbac");
const { getSystemEvents } = require("../services/systemHealthLog");
const { getApiMetrics } = require("../middleware/apiMetrics");
const { sendItAccountOtpEmail } = require("../services/mailer");
const {
  listDailyOpsSnapshots,
  downloadDailyOpsSnapshot,
} = require("./dailyOpsSnapshotsHandlers");

const ALLOWED_CLIENT_ACTIONS = new Set(["ADD", "EDIT", "VIEW", "DELETE", "BROADCAST"]);

function createAdminPortalRouter() {
  const router = express.Router();

  router.get("/settings", requireAdminJwt, async (_req, res) => {
    try {
      const settings = await getPortalSettingsLean();
      res.json({ settings });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Live counts for Management hub cards (dashboard grid).
   */
  router.get("/management-hub-stats", requireAdminJwt, async (_req, res) => {
    try {
      const manilaToday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      const safeCount = (p) =>
        p.catch(() => 0);

      const [
        ticketRecords,
        busesTotal,
        busesActive,
        attendantsPortal,
        attendantsRegistry,
        driversTotal,
        driversVerified,
        hubs,
        corridorRoutes,
        fareRoutes,
        faresMatrix,
        rbacAdmins,
        portalAdminUsers,
      ] = await Promise.all([
        safeCount(IssuedTicketRecord.countDocuments({})),
        safeCount(Bus.countDocuments({})),
        safeCount(Bus.countDocuments({ status: "Active" })),
        safeCount(PortalUser.countDocuments({ role: "BusAttendant" })),
        safeCount(AttendantRegistry.countDocuments({})),
        safeCount(Driver.countDocuments({ active: { $ne: false } })),
        safeCount(Driver.countDocuments({ verifiedViaOtpAt: { $ne: null }, active: { $ne: false } })),
        safeCount(RouteCoverage.countDocuments({})),
        safeCount(CorridorRoute.countDocuments({ suspended: { $ne: true } })),
        safeCount(FareRoute.countDocuments({ suspended: { $ne: true } })),
        safeCount(FareMatrixEntry.countDocuments({})),
        safeCount(AdminRbacAssignment.countDocuments({})),
        safeCount(PortalUser.countDocuments({ role: "Admin" })),
      ]);

      const assignedIds = await Bus.distinct("operatorPortalUserId", {
        status: "Active",
        operatorPortalUserId: { $ne: null },
      }).catch(() => []);
      const attendantsOnActiveBuses = (assignedIds || []).filter(Boolean).length;

      const blocks = liveDispatchStore.listBlocks();
      const tripsPlanned = blocks.filter((b) => {
        if (String(b.status || "").toLowerCase() === "cancelled") return false;
        const sd = b.serviceDate != null && String(b.serviceDate).trim() ? String(b.serviceDate).trim().slice(0, 10) : "";
        return !sd || sd === manilaToday;
      }).length;

      const staffRoster = Math.max(attendantsPortal, attendantsRegistry);
      const routeDefinitions = corridorRoutes + fareRoutes;
      const adminAccounts = Math.max(rbacAdmins, portalAdminUsers);

      res.setHeader("Cache-Control", "no-store");
      res.json({
        ticketRecords,
        busesTotal,
        busesActive,
        attendantsRoster: staffRoster,
        attendantsOnActiveBuses,
        driversTotal,
        driversVerified,
        hubs,
        corridorRoutes,
        fareRoutes,
        routeDefinitions,
        tripsPlanned,
        faresMatrix,
        adminAccounts,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put("/settings", requireAdminJwt, async (req, res) => {
    try {
      if (req.admin.rbacRole === "auditor") {
        return res.status(403).json({ error: "Read-only role cannot change settings" });
      }
      const body = req.body || {};
      const securityKeys = [
        "maxLoginAttempts",
        "lockoutMinutes",
        "sessionTimeoutMinutes",
        "securityPolicyApplyAdmin",
        "securityPolicyApplyAttendant",
      ];
      const generalKeys = [
        "emailDailySummary",
        "soundAlerts",
        "timezone",
        "currency",
        "delayThresholdMinutes",
        "geofenceBreachToasts",
        "sensitiveActionConfirmation",
      ];
      const brandingKeys = [
        "companyName",
        "companyEmail",
        "companyPhone",
        "sosEmail",
        "sosPhoneNumber",
        "companyLocation",
        "sidebarLogoUrl",
        "faviconUrl",
        "reportFooter",
      ];

      const isSuper = req.admin.rbacRole === "super_admin" || req.admin.tier === "super";
      const patch = {};

      if (body.security && typeof body.security === "object") {
        if (!isSuper) {
          return res.status(403).json({ error: "Only Super Admin can change security policy" });
        }
        for (const k of securityKeys) {
          if (body.security[k] !== undefined) patch[k] = body.security[k];
        }
      }
      if (body.general && typeof body.general === "object") {
        for (const k of generalKeys) {
          if (body.general[k] !== undefined) patch[k] = body.general[k];
        }
      }
      if (body.branding && typeof body.branding === "object") {
        for (const k of brandingKeys) {
          if (body.branding[k] !== undefined) patch[k] = body.branding[k];
        }
      }
      if (body.clientApps && typeof body.clientApps === "object") {
        if (req.admin.rbacRole === "auditor") {
          return res.status(403).json({ error: "Read-only role cannot change settings" });
        }
        if (body.clientApps.attendantAppAccess !== undefined) {
          patch.attendantAppAccess = body.clientApps.attendantAppAccess;
        }
        if (body.clientApps.passengerAppAccess !== undefined) {
          patch.passengerAppAccess = body.clientApps.passengerAppAccess;
        }
      }
      if (body.commandCenter && typeof body.commandCenter === "object") {
        if (req.admin.rbacRole === "auditor") {
          return res.status(403).json({ error: "Read-only role cannot change command center" });
        }
        if (body.commandCenter.operationsDeckLive !== undefined) {
          patch.operationsDeckLive = Boolean(body.commandCenter.operationsDeckLive);
        }
      }

      if (body.maintenance && typeof body.maintenance === "object") {
        if (!isSuper) {
          return res.status(403).json({ error: "Only Super Admin can change maintenance shield" });
        }
        const mk = [
          "maintenanceShieldEnabled",
          "maintenancePassengerLocked",
          "maintenanceAttendantLocked",
          "maintenanceMessage",
          "maintenanceScheduledUntil",
          "minAttendantAppVersion",
          "fleetMode",
        ];
        for (const k of mk) {
          if (body.maintenance[k] !== undefined) patch[k] = body.maintenance[k];
        }
      }

      if (body.dailyOpsReport && typeof body.dailyOpsReport === "object") {
        if (req.admin.rbacRole === "auditor") {
          return res.status(403).json({ error: "Read-only role cannot change daily operations email settings" });
        }
        const d = body.dailyOpsReport;
        if (d.enabled !== undefined) patch.dailyOpsReportEmailEnabled = Boolean(d.enabled);
        if (d.emailTime !== undefined) patch.dailyOpsReportEmailTime = d.emailTime;
        let nextRecipients;
        if (d.includeSavingAdminEmail === true && req.admin?.email) {
          const cur = await getPortalSettingsLean();
          const base = Array.isArray(d.recipients) ? d.recipients : cur.dailyOpsReportEmailRecipients || [];
          nextRecipients = [...base, req.admin.email];
        } else if (Array.isArray(d.recipients)) {
          nextRecipients = d.recipients;
        }
        if (nextRecipients !== undefined) {
          patch.dailyOpsReportEmailRecipients = nextRecipients;
        }
      }

      const updated = await updatePortalSettings(patch);
      try {
        const { rescheduleDailyOperationsCron } = require("../services/dailyOperationsReportCron");
        void rescheduleDailyOperationsCron();
      } catch (_) {}
      res.json({ settings: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Same handlers as GET /api/reports/daily-ops-snapshots — listed under /api/admin for clients where reports mount differs. */
  router.get("/daily-ops-snapshots", requireAdminJwt, listDailyOpsSnapshots);
  router.get("/daily-ops-snapshots/download", requireAdminJwt, downloadDailyOpsSnapshot);

  router.get("/rbac", requireAdminJwt, async (_req, res) => {
    try {
      const whitelisted = await Promise.all(
        ADMIN_EMAIL_WHITELIST.map(async (em) => {
          const email = normalizeEmail(em);
          const role = await getRbacRoleForEmail(email);
          return { email, role };
        })
      );
      // Include pre-assigned roles for not-yet-whitelisted emails too (e.g. an IT account
      // waiting on its server allowlist entry) so the portal doesn't lose track of them.
      const extraDocs = await AdminRbacAssignment.find({
        email: { $nin: whitelisted.map((r) => r.email) },
      })
        .sort({ email: 1 })
        .lean();
      const items = [...whitelisted, ...extraDocs.map((d) => ({ email: d.email, role: d.role }))];
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put("/rbac", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    try {
      const items = req.body?.items;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "items array required" });
      }
      const allowed = new Set(["super_admin", "fleet_manager", "auditor", "it_support"]);
      const wl = new Set(ADMIN_EMAIL_WHITELIST.map((e) => normalizeEmail(e)));
      for (const row of items) {
        const email = normalizeEmail(row?.email);
        const role = row?.role;
        if (!email || !allowed.has(role)) {
          return res.status(400).json({ error: "Each item needs email and a valid role" });
        }
        // Non-whitelisted emails may still be pre-assigned a role (e.g. a new IT account) —
        // it has no effect until the email is separately added to ADMIN_EMAIL_WHITELIST.
        if (!wl.has(email) && role !== "it_support") {
          return res.status(400).json({ error: "Email not in admin whitelist" });
        }
        await AdminRbacAssignment.findOneAndUpdate(
          { email },
          { $set: { email, role } },
          { upsert: true }
        );
      }
      const rows = await AdminRbacAssignment.find().sort({ email: 1 }).lean();
      res.json({
        items: rows.map((r) => ({ email: r.email, role: r.role })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * "Add IT account" self-service creation (Settings → Admins): email → OTP → password.
   * Super admin only — proves the target inbox is real before it ever gets a working login.
   */
  router.post("/it-accounts/send-otp", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email is required" });
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const count = await AdminItAccountOtp.countDocuments({ email, createdAt: { $gte: oneHourAgo } });
      if (count >= 3) {
        return res.status(429).json({ error: "Too many OTP requests for this email. Try again in about an hour." });
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = await bcrypt.hash(otp, 10);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const otpDoc = await AdminItAccountOtp.create({ email, otpHash, expiresAt, consumed: false, attempts: 0 });

      let sent;
      try {
        sent = await sendItAccountOtpEmail({ to: email, otp });
      } catch (mailErr) {
        await AdminItAccountOtp.deleteOne({ _id: otpDoc._id });
        return res.status(502).json({
          error: mailErr.message || "Could not send email. Check SMTP_* settings in .env.",
        });
      }

      const payload = {
        message: sent.simulated
          ? "OTP generated. Email was not sent (configure SMTP in .env to deliver by mail)."
          : "OTP sent to that email address.",
        simulatedEmail: sent.simulated === true,
      };

      if (sent.simulated && process.env.NODE_ENV !== "production") {
        console.info(`[IT account OTP] ${email} → ${otp} (expires in 5 min — SMTP not configured)`);
        payload.hint =
          "No email was sent. The OTP is in the Admin_Backend terminal. Add SMTP_* to .env to email it, or set OTP_DEV_REVEAL=true to show the code here.";
        if (process.env.OTP_DEV_REVEAL === "true") {
          payload.devOtp = otp;
        }
      }

      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: e.message || "Failed to send OTP" });
    }
  });

  router.post("/it-accounts/verify-otp", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const otp = String(req.body?.otp || "").trim();
      if (!email) return res.status(400).json({ error: "Email is required" });
      if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: "OTP must be 6 digits" });

      const row = await AdminItAccountOtp.findOne({ email, consumed: false }).sort({ createdAt: -1 });
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
      await PasswordResetToken.deleteMany({ email, purpose: "it_account" });
      await PasswordResetToken.create({ email, token: resetToken, expiresAt, purpose: "it_account" });

      return res.json({ message: "OTP verified", resetToken });
    } catch (e) {
      return res.status(500).json({ error: e.message || "OTP verification failed" });
    }
  });

  router.post("/it-accounts/create", requireAdminJwt, requireSuperAdmin, async (req, res) => {
    try {
      const token = String(req.body?.token || "");
      const password = String(req.body?.password || "");
      const confirmPassword = String(req.body?.confirmPassword ?? req.body?.confirm ?? "");
      if (!token || !password) {
        return res.status(400).json({ error: "Token and password required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (confirmPassword && password !== confirmPassword) {
        return res.status(400).json({ error: "Passwords do not match" });
      }

      const row = await PasswordResetToken.findOne({ token, purpose: "it_account" });
      if (!row || row.expiresAt < new Date()) {
        return res.status(400).json({ error: "Verification expired. Start over and request a new code." });
      }

      const email = normalizeEmail(row.email);
      const existing = await PortalUser.findOne({ email }).select("role").lean();
      if (existing && existing.role !== "Admin") {
        return res.status(409).json({
          error: `${email} is already a ${existing.role} account. Choose a different email for the IT account.`,
        });
      }

      const hash = await bcrypt.hash(password, 10);
      const doc = await PortalUser.findOneAndUpdate(
        { email },
        {
          $set: { email, role: "Admin", password: hash, authProvider: "password" },
          $setOnInsert: { firstName: "IT", lastName: "Support" },
        },
        { upsert: true, new: true }
      );
      await AdminRbacAssignment.findOneAndUpdate(
        { email },
        { $set: { email, role: "it_support" } },
        { upsert: true }
      );

      await PasswordResetToken.deleteMany({ email, purpose: "it_account" });

      return res.json({
        message: `IT account created for ${email}. They can sign in now with this email and password.`,
        email: doc.email,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || "Could not create IT account" });
    }
  });

  /** Real backend events (Mongo state changes, uncaught route errors) — powers System Health's Recent Errors panel. */
  router.get("/system-events", requireAdminJwt, (req, res) => {
    const { level, service, limit } = req.query;
    res.json({ items: getSystemEvents({ level, service, limit }) });
  });

  /** Real measured per-route request counts / avg latency / error counts since process start. */
  router.get("/api-metrics", requireAdminJwt, (_req, res) => {
    res.json({ items: getApiMetrics(40) });
  });

  router.get("/audit-log", requireAdminJwt, async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const rows = await AdminAuditLog.find().sort({ createdAt: -1 }).limit(limit).lean();
      res.json({
        items: rows.map((r) => ({
          id: String(r._id),
          email: r.email,
          module: r.module,
          action: r.action,
          details: r.details,
          timestamp: r.createdAt,
          source: r.source,
          statusCode: r.statusCode,
          path: r.path || "",
          httpMethod: r.httpMethod || "",
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/audit-event", requireAdminJwt, async (req, res) => {
    try {
      const body = req.body || {};
      const action = String(body.action || "").toUpperCase();
      const module = String(body.module || "").trim();
      const details = String(body.details || "").trim();
      if (!ALLOWED_CLIENT_ACTIONS.has(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }
      if (!module || module.length > 120) {
        return res.status(400).json({ error: "module is required (max 120 chars)" });
      }
      if (!details || details.length > 2000) {
        return res.status(400).json({ error: "details is required (max 2000 chars)" });
      }
      await AdminAuditLog.create({
        email: req.admin.email,
        module,
        action,
        details,
        httpMethod: "CLIENT",
        path: "",
        statusCode: null,
        source: "client",
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createAdminPortalRouter };
