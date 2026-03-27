const mongoose = require("mongoose");

const adminRbacAssignmentSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    role: {
      type: String,
      enum: ["super_admin", "fleet_manager", "auditor"],
      required: true,
    },
  },
  { timestamps: true, collection: "admin_rbac_assignments" }
);

module.exports =
  mongoose.models.AdminRbacAssignment || mongoose.model("AdminRbacAssignment", adminRbacAssignmentSchema);
