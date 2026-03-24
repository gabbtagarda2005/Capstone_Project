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
    phone: { type: String, default: null },
    licenseNumber: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "drivers" }
);

module.exports = mongoose.models.Driver || mongoose.model("Driver", driverSchema);
