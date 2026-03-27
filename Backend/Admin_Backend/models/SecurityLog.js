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
  },
  { timestamps: true, collection: "security_logs" }
);

module.exports = mongoose.models.SecurityLog || mongoose.model("SecurityLog", securityLogSchema);
