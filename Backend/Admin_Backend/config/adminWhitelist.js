/**
 * Only these emails may use the Admin portal login and password recovery.
 * Comparison is case-insensitive; stored values are normalized to lowercase.
 */
const ADMIN_EMAIL_WHITELIST = Object.freeze([
  "2301108330@student.buksu.edu.ph",
  "bukidnonbuscompany2025@gmail.com",
]);

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isAuthorizedAdminEmail(email) {
  const n = normalizeEmail(email);
  return ADMIN_EMAIL_WHITELIST.includes(n);
}

module.exports = { ADMIN_EMAIL_WHITELIST, normalizeEmail, isAuthorizedAdminEmail };
