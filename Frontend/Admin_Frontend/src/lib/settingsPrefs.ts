export const LS_SEC_GEOFENCE_PUSH = "settings_sec_geofence_push_v1";
export const LS_SEC_SENSITIVE_REAUTH = "settings_sec_sensitive_reauth_v1";
export const LS_DEV_SHOW_TECHNICAL = "settings_dev_show_technical_v1";

export function readLsBool(key: string, defaultVal: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultVal;
    return v === "1";
  } catch {
    return defaultVal;
  }
}

export function writeLsBool(key: string, val: boolean) {
  try {
    localStorage.setItem(key, val ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** When false, the global geofence breach banner is suppressed (map + audit still run). */
export function isGeofenceGlobalAlertEnabled(): boolean {
  return readLsBool(LS_SEC_GEOFENCE_PUSH, true);
}
