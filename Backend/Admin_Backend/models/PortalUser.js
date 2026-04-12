const mongoose = require("mongoose");

/**
 * Admin / operator accounts for JWT login when MySQL ticketing is not used.
 * Collection: portal_users
 */
const portalUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, default: null },
    firstName: { type: String, default: "Admin" },
    lastName: { type: String, default: "User" },
    middleName: { type: String, default: null },
    phone: { type: String, default: null },
    role: { type: String, enum: ["Admin", "Operator", "BusAttendant"], required: true },
    firebaseUid: { type: String, default: null, index: true },
    photoURL: { type: String, default: null },
    authProvider: { type: String, enum: ["password", "google"], default: "password" },
    /** Unique 6-digit personnel id (attendants); shared number space with drivers. */
    employeeNumber: { type: String, default: null, sparse: true, unique: true, match: /^\d{6}$/ },
  },
  { timestamps: true, collection: "portal_users" }
);

module.exports = mongoose.models.PortalUser || mongoose.model("PortalUser", portalUserSchema);
