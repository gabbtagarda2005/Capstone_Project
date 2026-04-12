const mongoose = require("mongoose");

const stopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    sequence: { type: Number, required: true, min: 1 },
    /** Same corridor chainage as terminal.kilometersFromStart (km from shared origin). */
    kilometersFromStart: { type: Number, min: 0 },
    geofenceRadiusM: { type: Number, default: 100, min: 10 },
    // When false, strict pickup buses will NOT allow pickups at this stop.
    // Default is true for backward compatibility (existing stops keep working).
    pickupOnly: { type: Boolean, default: true },
  },
  { _id: false }
);

const routeCoverageSchema = new mongoose.Schema(
  {
    locationName: { type: String, required: true, trim: true, index: true },
    pointType: { type: String, enum: ["terminal", "stop"], default: "terminal" },
    terminal: {
      name: { type: String, required: true, trim: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      geofenceRadiusM: { type: Number, default: 500, min: 50 },
      // When false, strict pickup buses will NOT allow pickups at the terminal.
      pickupOnly: { type: Boolean, default: true },
      /** Optional chainage (km) from a corridor origin — used for fare: base + |stopKm − terminalKm| × fare/km. */
      kilometersFromStart: { type: Number, min: 0 },
    },
    /** Optional corridor/location pinpoint (separate from terminal hub center). */
    locationPoint: {
      name: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    /**
     * Inbound corridor ordering: stops with sequence < this value are "before" the hub terminal
     * along the modeled route. Pricing for those stops is controlled by [preTerminalStopFarePolicy].
     */
    terminalInboundSequence: { type: Number, min: 1 },
    /**
     * For stops with sequence < terminalInboundSequence on inter-hub trips:
     * - distance_only (default): origin hub terminal → stop × fare/km only (no matrix to destination hub).
     * - matrix_plus_corridor_delta: hub-to-hub matrix + |km_stop−km_terminal|×fare/km (after-terminal style spurs).
     */
    preTerminalStopFarePolicy: {
      type: String,
      enum: ["matrix_plus_corridor_delta", "distance_only"],
      default: "distance_only",
    },
    stops: { type: [stopSchema], default: [] },
  },
  { timestamps: true, collection: "route_coverage" }
);

module.exports = mongoose.models.RouteCoverage || mongoose.model("RouteCoverage", routeCoverageSchema);

