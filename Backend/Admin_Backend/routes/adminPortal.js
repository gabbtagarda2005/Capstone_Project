const express = require("express");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { requireSuperAdmin } = require("../middleware/requireSuperAdmin");
const { ADMIN_EMAIL_WHITELIST, normalizeEmail } = require("../config/adminWhitelist");
const AdminAuditLog = require("../models/AdminAuditLog");
const AdminRbacAssignment = require("../models/AdminRbacAssignment");
const AttendantRegistry = require("../models/AttendantRegistry");
const Bus = require("../models/Bus");
const CorridorRoute = require("../models/CorridorRoute");
const Driver = require("../models/Driver");
const FareMatrixEntry = require("../models/FareMatrixEntry");
const FareRoute = require("../models/FareRoute");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const PortalUser = require("../models/PortalUser");
const RouteCoverage = require("../models/RouteCoverage");
const liveDispatchStore = require("../services/liveDispatchStore");
const { getPortalSettingsLean, updatePortalSettings } = require("../services/adminPortalSettingsService");
const { getRbacRoleForEmail } = require("../services/adminRbac");
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
      const items = await Promise.all(
        ADMIN_EMAIL_WHITELIST.map(async (em) => {
          const email = normalizeEmail(em);
          const role = await getRbacRoleForEmail(email);
          return { email, role };
        })
      );
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
      const allowed = new Set(["super_admin", "fleet_manager", "auditor"]);
      const wl = new Set(ADMIN_EMAIL_WHITELIST.map((e) => normalizeEmail(e)));
      for (const row of items) {
        const email = normalizeEmail(row?.email);
        const role = row?.role;
        if (!email || !allowed.has(role)) {
          return res.status(400).json({ error: "Each item needs email and a valid role" });
        }
        if (!wl.has(email)) {
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
