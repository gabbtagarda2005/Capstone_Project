const mongoose = require("mongoose");

const adminOtpCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    consumed: { type: Boolean, default: false, index: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "admin_otp_codes" }
);

// Auto-delete OTP docs after expiry.
adminOtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.AdminOtpCode || mongoose.model("AdminOtpCode", adminOtpCodeSchema);

