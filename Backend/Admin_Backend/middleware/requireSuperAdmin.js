/**
 * Must run after requireAdminJwt (req.admin populated).
 */
function requireSuperAdmin(req, res, next) {
  if (!req.admin?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const isSuper = req.admin.rbacRole === "super_admin" || req.admin.tier === "super";
  if (!isSuper) {
    return res.status(403).json({ error: "Super Admin privileges required for this action" });
  }
  next();
}

module.exports = { requireSuperAdmin };
