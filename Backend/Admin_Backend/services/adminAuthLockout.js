const AdminAuthLockout = require("../models/AdminAuthLockout");
const { normalizeEmail } = require("../config/adminWhitelist");
const { getPortalSettingsLean } = require("./adminPortalSettingsService");

async function getLockoutDoc(email) {
  const em = normalizeEmail(email);
  return AdminAuthLockout.findOne({ email: em }).lean();
}

async function isLockedOut(rawEmail) {
  const email = normalizeEmail(rawEmail);
  const doc = await getLockoutDoc(email);
  if (!doc?.lockedUntil) return { locked: false, email };
  if (doc.lockedUntil > new Date()) {
    return { locked: true, lockedUntil: doc.lockedUntil, email };
  }
  await AdminAuthLockout.updateOne(
    { email },
    { $set: { lockedUntil: null, failedAttempts: 0 } }
  );
  return { locked: false, email };
}

async function recordFailedLoginAttempt(rawEmail) {
  const email = normalizeEmail(rawEmail);
  const settings = await getPortalSettingsLean();
  const max = Math.min(10, Math.max(3, Number(settings.maxLoginAttempts) || 5));
  const lockoutMin = Math.min(1440, Math.max(5, Number(settings.lockoutMinutes) || 15));

  let doc = await AdminAuthLockout.findOne({ email });
  if (!doc) {
    doc = await AdminAuthLockout.create({ email, failedAttempts: 0 });
  }
  const next = (doc.failedAttempts || 0) + 1;
  const update = { failedAttempts: next };
  if (next >= max) {
    update.lockedUntil = new Date(Date.now() + lockoutMin * 60 * 1000);
  }
  await AdminAuthLockout.updateOne({ email }, { $set: update });
  return {
    failedAttempts: next,
    locked: next >= max,
    maxAttempts: max,
    lockoutMinutes: lockoutMin,
  };
}

async function clearLockoutOnSuccess(rawEmail) {
  const email = normalizeEmail(rawEmail);
  await AdminAuthLockout.findOneAndUpdate(
    { email },
    { $set: { failedAttempts: 0, lockedUntil: null } },
    { upsert: true }
  );
}

module.exports = {
  isLockedOut,
  recordFailedLoginAttempt,
  clearLockoutOnSuccess,
};
