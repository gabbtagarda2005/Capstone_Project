const mongoose = require("mongoose");

/**
 * Anonymous aggregate: which RouteCoverage terminals passengers land nearest to at first location grant.
 * No coordinates stored — only coverageId counters for planning.
 */
const passengerTerminalAffinitySchema = new mongoose.Schema(
  {
    coverageId: { type: String, required: true, trim: true, unique: true, index: true },
    hitCount: { type: Number, default: 0, min: 0 },
    lastHitAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "passenger_terminal_affinity" }
);

module.exports =
  mongoose.models.PassengerTerminalAffinity ||
  mongoose.model("PassengerTerminalAffinity", passengerTerminalAffinitySchema);
