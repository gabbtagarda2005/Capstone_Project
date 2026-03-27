const mongoose = require("mongoose");

const adminAuditLogSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, index: true },
    module: { type: String, required: true, trim: true },
    action: {
      type: String,
      required: true,
      enum: ["ADD", "EDIT", "VIEW", "DELETE", "BROADCAST"],
      index: true,
    },
    details: { type: String, required: true, trim: true, maxlength: 2000 },
    httpMethod: { type: String, default: "" },
    path: { type: String, default: "" },
    statusCode: { type: Number, default: null },
    source: { type: String, enum: ["http", "client"], default: "http" },
  },
  { timestamps: true, collection: "admin_audit_logs" }
);

adminAuditLogSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.AdminAuditLog || mongoose.model("AdminAuditLog", adminAuditLogSchema);
