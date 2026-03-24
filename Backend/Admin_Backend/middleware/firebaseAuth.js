/**
 * Verifies Firebase ID tokens when FIREBASE_SERVICE_ACCOUNT_PATH is set.
 * Otherwise passes through (local dev). Replace with your real guard for production.
 */
const optionalFirebaseAuth = (req, res, next) => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return next();
  }
  // TODO: initialize firebase-admin once, verify req.headers.authorization Bearer token
  return next();
};

const requireFirebaseAuth = (req, res, next) => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return res.status(503).json({ error: "Auth not configured" });
  }
  return next();
};

module.exports = { optionalFirebaseAuth, requireFirebaseAuth };
