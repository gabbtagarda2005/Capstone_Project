const mongoose = require("mongoose");

/** OTP challenges for the "Add IT account" self-service creation flow (Settings → Admins). */
const adminItAccountOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumed: { type: Boolean, default: false, index: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "admin_it_account_otps" }
);

// Auto-delete OTP docs after expiry.
adminItAccountOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.AdminItAccountOtp || mongoose.model("AdminItAccountOtp", adminItAccountOtpSchema);
