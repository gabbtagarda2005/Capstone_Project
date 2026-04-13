const AdminPortalSettings = require("../models/AdminPortalSettings");

const DEFAULT_ATTENDANT_ACCESS = {
  dashboard: true,
  tickets: true,
  editPassenger: true,
  notification: true,
  settings: true,
};

const DEFAULT_PASSENGER_ACCESS = {
  dashboard: true,
  scheduled: true,
  checkBuses: true,
  newsUpdates: true,
  feedbacks: true,
  otherPages: true,
};

function normalizeAttendantAccess(input) {
  const o = { ...DEFAULT_ATTENDANT_ACCESS };
  if (!input || typeof input !== "object") return o;
  for (const k of Object.keys(DEFAULT_ATTENDANT_ACCESS)) {
    if (input[k] !== undefined) o[k] = Boolean(input[k]);
  }
  return o;
}

function normalizePassengerAccess(input) {
  const o = { ...DEFAULT_PASSENGER_ACCESS };
  if (!input || typeof input !== "object") return o;
  for (const k of Object.keys(DEFAULT_PASSENGER_ACCESS)) {
    if (input[k] !== undefined) o[k] = Boolean(input[k]);
  }
  return o;
}

const DEFAULTS = {
  singletonKey: "global",
  maxLoginAttempts: 5,
  lockoutMinutes: 15,
  sessionTimeoutMinutes: 30,
  delayThresholdMinutes: 10,
  emailDailySummary: false,
  soundAlerts: true,
  timezone: "Asia/Manila",
  currency: "PHP",
  geofenceBreachToasts: true,
  sensitiveActionConfirmation: false,
  companyName: "Bukidnon Bus Company",
  companyEmail: null,
  companyPhone: null,
  sosEmail: null,
  sosPhoneNumber: null,
  companyLocation: null,
  sidebarLogoUrl: null,
  faviconUrl: null,
  securityPolicyApplyAdmin: true,
  securityPolicyApplyAttendant: true,
  attendantAppAccess: { ...DEFAULT_ATTENDANT_ACCESS },
  passengerAppAccess: { ...DEFAULT_PASSENGER_ACCESS },
  reportFooter: "© 2026 Bukidnon Bus Company - Fleet Management Division",
  maintenanceShieldEnabled: false,
  maintenancePassengerLocked: true,
  maintenanceAttendantLocked: true,
  maintenanceMessage:
    "Bukidnon Bus Company is performing scheduled maintenance. Please try again shortly. Thank you for your patience.",
  maintenanceScheduledUntil: null,
  minAttendantAppVersion: "2.0.4",
  fleetMode: "standard",
  dailyOpsReportEmailEnabled: false,
  dailyOpsReportEmailTime: "06:30",
  dailyOpsReportEmailRecipients: [],
  operationsDeckLive: true,
};

