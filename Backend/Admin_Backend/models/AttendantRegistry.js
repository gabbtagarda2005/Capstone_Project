const mongoose = require("mongoose");

/**
 * Verified attendant profile mirror (post Gmail OTP). Links to MySQL bus_operators or Mongo portal user.
 * Used for "Verified" badges and audit; ticketing identity remains bus_operators / PortalUser.
 */
const attendantRegistrySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    middleName: { type: String, default: null },
    phone: { type: String, default: null },
    profileImageUrl: { type: String, default: null },
    role: { type: String, enum: ["BusAttendant"], default: "BusAttendant" },
    verifiedViaOtpAt: { type: Date, default: () => new Date() },
    mysqlOperatorId: { type: Number, default: null, index: true },
    portalUserId: { type: mongoose.Schema.Types.ObjectId, ref: "PortalUser", default: null },
  },
  { timestamps: true, collection: "attendant_registry" }
);

module.exports =
  mongoose.models.AttendantRegistry || mongoose.model("AttendantRegistry", attendantRegistrySchema);
