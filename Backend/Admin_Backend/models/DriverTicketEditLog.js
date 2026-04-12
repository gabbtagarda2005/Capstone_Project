const mongoose = require("mongoose");

/**
 * Audit: driver 6-digit PIN used to authorize a ticket correction by an attendant.
 */
const driverTicketEditLogSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    ticketMysqlId: { type: Number, default: null, index: true },
    ticketMongoId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    attendantOperatorId: { type: Number, default: null },
    attendantIssuerSub: { type: String, default: null, trim: true },
    attendantName: { type: String, default: "", trim: true },
    busNumber: { type: String, default: "", trim: true },
  },
  { timestamps: true, collection: "driver_ticket_edit_logs" }
);

module.exports =
  mongoose.models.DriverTicketEditLog || mongoose.model("DriverTicketEditLog", driverTicketEditLogSchema);