function normalizeDailyOpsTime(t) {
  const s = String(t || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return DEFAULTS.dailyOpsReportEmailTime;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return DEFAULTS.dailyOpsReportEmailTime;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function normalizeDailyOpsRecipients(arr) {
  if (!Array.isArray(arr)) return [];
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const e = String(x || "").trim().toLowerCase();
    if (!e || !re.test(e) || seen.has(e)) continue;
    seen.add(e);
    if (out.length >= 24) break;
    out.push(e);
  }
  return out;
}

const SHIELD_CACHE = { at: 0, doc: null };
const SHIELD_TTL_MS = 2000;

function mergeDefaults(doc) {
  const base = { ...DEFAULTS, ...doc };
  base.attendantAppAccess = normalizeAttendantAccess(doc?.attendantAppAccess);
  base.passengerAppAccess = normalizePassengerAccess(doc?.passengerAppAccess);
  if (base.companyEmail === undefined) base.companyEmail = null;
  if (base.companyPhone === undefined) base.companyPhone = null;
  if (base.sosEmail === undefined) base.sosEmail = null;
  if (base.sosPhoneNumber === undefined) base.sosPhoneNumber = null;
  if (base.companyLocation === undefined) base.companyLocation = null;
  if (base.securityPolicyApplyAdmin === undefined) base.securityPolicyApplyAdmin = true;
  if (base.securityPolicyApplyAttendant === undefined) base.securityPolicyApplyAttendant = true;
  if (base.operationsDeckLive === undefined) base.operationsDeckLive = true;
  base.maxLoginAttempts = Math.min(10, Math.max(3, Number(base.maxLoginAttempts) || DEFAULTS.maxLoginAttempts));
  base.lockoutMinutes = Math.min(1440, Math.max(5, Number(base.lockoutMinutes) || DEFAULTS.lockoutMinutes));
  base.sessionTimeoutMinutes = Math.min(
    480,
    Math.max(5, Number(base.sessionTimeoutMinutes) || DEFAULTS.sessionTimeoutMinutes)
  );
  return base;
}

async function getPortalSettingsLean() {
  let doc = await AdminPortalSettings.findOne({ singletonKey: "global" }).lean();
  if (!doc) {
    doc = await AdminPortalSettings.create({
      singletonKey: "global",
      maxLoginAttempts: 5,
      lockoutMinutes: 15,
      sessionTimeoutMinutes: 30,
      delayThresholdMinutes: 10,
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
      maintenanceShieldEnabled: false,
      maintenancePassengerLocked: true,
      maintenanceAttendantLocked: true,
      maintenanceMessage: DEFAULTS.maintenanceMessage,
      maintenanceScheduledUntil: null,
      minAttendantAppVersion: "2.0.4",
      fleetMode: "standard",
      dailyOpsReportEmailEnabled: false,
      dailyOpsReportEmailTime: "06:30",
      dailyOpsReportEmailRecipients: [],
      operationsDeckLive: true,
    }).then((d) => d.toObject());
  }
  return mergeDefaults(doc);
}

async function updatePortalSettings(patch) {
  const allowed = [
    "maxLoginAttempts",
    "lockoutMinutes",
    "sessionTimeoutMinutes",
    "delayThresholdMinutes",
    "securityPolicyApplyAdmin",
    "securityPolicyApplyAttendant",
    "emailDailySummary",
    "soundAlerts",
    "timezone",
    "currency",
    "geofenceBreachToasts",
    "sensitiveActionConfirmation",
    "companyName",
    "companyEmail",
    "companyPhone",
    "sosEmail",
    "sosPhoneNumber",
    "companyLocation",
    "sidebarLogoUrl",
    "faviconUrl",
    "reportFooter",
    "attendantAppAccess",
    "passengerAppAccess",
    "maintenanceShieldEnabled",
    "maintenancePassengerLocked",
    "maintenanceAttendantLocked",
    "maintenanceMessage",
    "maintenanceScheduledUntil",
    "minAttendantAppVersion",
    "fleetMode",
    "dailyOpsReportEmailEnabled",
    "dailyOpsReportEmailTime",
    "dailyOpsReportEmailRecipients",
    "operationsDeckLive",
  ];
  const $set = {};
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    if (k === "maintenanceScheduledUntil") {
      if (patch[k] === null || patch[k] === "") {
        $set[k] = null;
      } else {
        const d = new Date(patch[k]);
        $set[k] = Number.isNaN(d.getTime()) ? null : d;
      }
      continue;
    }
    if (k === "maintenanceMessage") {
      $set[k] = String(patch[k]).slice(0, 4000);
      continue;
    }
    if (k === "minAttendantAppVersion") {
      $set[k] = String(patch[k]).trim().slice(0, 32) || "2.0.4";
      continue;
    }
    if (k === "fleetMode") {
      const m = String(patch[k]).trim();
      $set[k] = ["standard", "maintenance", "storm"].includes(m) ? m : "standard";
      continue;
    }
    if (k === "dailyOpsReportEmailEnabled") {
      $set[k] = Boolean(patch[k]);
      continue;
    }
    if (k === "dailyOpsReportEmailTime") {
      $set[k] = normalizeDailyOpsTime(patch[k]);
      continue;
    }
    if (k === "dailyOpsReportEmailRecipients") {
      $set[k] = normalizeDailyOpsRecipients(patch[k]);
      continue;
    }
    if (k === "operationsDeckLive") {
      $set[k] = Boolean(patch[k]);
      continue;
    }
    if (k === "maintenancePassengerLocked" || k === "maintenanceAttendantLocked") {
      $set[k] = Boolean(patch[k]);
      continue;
    }
    if (
      k === "companyEmail" ||
      k === "companyPhone" ||
      k === "sosEmail" ||
      k === "sosPhoneNumber" ||
      k === "companyLocation"
    ) {
      const s = patch[k] == null ? "" : String(patch[k]).trim();
      if (!s.length) {
        $set[k] = null;
      } else if (k === "companyEmail" || k === "sosEmail") {
        $set[k] = s.slice(0, 200);
      } else if (k === "companyPhone" || k === "sosPhoneNumber") {
        $set[k] = s.slice(0, 80);
      } else {
        $set[k] = s.slice(0, 240);
      }
      continue;
    }
    if (k === "securityPolicyApplyAdmin" || k === "securityPolicyApplyAttendant") {
      $set[k] = Boolean(patch[k]);
      continue;
    }
    if (k === "maxLoginAttempts") {
      const n = Number(patch[k]);
      $set[k] = Number.isFinite(n) ? Math.min(10, Math.max(3, Math.round(n))) : DEFAULTS.maxLoginAttempts;
      continue;
    }
    if (k === "lockoutMinutes") {
      const n = Number(patch[k]);
      $set[k] = Number.isFinite(n) ? Math.min(1440, Math.max(5, Math.round(n))) : DEFAULTS.lockoutMinutes;
      continue;
    }
    if (k === "sessionTimeoutMinutes") {
      const n = Number(patch[k]);
      $set[k] = Number.isFinite(n) ? Math.min(480, Math.max(5, Math.round(n))) : DEFAULTS.sessionTimeoutMinutes;
      continue;
    }
    if (k === "attendantAppAccess") {
      $set[k] = normalizeAttendantAccess(patch[k]);
      continue;
    }
    if (k === "passengerAppAccess") {
      $set[k] = normalizePassengerAccess(patch[k]);
      continue;
    }
    if (k === "timezone") {
      $set[k] = String(patch[k] || "Asia/Manila").trim().slice(0, 80) || "Asia/Manila";
      continue;
    }
    if (k === "delayThresholdMinutes") {
      const n = Number(patch[k]);
      $set[k] = Number.isFinite(n) ? Math.min(180, Math.max(1, Math.round(n))) : DEFAULTS.delayThresholdMinutes;
      continue;
    }
    $set[k] = patch[k];
  }
  if (Object.keys($set).length === 0) return getPortalSettingsLean();
  const updated = await AdminPortalSettings.findOneAndUpdate(
    { singletonKey: "global" },
    { $set },
    { upsert: true, new: true }
  ).lean();
  invalidateShieldCache();
  return mergeDefaults(updated || {});
}

async function getSettingsForShield() {
  if (Date.now() - SHIELD_CACHE.at < SHIELD_TTL_MS && SHIELD_CACHE.doc) {
    return SHIELD_CACHE.doc;
  }
  const d = await getPortalSettingsLean();
  SHIELD_CACHE.doc = d;
  SHIELD_CACHE.at = Date.now();
  return d;
}

function invalidateShieldCache() {
  SHIELD_CACHE.at = 0;
  SHIELD_CACHE.doc = null;
}

/** False when Command center operations deck is OFFLINE (passenger fleet/map hidden). */
async function isOperationsDeckLive() {
  const s = await getPortalSettingsLean();
  return s.operationsDeckLive !== false;
}

module.exports = {
  getPortalSettingsLean,
  updatePortalSettings,
  getSettingsForShield,
  invalidateShieldCache,
  normalizeDailyOpsTime,
  normalizeDailyOpsRecipients,
  isOperationsDeckLive,
};
