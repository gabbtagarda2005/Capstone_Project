const mongoose = require("mongoose");

/**
 * Mirror of deployed corridor topology for fare pathfinding (Atlas collection `FareRoutes`).
 * Kept in sync from Admin corridor route CRUD; `farePricing` also reads legacy `corridor_routes`.
 */
const authorizedStopSchema = new mongoose.Schema(
  {
    coverageId: { type: mongoose.Schema.Types.ObjectId, ref: "RouteCoverage", required: true },
    sequence: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    geofenceRadiusM: { type: Number, default: 100, min: 10 },
    pickupOnly: { type: Boolean, default: true },
  },
  { _id: false }
);

const fareRouteSchema = new mongoose.Schema(
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
    viaCoverageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "RouteCoverage" }],
      default: [],
    },
    authorizedStops: { type: [authorizedStopSchema], default: [] },
    suspended: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "FareRoutes" }
);

module.exports = mongoose.models.FareRoute || mongoose.model("FareRoute", fareRouteSchema);
