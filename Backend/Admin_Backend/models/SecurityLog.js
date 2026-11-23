const mongoose = require("mongoose");

const securityLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true },
    busId: { type: String, required: true, index: true },
    message: { type: String, required: true },
    severity: { type: String, default: "critical" },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    assignedRoute: { type: String, default: null },
    currentTerminal: { type: String, default: null },
    source: { type: String, default: "admin_portal" },
    /** Attendant / operator display at SOS time */
    attendantDisplayName: { type: String, default: null },
    attendantEmail: { type: String, default: null },
    driverDisplayName: { type: String, default: null },
    plateNumber: { type: String, default: null },
    /** accident | mechanical | traffic — set on attendant_incident reports only (see
     *  routes/buses.js "/attendant-incident"); lets passengerCommandFeed.js query by category
     *  without parsing the free-text `message` string. */
    category: { type: String, default: null },
    /** Attendant's free-text note at report time, kept separate from `message` (which bundles
     *  bus/plate context) so passenger-facing copy can be built from just this. */
    note: { type: String, default: null },
    /** Resolution (SOS intercept protocol) */
    resolutionNotes: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedByEmail: { type: String, default: null },
  },
  { timestamps: true, collection: "security_logs" }
);

securityLogSchema.index({ resolvedAt: 1 });

module.exports = mongoose.models.SecurityLog || mongoose.model("SecurityLog", securityLogSchema);
