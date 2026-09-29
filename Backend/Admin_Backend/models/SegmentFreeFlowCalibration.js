const mongoose = require("mongoose");

/**
 * One document per road segment (services/corridorSegments.js): this fleet's own observed
 * "free-flow" driving speed on that specific segment, computed from real GpsHistory breadcrumbs —
 * the same method as models/CorridorFreeFlowCalibration.js, just scoped one level deeper (per
 * segment instead of per whole corridor). Read by services/segmentTrafficStats.js as the
 * preferred reference speed for that segment; falls back to the corridor-wide calibration/OSRM
 * profile when a segment doesn't independently have enough samples yet — never fabricated.
 */
const segmentFreeFlowCalibrationSchema = new mongoose.Schema(
  {
    segmentId: { type: String, required: true, unique: true, index: true },
    corridorId: { type: mongoose.Schema.Types.ObjectId, ref: "CorridorRoute", required: true, index: true },
    fromName: { type: String, default: null },
    toName: { type: String, default: null },
    observedFreeFlowKph: { type: Number, required: true },
    sampleSize: { type: Number, required: true },
    lightHourSampleSize: { type: Number, default: null },
    allHourSampleSize: { type: Number, default: null },
    windowDays: { type: Number, required: true },
    method: { type: String, default: "p85_all_hours" },
    computedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: "segment_free_flow_calibrations" }
);

module.exports =
  mongoose.models.SegmentFreeFlowCalibration ||
  mongoose.model("SegmentFreeFlowCalibration", segmentFreeFlowCalibrationSchema);
