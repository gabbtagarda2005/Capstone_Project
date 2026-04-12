const mongoose = require("mongoose");

const fareChangeLogSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["matrix_upsert", "matrix_patch", "matrix_delete", "discounts"],
      required: true,
      index: true,
    },
    actorEmail: { type: String, default: "", trim: true },
    summary: { type: String, required: true, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "fare_change_logs" }
);

module.exports =
  mongoose.models.FareChangeLog || mongoose.model("FareChangeLog", fareChangeLogSchema);
