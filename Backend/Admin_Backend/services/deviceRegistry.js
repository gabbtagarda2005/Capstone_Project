const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const IngestDevice = require("../models/IngestDevice");

/** Registers a new device, bound to one busId. Returns the plaintext secret ONCE — it is never
 *  stored or retrievable again, only its bcrypt hash is. Caller must hand this to whoever is
 *  flashing the physical unit and never log/persist it elsewhere. */
async function createDevice({ deviceId, busId, label }) {
  const id = String(deviceId || "").trim();
  const bid = String(busId || "").trim();
  if (!id) throw Object.assign(new Error("deviceId is required"), { statusCode: 400 });
  if (!bid) throw Object.assign(new Error("busId is required"), { statusCode: 400 });

  const existing = await IngestDevice.findOne({ deviceId: id }).lean();
  if (existing) {
    throw Object.assign(new Error(`Device "${id}" is already registered`), { statusCode: 409 });
  }

  const secret = crypto.randomBytes(24).toString("hex");
  const secretHash = await bcrypt.hash(secret, 12);
  await IngestDevice.create({ deviceId: id, busId: bid, label: label ? String(label).trim() : null, secretHash });
  return { deviceId: id, busId: bid, secret };
}

async function listDevices() {
  const rows = await IngestDevice.find()
    .select("deviceId busId label revoked lastSeenAt createdAt")
    .sort({ createdAt: -1 })
    .lean();
  return rows;
}

async function revokeDevice(deviceId) {
  const id = String(deviceId || "").trim();
  const res = await IngestDevice.updateOne({ deviceId: id }, { $set: { revoked: true } });
  return res.matchedCount > 0;
}

/**
 * @returns {Promise<{ok:true, busId:string}|{ok:false, reason:string}>}
 * Never throws — a lookup/compare failure is just a rejected credential, not a server error.
 */
async function verifyDeviceCredential({ deviceId, secret, claimedBusId }) {
  try {
    const id = String(deviceId || "").trim();
    const s = String(secret || "");
    if (!id || !s) return { ok: false, reason: "missing device id or secret" };

    const doc = await IngestDevice.findOne({ deviceId: id });
    if (!doc) return { ok: false, reason: "unknown device" };
    if (doc.revoked) return { ok: false, reason: "device credential revoked" };

    const match = await bcrypt.compare(s, doc.secretHash);
    if (!match) return { ok: false, reason: "invalid device secret" };

    const claimed = claimedBusId != null ? String(claimedBusId).trim() : "";
    if (claimed && claimed !== doc.busId) {
      return { ok: false, reason: `device is registered to ${doc.busId}, not ${claimed}` };
    }

    doc.lastSeenAt = new Date();
    await doc.save();
    return { ok: true, busId: doc.busId };
  } catch {
    return { ok: false, reason: "device verification error" };
  }
}

module.exports = { createDevice, listDevices, revokeDevice, verifyDeviceCredential };
