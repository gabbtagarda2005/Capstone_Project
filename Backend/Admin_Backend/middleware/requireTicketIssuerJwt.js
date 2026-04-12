const jwt = require("jsonwebtoken");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");

/**
 * Allows Admin (whitelist) or Operator to call ticket-issuance routes.
 */
function requireTicketIssuerJwt(req, res, next) {
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
    const role = payload.role;
    if (role === "Admin") {
      const email = normalizeEmail(payload.email);
      if (!isAuthorizedAdminEmail(email)) {
        return res.status(403).json({ error: "Access Denied: Unauthorized Admin Account" });
      }
    } else {
      const compact = String(role || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "");
      const okOp = compact === "operator" || compact === "busattendant";
      if (!okOp) {
        return res.status(403).json({ error: "Operator or Admin token required" });
      }
    }

    req.ticketingUser = {
      sub: payload.sub,
      role,
      email: payload.email,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireTicketIssuerJwt };
