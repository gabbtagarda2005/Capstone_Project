const mongoose = require("mongoose");

const appBroadcastSchema = new mongoose.Schema(
  {
    target: {
      type: String,
      required: true,
      unique: true,
      enum: ["passenger", "attendant"],
      index: true,
    },
    message: { type: String, default: "", maxlength: 2000 },
    severity: {
      type: String,
      enum: ["normal", "medium", "critical"],
      default: "normal",
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "app_broadcasts" }
);

module.exports = mongoose.models.AppBroadcast || mongoose.model("AppBroadcast", appBroadcastSchema);
