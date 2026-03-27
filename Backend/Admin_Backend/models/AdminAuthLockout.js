const mongoose = require("mongoose");

const adminAuthLockoutSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    failedAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true, collection: "admin_auth_lockouts" }
);

module.exports =
  mongoose.models.AdminAuthLockout || mongoose.model("AdminAuthLockout", adminAuthLockoutSchema);
