const mongoose = require("mongoose");

/**
 * Named bus stops for ticketing / fare logic (separate from RouteCoverage hubs).
 * Collection: ticket_locations
 */
const ticketLocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    sequence: { type: Number, required: true, min: 1 },
  },
  { timestamps: true, collection: "ticket_locations" }
);

ticketLocationSchema.index({ sequence: 1 });
ticketLocationSchema.index({ name: 1 });

module.exports = mongoose.models.TicketLocation || mongoose.model("TicketLocation", ticketLocationSchema);
