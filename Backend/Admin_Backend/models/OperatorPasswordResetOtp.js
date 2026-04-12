const mongoose = require("mongoose");

/**
 * OTP for bus attendant self-service password reset (Flutter app).
 * Links to MySQL bus_operators or Mongo PortalUser after email + personnel ID check.
 */
const operatorPasswordResetOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumed: { type: Boolean, default: false, index: true },
    attempts: { type: Number, default: 0 },
    mysqlOperatorId: { type: Number, default: null },
    portalUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: "operator_password_reset_otps" }
);

operatorPasswordResetOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.OperatorPasswordResetOtp ||
  mongoose.model("OperatorPasswordResetOtp", operatorPasswordResetOtpSchema);
