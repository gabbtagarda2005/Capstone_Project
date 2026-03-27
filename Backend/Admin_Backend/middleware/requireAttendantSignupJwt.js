const jwt = require("jsonwebtoken");
const { normalizeEmail } = require("../config/adminWhitelist");

function requireAttendantSignupJwt(req, res, next) {
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
    if (payload.purpose !== "attendant_signup") {
      return res.status(403).json({ error: "Invalid signup token" });
    }
    const email = normalizeEmail(payload.email);
    if (!email) {
      return res.status(403).json({ error: "Invalid signup token" });
    }
    req.attendantSignup = { email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired signup token" });
  }
}

module.exports = { requireAttendantSignupJwt };
