const STORAGE_KEY = "passenger_location_ready_v1";
const SESSION_KEY = "passenger_location_session_v1";

export type PassengerLocationSession = {
  lat: number;
  lng: number;
  nearestCoverageId: string | null;
  nearestLabel: string;
  distanceKm: number;
  updatedAt: number;
};

export function isPassengerLocationGateCleared(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPassengerLocationGateCleared(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearPassengerLocationGate(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Last fix used for live map center, user marker, and “nearest terminal” copy (session tab only). */
export function getPassengerLocationSession(): PassengerLocationSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<PassengerLocationSession>;
    if (
      typeof j.lat !== "number" ||
      typeof j.lng !== "number" ||
      typeof j.nearestLabel !== "string" ||
      typeof j.distanceKm !== "number"
    ) {
      return null;
    }
    return {
      lat: j.lat,
      lng: j.lng,
      nearestCoverageId: typeof j.nearestCoverageId === "string" ? j.nearestCoverageId : null,
      nearestLabel: j.nearestLabel,
      distanceKm: j.distanceKm,
      updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function setPassengerLocationSession(data: {
  lat: number;
  lng: number;
  nearestCoverageId: string | null;
  nearestLabel: string;
  distanceKm: number;
}): void {
  try {
    const payload: PassengerLocationSession = {
      ...data,
      updatedAt: Date.now(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
