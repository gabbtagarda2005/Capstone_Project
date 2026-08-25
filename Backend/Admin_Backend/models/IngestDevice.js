const mongoose = require("mongoose");

/**
 * Per-device LILYGO credential — replaces the single fleet-wide DEVICE_INGEST_SECRET for units
 * that have been individually registered. A device is bound to exactly one busId server-side,
 * so even a leaked/cloned credential can only ever report as that one bus, not impersonate others.
 */
const ingestDeviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, index: true },
    busId: { type: String, required: true, index: true },
    label: { type: String, default: null },
    secretHash: { type: String, required: true },
    revoked: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "ingest_devices" }
);

module.exports = mongoose.models.IngestDevice || mongoose.model("IngestDevice", ingestDeviceSchema);
