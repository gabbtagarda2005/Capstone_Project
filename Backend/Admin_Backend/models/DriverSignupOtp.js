const mongoose = require("mongoose");

/** OTP for driver onboarding (admin-triggered). TTL via expiresAt. */
const driverSignupOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumed: { type: Boolean, default: false, index: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "driver_signup_otps" }
);

driverSignupOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.DriverSignupOtp || mongoose.model("DriverSignupOtp", driverSignupOtpSchema);
