const jwt = require("jsonwebtoken");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");
const { getAdminTier } = require("../config/adminRoles");
const { getRbacRoleForEmail } = require("../services/adminRbac");

async function requireAdminJwt(req, res, next) {
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
    const rbacRole = await getRbacRoleForEmail(email);
    req.admin = {
      operatorId: payload.sub,
      role: payload.role,
      email,
      tier: getAdminTier(email),
      rbacRole,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAdminJwt };
