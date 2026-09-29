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
    signal: { type: String, default: null },
    /** Which real road segment (services/corridorSegments.js) this fix matched to, if any — null
     *  when the bus wasn't moving, wasn't near any assigned corridor, or was off-route. Additive:
     *  existing rows/readers are unaffected. Turns this append-only collection into the
     *  per-observation historical traffic record the segment/heat-map engines read. */
    segmentId: { type: String, default: null, index: true },
    corridorId: { type: mongoose.Schema.Types.ObjectId, ref: "CorridorRoute", default: null },
    recordedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false, collection: "gps_history" }
);

gpsHistorySchema.index({ busId: 1, recordedAt: -1 });
gpsHistorySchema.index({ segmentId: 1, recordedAt: -1 });

module.exports = mongoose.models.GpsHistory || mongoose.model("GpsHistory", gpsHistorySchema);
