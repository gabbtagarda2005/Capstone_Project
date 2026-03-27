const mongoose = require("mongoose");

const stopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    sequence: { type: Number, required: true, min: 1 },
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
    },
    stops: { type: [stopSchema], default: [] },
  },
  { timestamps: true, collection: "route_coverage" }
);

module.exports = mongoose.models.RouteCoverage || mongoose.model("RouteCoverage", routeCoverageSchema);

