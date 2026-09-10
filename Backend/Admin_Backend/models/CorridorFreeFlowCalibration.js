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
    /** 85th percentile of the sample pool `method` actually used (light-hours-only when that
     *  pool had enough samples, else all-hours). */
    observedFreeFlowKph: { type: Number, required: true },
    /** Size of whichever pool `method` used — equals lightHourSampleSize or allHourSampleSize. */
    sampleSize: { type: Number, required: true },
    /** Always recorded regardless of which pool won, for transparency/diagnostics. */
    lightHourSampleSize: { type: Number, default: null },
    allHourSampleSize: { type: Number, default: null },
    windowDays: { type: Number, required: true },
    /** "p85_light_hours" (preferred, genuinely light-traffic hours only) or "p85_all_hours"
     *  (fallback used when the light-hour pool didn't independently clear minSamples). */
    method: { type: String, default: "p85_all_hours" },
    computedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: "corridor_free_flow_calibrations" }
);

module.exports =
  mongoose.models.CorridorFreeFlowCalibration ||
  mongoose.model("CorridorFreeFlowCalibration", corridorFreeFlowCalibrationSchema);
