const jwt = require("jsonwebtoken");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");
const { getRbacRoleForEmail } = require("../services/adminRbac");

function fullPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

/**
 * Global API guard: Auditor is read-only; Fleet Manager cannot mutate fare endpoints.
 * Runs after express.json; invalid/expired JWT is ignored (route-level auth returns 401).
 */
async function enforceAdminRbac(req, res, next) {
  const path = fullPath(req);
  if (!path.startsWith("/api")) return next();

  const secret = process.env.JWT_SECRET;
  if (!secret) return next();

  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return next();

  let payload;
  try {
    payload = jwt.verify(h.slice(7), secret);
  } catch {
    return next();
  }

  if (payload.role !== "Admin") return next();

  const email = normalizeEmail(payload.email);
  if (!isAuthorizedAdminEmail(email)) return next();

  let rbacRole;
  try {
    rbacRole = await getRbacRoleForEmail(email);
  } catch {
    return next();
  }

  const method = String(req.method || "").toUpperCase();

  if (rbacRole === "auditor" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    return res.status(403).json({ error: "Read-only role cannot modify data" });
  }

  if (rbacRole === "fleet_manager") {
    if (path.startsWith("/api/fares") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      return res.status(403).json({ error: "Fleet Manager cannot change fare policies" });
    }
  }

  next();
}

module.exports = { enforceAdminRbac };
