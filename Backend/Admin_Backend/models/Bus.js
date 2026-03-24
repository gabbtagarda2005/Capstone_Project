const mongoose = require("mongoose");

/**
 * Central bus registry — collection: buses
 */
const busSchema = new mongoose.Schema(
  {
    busId: { type: String, required: true, unique: true, index: true },
    plateNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ["Active", "Maintenance", "Inactive"],
      default: "Active",
    },
    routeId: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "buses" }
);

module.exports = mongoose.models.Bus || mongoose.model("Bus", busSchema);
