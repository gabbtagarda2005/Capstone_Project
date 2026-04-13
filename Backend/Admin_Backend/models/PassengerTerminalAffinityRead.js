const mongoose = require("mongoose");

/**
 * Read-only view of the same collection Passenger_Backend writes (anonymous terminal picks).
 */
const passengerTerminalAffinitySchema = new mongoose.Schema(
  {
    coverageId: { type: String, required: true, trim: true, index: true },
    hitCount: { type: Number, default: 0 },
    lastHitAt: { type: Date, default: Date.now },
  },
  { collection: "passenger_terminal_affinity" }
);

module.exports =
  mongoose.models.PassengerTerminalAffinityRead ||
  mongoose.model("PassengerTerminalAffinityRead", passengerTerminalAffinitySchema);
