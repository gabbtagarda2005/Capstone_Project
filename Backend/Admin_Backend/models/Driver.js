const mongoose = require("mongoose");

/**
 * Driver profile — use if you store drivers in their own collection.
 * Assignments to buses belong in busassignmenthistories per your Atlas design.
 */
const driverSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, unique: true, index: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    middleName: { type: String, default: null },
    phone: { type: String, default: null },
    /** Official contact used for OTP verification (wizard onboarding). */
    email: { type: String, default: null, lowercase: true, trim: true, sparse: true, unique: true, index: true },
    licenseNumber: { type: String, default: null, index: true },
    /** Optional LTO / certification expiry for admin alerts */
    licenseExpiresAt: { type: Date, default: null },
    yearsExperience: { type: Number, default: null, min: 0 },
    profileImageUrl: { type: String, default: null },
    licenseScanUrl: { type: String, default: null },
    verifiedViaOtpAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    /** Bcrypt hash of 6-digit PIN shown to driver — authorizes attendant ticket corrections. */
    ticketEditPinHash: { type: String, default: null },
  },
  { timestamps: true, collection: "drivers" }
);

module.exports = mongoose.models.Driver || mongoose.model("Driver", driverSchema);
