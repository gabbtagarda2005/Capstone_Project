const mongoose = require("mongoose");
const AdminAuthLockout = require("../models/AdminAuthLockout");
const { normalizeEmail } = require("../config/adminWhitelist");
const { getPortalSettingsLean } = require("./adminPortalSettingsService");

function lockKeyFor(scope, rawEmail) {
  const email = normalizeEmail(rawEmail);
  const s = scope === "attendant" ? "attendant" : "admin";
  return `${s}:${email}`;
}

let initPromise = null;

/**
 * Backfill lockKey, fix indexes once per process (legacy docs had only email + unique on email).
 */
async function initAdminAuthLockout() {
  if (!initPromise) {
    initPromise = (async () => {
  try {
    const coll = mongoose.connection.collection("admin_auth_lockouts");
    const cursor = coll.find({
      $or: [{ lockKey: { $exists: false } }, { lockKey: null }, { lockKey: "" }],
    });
    for await (const doc of cursor) {
      const em = normalizeEmail(doc.email);
      if (!em) continue;
      await coll.updateOne({ _id: doc._id }, { $set: { lockKey: lockKeyFor("admin", em), email: em } });
    }
    const idxes = await coll.indexes();
    for (const ix of idxes) {
      const k = ix.key || {};
      if (ix.unique && k.email === 1 && k.lockKey == null && ix.name && ix.name !== "_id_") {
        try {
          await coll.dropIndex(ix.name);
        } catch {
          /* ignore */
        }
      }
    }
    await AdminAuthLockout.syncIndexes();
  } catch (e) {
    console.warn("[adminAuthLockout] init:", e.message || e);
  }
    })();
  }
  return initPromise;
}

async function isLockedOut(rawEmail, scope = "admin") {
  await initAdminAuthLockout();
  const email = normalizeEmail(rawEmail);
  const lockKey = lockKeyFor(scope, email);
  const doc = await AdminAuthLockout.findOne({ lockKey }).lean();
  if (!doc?.lockedUntil) return { locked: false, email };
  if (doc.lockedUntil > new Date()) {
    return { locked: true, lockedUntil: doc.lockedUntil, email };
  }
  await AdminAuthLockout.updateOne(
    { lockKey },
    { $set: { lockedUntil: null, failedAttempts: 0 } }
  );
  return { locked: false, email };
}

async function recordFailedLoginAttempt(rawEmail, scope = "admin") {
  await initAdminAuthLockout();
  const email = normalizeEmail(rawEmail);
  const lockKey = lockKeyFor(scope, email);
  const settings = await getPortalSettingsLean();
  const max = Math.min(10, Math.max(3, Number(settings.maxLoginAttempts) || 5));
  const lockoutMin = Math.min(1440, Math.max(5, Number(settings.lockoutMinutes) || 15));

  let doc = await AdminAuthLockout.findOne({ lockKey });
  if (!doc) {
    doc = await AdminAuthLockout.create({ lockKey, email, failedAttempts: 0 });
  }
  const next = (doc.failedAttempts || 0) + 1;
  const update = { failedAttempts: next };
  if (next >= max) {
    update.lockedUntil = new Date(Date.now() + lockoutMin * 60 * 1000);
  }
  await AdminAuthLockout.updateOne({ lockKey }, { $set: update });
  return {
    failedAttempts: next,
    locked: next >= max,
    maxAttempts: max,
    lockoutMinutes: lockoutMin,
  };
}

async function clearLockoutOnSuccess(rawEmail, scope = "admin") {
  await initAdminAuthLockout();
  const email = normalizeEmail(rawEmail);
  const lockKey = lockKeyFor(scope, email);
  await AdminAuthLockout.findOneAndUpdate(
    { lockKey },
    { $set: { failedAttempts: 0, lockedUntil: null, email } },
    { upsert: true }
  );
}

module.exports = {
  initAdminAuthLockout,
  isLockedOut,
  recordFailedLoginAttempt,
  clearLockoutOnSuccess,
};
