const AttendantRegistry = require("../models/AttendantRegistry");
const Driver = require("../models/Driver");
const PortalUser = require("../models/PortalUser");

/**
 * True if this 6-digit string is already used by registry, portal user, or driver.
 * @param {string} code six digits
 */
async function isSixDigitTaken(code) {
  if (!/^\d{6}$/.test(code)) return true;
  const reg = await AttendantRegistry.findOne({ employeeNumber: code }).select("_id").lean();
  if (reg) return true;
  const pu = await PortalUser.findOne({ employeeNumber: code }).select("_id").lean();
  if (pu) return true;
  const drv = await Driver.findOne({ driverId: code }).select("_id").lean();
  if (drv) return true;
  return false;
}

/**
 * Allocate a unique 6-digit ID shared across attendants and drivers (no collisions between roles).
 */
async function allocateUniqueSixDigit() {
  for (let i = 0; i < 100; i += 1) {
    const code = String(100000 + Math.floor(Math.random() * 900000));
    if (!(await isSixDigitTaken(code))) return code;
  }
  throw new Error("Could not allocate a unique 6-digit personnel ID");
}

module.exports = { allocateUniqueSixDigit, isSixDigitTaken };
