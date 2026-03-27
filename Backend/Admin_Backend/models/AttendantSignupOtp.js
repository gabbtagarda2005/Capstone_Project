const mongoose = require("mongoose");

/** Short-lived OTP for bus attendant onboarding (admin-triggered). TTL via expiresAt. */
const attendantSignupOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    consumed: { type: Boolean, default: false, index: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "attendant_signup_otps" }
);

attendantSignupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.AttendantSignupOtp ||
  mongoose.model("AttendantSignupOtp", attendantSignupOtpSchema);
