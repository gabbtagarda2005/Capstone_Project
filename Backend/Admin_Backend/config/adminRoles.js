const { normalizeEmail } = require("./adminWhitelist");

/** Full delete + global fare rules (PUT /api/fares/settings). */
const SUPER_ADMIN_EMAILS = Object.freeze(new Set(["bukidnonbuscompany2025@gmail.com"]));

function isSuperAdminEmail(email) {
  return SUPER_ADMIN_EMAILS.has(normalizeEmail(email));
}

/** Whitelist is enforced elsewhere; every authorized admin is at least `manager`. */
function getAdminTier(email) {
  return isSuperAdminEmail(email) ? "super" : "manager";
}

module.exports = { SUPER_ADMIN_EMAILS, isSuperAdminEmail, getAdminTier };
