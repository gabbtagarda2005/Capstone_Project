const { normalizeEmail, isAuthorizedAdminEmail } = require("../config/adminWhitelist");
const { isSuperAdminEmail } = require("../config/adminRoles");
const AdminRbacAssignment = require("../models/AdminRbacAssignment");
const PortalUser = require("../models/PortalUser");

const DEFAULT_ASSIGNMENTS = [
  { email: "bukidnonbuscompany2025@gmail.com", role: "super_admin" },
  { email: "2301108330@student.buksu.edu.ph", role: "fleet_manager" },
];

async function seedRbacAssignments() {
  for (const row of DEFAULT_ASSIGNMENTS) {
    const email = normalizeEmail(row.email);
    await AdminRbacAssignment.findOneAndUpdate(
      { email },
      { $setOnInsert: { email, role: row.role } },
      { upsert: true }
    );
  }
}

/**
 * @returns {'super_admin'|'fleet_manager'|'auditor'|'it_support'}
 */
async function getRbacRoleForEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  const doc = await AdminRbacAssignment.findOne({ email }).lean();
  if (doc?.role) return doc.role;
  if (isSuperAdminEmail(email)) return "super_admin";
  return "fleet_manager";
}

/**
 * Login gate: the hardcoded ADMIN_EMAIL_WHITELIST, plus self-service IT accounts created via
 * the "Add IT account" OTP + password flow (Settings → Admins). A self-service account only
 * counts once it actually has both the it_support RBAC assignment AND a password on file —
 * that pairing is proof the creation flow completed, not just that a role was pre-assigned.
 */
async function isAuthorizedAdminEmailDynamic(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (isAuthorizedAdminEmail(email)) return true;
  const assignment = await AdminRbacAssignment.findOne({ email, role: "it_support" }).select("_id").lean();
  if (!assignment) return false;
  const user = await PortalUser.findOne({ email, role: "Admin" }).select("password").lean();
  return Boolean(user?.password);
}

module.exports = {
  seedRbacAssignments,
  getRbacRoleForEmail,
  isAuthorizedAdminEmailDynamic,
  DEFAULT_ASSIGNMENTS,
};
