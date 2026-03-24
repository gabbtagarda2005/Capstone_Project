const mongoose = require("mongoose");

/** Forgot-password tokens when using MongoDB auth (no MySQL admin_password_resets table). */
const passwordResetTokenSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "password_reset_tokens" }
);

module.exports =
  mongoose.models.PasswordResetToken || mongoose.model("PasswordResetToken", passwordResetTokenSchema);
