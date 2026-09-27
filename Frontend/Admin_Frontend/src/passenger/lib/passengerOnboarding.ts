const STORAGE_KEY = "passenger_onboarding_seen_v1";

/** Has this browser already completed or skipped the passenger quick guide? */
export function isPassengerOnboardingSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPassengerOnboardingSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}
