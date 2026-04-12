const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { normalizeEmail } = require("../config/adminWhitelist");
const { isSuperAdminEmail } = require("../config/adminRoles");
const { getRbacRoleForEmail } = require("../services/adminRbac");
const { getSettingsForShield } = require("../services/adminPortalSettingsService");

/**
 * Auth paths that stay reachable during maintenance (admin recovery + password flows).
 * Operator / attendant auth routes are NOT listed — they receive 503 JSON.
 */
const MAINTENANCE_AUTH_ALLOW = new Set([
  "/api/auth/login",
  "/api/auth/google-login",
  "/api/auth/forgot-password",
  "/api/auth/forgot-password-otp",
  "/api/auth/verify-otp",
  "/api/auth/reset-password",
  "/api/auth/validate-reset-token",
  "/api/auth/me",
]);

function pathKey(req) {
  const p = req.originalUrl || req.url || "";
  const q = p.indexOf("?");
  return q >= 0 ? p.slice(0, q) : p;
}

async function isSuperAdminRequest(req) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return false;
  try {
    const payload = jwt.verify(h.slice(7), secret);
    if (payload.role !== "Admin") return false;
    const email = normalizeEmail(payload.email);
    if (!email) return false;
    if (isSuperAdminEmail(email)) return true;
    const rbac = await getRbacRoleForEmail(email);
    return rbac === "super_admin";
  } catch {
    return false;
  }
}

/**
 * When maintenance shield is ON: return 503 JSON for API traffic except super-admin JWT and allowlisted auth routes.
 */
async function maintenanceShieldMiddleware(req, res, next) {
  if (req.method === "OPTIONS") {
    return next();
  }
  const path = pathKey(req);

  if (
    path === "/health" ||
    path === "/api/public/maintenance-status" ||
    path === "/api/public/broadcast/passenger" ||
    path === "/api/public/broadcast/attendant"
  ) {
    return next();
  }

  if (mongoose.connection.readyState !== 1) {
    return next();
  }

  let settings;
  try {
    settings = await getSettingsForShield();
  } catch {
    return next();
  }

  if (!settings.maintenanceShieldEnabled) {
    return next();
  }

  const passengerLocked = settings.maintenancePassengerLocked !== false;
  const attendantLocked = settings.maintenanceAttendantLocked !== false;
  /** Full Admin API freeze only when both apps are in maintenance (legacy behavior). Otherwise apps rely on client lockout + partial API access. */
  if (!(passengerLocked && attendantLocked)) {
    return next();
  }

  if (MAINTENANCE_AUTH_ALLOW.has(path)) {
    return next();
  }

  if (await isSuperAdminRequest(req)) {
    return next();
  }

  const msg =
    settings.maintenanceMessage && String(settings.maintenanceMessage).trim()
      ? String(settings.maintenanceMessage).trim()
      : "System maintenance in progress.";

  return res.status(503).json({
    maintenance: true,
    message: msg,
    scheduledUntil:
      settings.maintenanceScheduledUntil instanceof Date
        ? settings.maintenanceScheduledUntil.toISOString()
        : settings.maintenanceScheduledUntil || null,
    minClientVersion: settings.minAttendantAppVersion || null,
    fleetMode: settings.fleetMode || "standard",
  });
}

module.exports = { maintenanceShieldMiddleware };
