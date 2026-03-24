const mongoose = require("mongoose");

/**
 * Latest coordinate per bus — collection: gps_logs (live map reads this)
 */
const gpsLogSchema = new mongoose.Schema(
  {
    busId: { type: String, required: true, unique: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speedKph: { type: Number, default: null },
    heading: { type: Number, default: null },
    recordedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: "gps_logs" }
);

module.exports = mongoose.models.GpsLog || mongoose.model("GpsLog", gpsLogSchema);
