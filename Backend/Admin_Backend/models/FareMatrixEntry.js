const mongoose = require("mongoose");

const fareMatrixEntrySchema = new mongoose.Schema(
  {
    startCoverageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RouteCoverage",
      required: true,
      index: true,
    },
    startKind: { type: String, enum: ["terminal", "stop"], required: true },
    /** 0 when start is hub terminal; ≥1 when start is a bus stop */
    startStopSequence: { type: Number, default: 0, min: 0 },
    endCoverageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RouteCoverage",
      required: true,
      index: true,
    },
    endKind: { type: String, enum: ["terminal", "stop"], required: true },
    endStopSequence: { type: Number, default: 0, min: 0 },
    /** Normalized for lookup (lowercase, collapsed spaces) */
    startNorm: { type: String, required: true, trim: true, index: true },
    endNorm: { type: String, required: true, trim: true, index: true },
    /** Human labels stored at save time (shown in admin + sent by attendant apps) */
    startLabel: { type: String, required: true, trim: true },
    endLabel: { type: String, required: true, trim: true },
    baseFarePesos: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, collection: "fare_matrix_entries" }
);

fareMatrixEntrySchema.index(
  {
    startCoverageId: 1,
    startKind: 1,
    startStopSequence: 1,
    endCoverageId: 1,
    endKind: 1,
    endStopSequence: 1,
  },
  { unique: true }
);

module.exports =
  mongoose.models.FareMatrixEntry || mongoose.model("FareMatrixEntry", fareMatrixEntrySchema);
