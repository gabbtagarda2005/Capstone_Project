const mongoose = require("mongoose");

const adminPortalSettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: "global", unique: true, index: true },
    maxLoginAttempts: { type: Number, default: 5, min: 3, max: 10 },
    lockoutMinutes: { type: Number, default: 15, min: 5, max: 1440 },
    sessionTimeoutMinutes: { type: Number, default: 30, min: 5, max: 480 },
    emailDailySummary: { type: Boolean, default: false },
    soundAlerts: { type: Boolean, default: true },
    timezone: { type: String, default: "Asia/Manila" },
    currency: { type: String, default: "PHP" },
    geofenceBreachToasts: { type: Boolean, default: true },
    sensitiveActionConfirmation: { type: Boolean, default: false },
    companyName: { type: String, default: "Bukidnon Bus Company" },
    /** Data URL or https URL for circular sidebar mark */
    sidebarLogoUrl: { type: String, default: null },
    faviconUrl: { type: String, default: null },
    reportFooter: {
      type: String,
      default: "© 2026 Bukidnon Bus Company - Fleet Management Division",
    },
  },
  { timestamps: true, collection: "admin_portal_settings" }
);

module.exports =
  mongoose.models.AdminPortalSettings ||
  mongoose.model("AdminPortalSettings", adminPortalSettingsSchema);
