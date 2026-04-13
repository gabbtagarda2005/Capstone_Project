const mongoose = require("mongoose");

/**
 * Ticketing when MySQL `tickets` table is not configured — keeps issuance for Admin + attendant sync.
 * Collection: issued_ticket_records
 */
const issuedTicketRecordSchema = new mongoose.Schema(
  {
    passengerId: { type: String, required: true, trim: true, index: true },
    passengerName: { type: String, default: "", trim: true },
    /** Optional mobile for SMS receipt (local or E.164; stored as provided). */
    passengerPhone: { type: String, default: null, trim: true },
    startLocation: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    /** Mirrors `destination` for APIs that expect this name; kept in sync on write. */
    destinationLocation: { type: String, default: "", trim: true },
    fare: { type: Number, required: true },
    passengerCategory: { type: String, default: "regular", trim: true },
    /** JWT `sub` — PortalUser ObjectId hex (legacy tickets may still have numeric issuerMysqlId). */
    issuerSub: { type: String, required: true, index: true },
    issuerMysqlId: { type: Number, default: null, index: true },
    issuedByName: { type: String, default: "", trim: true },
    busNumber: { type: String, default: null, trim: true },
    /**
     * Passenger seat intel: `boarded` counts toward live occupancy until `completed` (alighted) or `cancelled`.
     * Legacy docs without this field are treated as boarded.
     */
    boardingStatus: {
      type: String,
      enum: ["boarded", "completed", "cancelled"],
      default: "boarded",
      index: true,
    },
  },
  { timestamps: true, collection: "issued_ticket_records" }
);

issuedTicketRecordSchema.index({ createdAt: -1 });
issuedTicketRecordSchema.index({ busNumber: 1, createdAt: -1 });

module.exports =
  mongoose.models.IssuedTicketRecord || mongoose.model("IssuedTicketRecord", issuedTicketRecordSchema);
