const jwt = require("jsonwebtoken");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");

/**
 * Verifies admin JWT + whitelist only (no Mongo RBAC lookup).
 * Use for low-risk read endpoints (e.g. geocode proxy) so a DB hiccup cannot
 * masquerade as "Invalid token" or block search.
 */
function requireAdminJwtLite(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "JWT_SECRET not configured" });
  }

  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(h.slice(7), secret);
    if (payload.role !== "Admin") {
      return res.status(403).json({ error: "Admin access only" });
    }
    const email = normalizeEmail(payload.email);
    if (!isAuthorizedAdminEmail(email)) {
      return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
    }
    req.admin = { operatorId: payload.sub, email, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAdminJwtLite };
