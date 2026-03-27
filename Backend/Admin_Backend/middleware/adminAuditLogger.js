const jwt = require("jsonwebtoken");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");
const { getAdminTier } = require("../config/adminRoles");
const AdminAuditLog = require("../models/AdminAuditLog");

function tryParseAdminSubject(req) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(h.slice(7), secret);
    if (payload.role !== "Admin") return null;
    const email = normalizeEmail(payload.email);
    if (!isAuthorizedAdminEmail(email)) return null;
    return {
      email,
      operatorId: payload.sub,
      tier: getAdminTier(email),
    };
  } catch {
    return null;
  }
}

function fullPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

const AUTH_SKIP_PREFIXES = [
  "/api/auth/login",
  "/api/auth/google-login",
  "/api/auth/operator-login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-otp",
];

function shouldSkipAudit(path) {
  if (!path.startsWith("/api/")) return true;
  for (const pre of AUTH_SKIP_PREFIXES) {
    if (path === pre || path.startsWith(pre + "/")) return true;
  }
  if (path === "/api/buses/live") return true;
  if (path.startsWith("/api/reports")) return true;
  if (path.startsWith("/api/admin/audit-event")) return true;
  return false;
}

function shouldSkipGet(path) {
  if (path.includes("/live")) return true;
  if (path === "/api/tickets" || path.startsWith("/api/tickets/")) return true;
  if (path.startsWith("/api/reports")) return true;
  if (path.startsWith("/api/security/logs")) return true;
  return false;
}

function mapHttpAction(method) {
  const m = String(method || "").toUpperCase();
  if (m === "POST") return "ADD";
  if (m === "PUT" || m === "PATCH") return "EDIT";
  if (m === "DELETE") return "DELETE";
  if (m === "GET") return "VIEW";
  return m;
}

function mapModule(path) {
  if (path.startsWith("/api/fares")) return "Fare Management";
  if (path.startsWith("/api/locations")) return "Location Management";
  if (path.startsWith("/api/corridor-routes")) return "Route Management";
  if (path.startsWith("/api/buses")) return "Bus Management";
  if (path.startsWith("/api/driver-signup")) return "Driver Management";
  if (path.startsWith("/api/drivers")) return "Driver Management";
  if (path.startsWith("/api/attendants")) return "Attendant Management";
  if (path.startsWith("/api/operators")) return "Operator Management";
  if (path.startsWith("/api/tickets")) return "Ticket Management";
  if (path.startsWith("/api/auth")) return "Authentication";
  if (path.startsWith("/api/reports")) return "Reports";
  if (path.startsWith("/api/security")) return "Security";
  if (path.startsWith("/api/admin")) return "Administration";
  return "Admin API";
}

function safeBodySnippet(req) {
  if (!req.body || typeof req.body !== "object") return "";
  const keys = Object.keys(req.body).filter(
    (k) => !/password|token|idToken|secret/i.test(k)
  );
  const slim = {};
  for (const k of keys.slice(0, 8)) {
    let v = req.body[k];
    if (v != null && typeof v === "object") v = "[object]";
    slim[k] = v;
  }
  try {
    const s = JSON.stringify(slim);
    return s.length > 280 ? `${s.slice(0, 277)}…` : s;
  } catch {
    return "";
  }
}

function buildDetails(req, path, action) {
  const method = String(req.method || "").toUpperCase();
  const snippet = safeBodySnippet(req);
  const base = `${method} ${path}`;
  if (snippet && (action === "ADD" || action === "EDIT")) {
    return `${base}${snippet ? ` — ${snippet}` : ""}`;
  }
  return base;
}

/**
 * Logs whitelisted Admin JWT activity on /api/* (mutations always; selective GET).
 */
function adminAuditLogger(req, res, next) {
  const path = fullPath(req);
  if (!path.startsWith("/api")) return next();
  if (shouldSkipAudit(path)) return next();

  const subject = tryParseAdminSubject(req);
  if (!subject) return next();

  const method = String(req.method || "").toUpperCase();
  if (method === "GET" && shouldSkipGet(path)) return next();

  let logged = false;
  const finish = () => {
    if (logged) return;
    logged = true;
    const action = mapHttpAction(method);
    if (method === "GET" && res.statusCode >= 400) return;

    const details = buildDetails(req, path, action);
    AdminAuditLog.create({
      email: subject.email,
      module: mapModule(path),
      action,
      details,
      httpMethod: method,
      path,
      statusCode: res.statusCode,
      source: "http",
    }).catch(() => {});
  };

  res.on("finish", finish);

  next();
}

module.exports = { adminAuditLogger, tryParseAdminSubject, mapModule, mapHttpAction };
