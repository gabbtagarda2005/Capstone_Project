const mongoose = require("mongoose");

/** Forgot-password tokens when using MongoDB auth (no MySQL admin_password_resets table). */
const passwordResetTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    /** admin = default (legacy docs). operator = bus attendant app OTP recovery. */
    purpose: { type: String, enum: ["admin", "operator"], default: "admin", index: true },
    mysqlOperatorId: { type: Number, default: null },
    portalUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: "password_reset_tokens" }
);

module.exports =
  mongoose.models.PasswordResetToken || mongoose.model("PasswordResetToken", passwordResetTokenSchema);
