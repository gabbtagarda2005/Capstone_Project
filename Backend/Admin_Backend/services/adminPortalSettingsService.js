const AdminPortalSettings = require("../models/AdminPortalSettings");

const DEFAULTS = {
  singletonKey: "global",
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  sessionTimeoutMinutes: 30,
  emailDailySummary: false,
  soundAlerts: true,
  timezone: "Asia/Manila",
  currency: "PHP",
  geofenceBreachToasts: true,
  sensitiveActionConfirmation: false,
  companyName: "Bukidnon Bus Company",
  sidebarLogoUrl: null,
  faviconUrl: null,
  reportFooter: "© 2026 Bukidnon Bus Company - Fleet Management Division",
};

function mergeDefaults(doc) {
  return { ...DEFAULTS, ...doc };
}

async function getPortalSettingsLean() {
  let doc = await AdminPortalSettings.findOne({ singletonKey: "global" }).lean();
  if (!doc) {
    doc = await AdminPortalSettings.create({
      singletonKey: "global",
      maxLoginAttempts: 5,
      lockoutMinutes: 15,
      sessionTimeoutMinutes: 30,
      emailDailySummary: false,
      soundAlerts: true,
      timezone: "Asia/Manila",
      currency: "PHP",
      geofenceBreachToasts: true,
      sensitiveActionConfirmation: false,
      companyName: "Bukidnon Bus Company",
      sidebarLogoUrl: null,
      faviconUrl: null,
      reportFooter: "© 2026 Bukidnon Bus Company - Fleet Management Division",
    }).then((d) => d.toObject());
  }
  return mergeDefaults(doc);
}

async function updatePortalSettings(patch) {
  const allowed = [
    "maxLoginAttempts",
    "lockoutMinutes",
    "sessionTimeoutMinutes",
    "emailDailySummary",
    "soundAlerts",
    "timezone",
    "currency",
    "geofenceBreachToasts",
    "sensitiveActionConfirmation",
    "companyName",
    "sidebarLogoUrl",
    "faviconUrl",
    "reportFooter",
  ];
  const $set = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) $set[k] = patch[k];
  }
  if (Object.keys($set).length === 0) return getPortalSettingsLean();
  const updated = await AdminPortalSettings.findOneAndUpdate(
    { singletonKey: "global" },
    { $set },
    { upsert: true, new: true }
  ).lean();
  return mergeDefaults(updated || {});
}

module.exports = { getPortalSettingsLean, updatePortalSettings };
