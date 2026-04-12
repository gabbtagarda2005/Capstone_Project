const mongoose = require("mongoose");

/**
 * Central bus registry — collection: buses
 *
 * Maps to the admin "Register new bus" form:
 * - busId / busNumber: unique vehicle id (e.g. BUK-101), matched on ticket issue for counters
 * - imei: 15-digit GPS hardware id (device ping + map)
 * - operatorMysqlId: attendant link → MySQL bus_operators.operator_id (attendant dropdown; optional when MySQL disabled)
 * - operatorPortalUserId: attendant link → Mongo PortalUser _id (attendant dropdown; used when MySQL disabled)
 * - driverId: ObjectId ref Driver (driver dropdown)
 * - route: corridor string
 * - healthStatus / ticketsIssued: maintained by busMaintenance + POST /api/tickets/issue
 */
const busSchema = new mongoose.Schema(
  {
    busId: { type: String, required: true, unique: true, index: true },
    busNumber: { type: String, default: null, index: true },
    plateNumber: { type: String, default: "—" },
    /** Nominal passenger seat capacity (admin-configured). */
    seatCapacity: { type: Number, default: 50, min: 1, max: 300 },
    imei: { type: String, default: null, unique: true, sparse: true, index: true },
    /** MySQL bus_operators.operator_id when using ticketing DB */
    operatorMysqlId: { type: Number, default: null, index: true },
    /** Mongo PortalUser _id when using Mongo-only onboarding (no ticketing MySQL) */
    operatorPortalUserId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalUser", default: null, index: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", default: null },
    route: { type: String, default: null },
    /** If true, ticketing allowed only inside authorized terminal/stop geofences. */
    /** When true, future features may restrict issuance to geofenced stops; ticketing does not enforce this by default. */
    strictPickup: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["Active", "Maintenance", "Inactive"],
      default: "Active",
    },
    healthStatus: {
      type: String,
      enum: ["Good", "Needs Maintenance", "Due for Inspection"],
      default: "Good",
    },
    ticketsIssued: { type: Number, default: 0, min: 0 },
    lastUpdated: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "buses" }
);

module.exports = mongoose.models.Bus || mongoose.model("Bus", busSchema);
