const mongoose = require("mongoose");

/**
 * Admin / operator accounts for JWT login when MySQL ticketing is not used.
 * Collection: portal_users
 */
const portalUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true },
    firstName: { type: String, default: "Admin" },
    lastName: { type: String, default: "User" },
    middleName: { type: String, default: null },
    phone: { type: String, default: null },
    role: { type: String, enum: ["Admin", "Operator"], required: true },
  },
  { timestamps: true, collection: "portal_users" }
);

module.exports = mongoose.models.PortalUser || mongoose.model("PortalUser", portalUserSchema);
