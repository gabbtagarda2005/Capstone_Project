const mongoose = require("mongoose");

const authorizedStopSchema = new mongoose.Schema(
  {
    coverageId: { type: mongoose.Schema.Types.ObjectId, ref: "RouteCoverage", required: true },
    sequence: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    geofenceRadiusM: { type: Number, default: 100, min: 10 },
    /** false = flexible corridor (pickup anywhere along segment after this stop); true = strict (default). */
    pickupOnly: { type: Boolean, default: true },
  },
  { _id: false }
);

const corridorRouteSchema = new mongoose.Schema(
  {
    displayName: { type: String, trim: true, default: "" },
    originCoverageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RouteCoverage",
      required: true,
      index: true,
    },
    destinationCoverageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RouteCoverage",
      required: true,
      index: true,
    },
    /** Terminal coverage hubs between origin and destination (order preserved). */
    viaCoverageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "RouteCoverage" }],
      default: [],
    },
    authorizedStops: { type: [authorizedStopSchema], default: [] },
    /** When true, corridor is hidden from live dispatch surfaces until resumed. */
    suspended: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "corridor_routes" }
);

module.exports =
  mongoose.models.CorridorRoute || mongoose.model("CorridorRoute", corridorRouteSchema);
