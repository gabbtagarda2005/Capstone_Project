const mongoose = require("mongoose");

/**
 * One document per corridor: this fleet's own observed "free-flow" driving speed on that
 * corridor, computed from real GpsHistory breadcrumbs (see
 * services/corridorFreeFlowCalibration.js) rather than OSRM's generic road-speed profile.
 * Read by corridorGeometry.getCorridorFreeFlowProfile() as the preferred baseline for the
 * congestion/delay engines; falls back to the OSRM-duration estimate when no (or stale)
 * calibration exists for a corridor — never fabricated.
 */
const corridorFreeFlowCalibrationSchema = new mongoose.Schema(
  {
    corridorId: { type: mongoose.Schema.Types.ObjectId, ref: "CorridorRoute", required: true, unique: true, index: true },
    corridorName: { type: String, default: null },
    /** 85th percentile of observed on-corridor moving speeds over the lookback window. */
    observedFreeFlowKph: { type: Number, required: true },
    sampleSize: { type: Number, required: true },
    windowDays: { type: Number, required: true },
    method: { type: String, default: "p85_gps_history" },
    computedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: "corridor_free_flow_calibrations" }
);

module.exports =
  mongoose.models.CorridorFreeFlowCalibration ||
  mongoose.model("CorridorFreeFlowCalibration", corridorFreeFlowCalibrationSchema);
