const { normalizeEmail } = require("../config/adminWhitelist");
const { isSuperAdminEmail } = require("../config/adminRoles");
const AdminRbacAssignment = require("../models/AdminRbacAssignment");

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
 * @returns {'super_admin'|'fleet_manager'|'auditor'}
 */
async function getRbacRoleForEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  const doc = await AdminRbacAssignment.findOne({ email }).lean();
  if (doc?.role) return doc.role;
  if (isSuperAdminEmail(email)) return "super_admin";
  return "fleet_manager";
}

module.exports = { seedRbacAssignments, getRbacRoleForEmail, DEFAULT_ASSIGNMENTS };
