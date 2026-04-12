const mongoose = require("mongoose");

const attendantAppAccessSchema = new mongoose.Schema(
  {
    dashboard: { type: Boolean, default: true },
    tickets: { type: Boolean, default: true },
    editPassenger: { type: Boolean, default: true },
    notification: { type: Boolean, default: true },
    settings: { type: Boolean, default: true },
  },
  { _id: false }
);

const passengerAppAccessSchema = new mongoose.Schema(
  {
    dashboard: { type: Boolean, default: true },
    scheduled: { type: Boolean, default: true },
    checkBuses: { type: Boolean, default: true },
    newsUpdates: { type: Boolean, default: true },
    feedbacks: { type: Boolean, default: true },
    otherPages: { type: Boolean, default: true },
  },
  { _id: false }
);

const adminPortalSettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: "global", unique: true, index: true },
    maxLoginAttempts: { type: Number, default: 5, min: 3, max: 10 },
    lockoutMinutes: { type: Number, default: 15, min: 5, max: 1440 },
    sessionTimeoutMinutes: { type: Number, default: 30, min: 5, max: 480 },
    /** Global threshold for marking delayed status from ETA/schedule drift. */
    delayThresholdMinutes: { type: Number, default: 10, min: 1, max: 180 },
    emailDailySummary: { type: Boolean, default: false },
    soundAlerts: { type: Boolean, default: true },
    timezone: { type: String, default: "Asia/Manila" },
    currency: { type: String, default: "PHP" },
    geofenceBreachToasts: { type: Boolean, default: true },
    sensitiveActionConfirmation: { type: Boolean, default: false },
    companyName: { type: String, default: "Bukidnon Bus Company" },
    companyEmail: { type: String, default: null, trim: true },
    companyPhone: { type: String, default: null, trim: true },
    companyLocation: { type: String, default: null, trim: true },
    /** Data URL or https URL for circular sidebar mark */
    sidebarLogoUrl: { type: String, default: null },
    faviconUrl: { type: String, default: null },
    /** Which client surfaces should align with this security policy (UX + future enforcement). */
    securityPolicyApplyAdmin: { type: Boolean, default: true },
    securityPolicyApplyAttendant: { type: Boolean, default: true },
    attendantAppAccess: {
      type: attendantAppAccessSchema,
      default: () => ({
        dashboard: true,
        tickets: true,
        editPassenger: true,
        notification: true,
        settings: true,
      }),
    },
    passengerAppAccess: {
      type: passengerAppAccessSchema,
      default: () => ({
        dashboard: true,
        scheduled: true,
        checkBuses: true,
        newsUpdates: true,
        feedbacks: true,
        otherPages: true,
      }),
    },
    reportFooter: {
      type: String,
      default: "© 2026 Bukidnon Bus Company - Fleet Management Division",
    },
    /** Master switch: maintenance mode active (message + per-app lockouts below). */
    maintenanceShieldEnabled: { type: Boolean, default: false },
    /** When maintenance is on: block Passenger web app (full-screen notice). */
    maintenancePassengerLocked: { type: Boolean, default: true },
    /** When maintenance is on: block Bus Attendant app (full-screen notice). */
    maintenanceAttendantLocked: { type: Boolean, default: true },
    maintenanceMessage: {
      type: String,
      default:
        "Bukidnon Bus Company is performing scheduled maintenance. Please try again shortly. Thank you for your patience.",
      maxlength: 4000,
    },
    maintenanceScheduledUntil: { type: Date, default: null },
    minAttendantAppVersion: { type: String, default: "2.0.4", trim: true },
    /** standard | maintenance | storm */
    fleetMode: { type: String, default: "standard", enum: ["standard", "maintenance", "storm"] },
    /** When true, daily ops email job runs (also respects env DAILY_OPS_REPORT_CRON_ENABLED). */
    dailyOpsReportEmailEnabled: { type: Boolean, default: false },
    /** Local send time HH:mm (24h) in portal timezone */
    dailyOpsReportEmailTime: { type: String, default: "06:30" },
    /** Recipient inboxes for automated daily operational log */
    dailyOpsReportEmailRecipients: { type: [String], default: [] },
  },
  { timestamps: true, collection: "admin_portal_settings" }
);

module.exports =
  mongoose.models.AdminPortalSettings ||
  mongoose.model("AdminPortalSettings", adminPortalSettingsSchema);
