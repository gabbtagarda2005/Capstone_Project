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
    /**
     * E.164 number of THIS device's own SIM — used only to authorize inbound SMS-fallback GPS
     * (see services/smsGpsReceiver.js). Doubles as the AUTHORIZED_SMS_DEVICES allowlist: an SMS
     * is only accepted as a GPS fix if its sender number matches a non-revoked device here, and
     * the SMS body's claimed busId is cross-checked against this row's busId.
     */
    smsSenderNumber: { type: String, default: null, unique: true, sparse: true, index: true },
  },
  { timestamps: true, collection: "ingest_devices" }
);

module.exports = mongoose.models.IngestDevice || mongoose.model("IngestDevice", ingestDeviceSchema);
