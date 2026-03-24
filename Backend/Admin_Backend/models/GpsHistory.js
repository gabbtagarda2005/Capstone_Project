const mongoose = require("mongoose");

/**
 * Append-only breadcrumbs — collection: gps_history
 */
const gpsHistorySchema = new mongoose.Schema(
  {
    busId: { type: String, required: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speedKph: { type: Number, default: null },
    heading: { type: Number, default: null },
    recordedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false, collection: "gps_history" }
);

gpsHistorySchema.index({ busId: 1, recordedAt: -1 });

module.exports = mongoose.models.GpsHistory || mongoose.model("GpsHistory", gpsHistorySchema);
