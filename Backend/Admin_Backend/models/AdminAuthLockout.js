const mongoose = require("mongoose");

const adminAuthLockoutSchema = new mongoose.Schema(
  {
    /** `admin:email` or `attendant:email` — separates lockout counters per client. */
    lockKey: { type: String, required: true, unique: true, trim: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    failedAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true, collection: "admin_auth_lockouts" }
);

module.exports =
  mongoose.models.AdminAuthLockout || mongoose.model("AdminAuthLockout", adminAuthLockoutSchema);
