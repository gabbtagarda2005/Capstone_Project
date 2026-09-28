import { fetchPublicGetJson } from "@/passenger/lib/fetchWithPublicApiBases";

export type DeployedTerminal = {
  name: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
  pickupOnly?: boolean;
};

export type DeployedStop = {
  name: string;
  latitude: number;
  longitude: number;
  sequence: number;
  geofenceRadiusM?: number;
  pickupOnly?: boolean;
};

export type DeployedLocationPoint = {
  name: string;
  latitude: number;
  longitude: number;
};

export type DeployedPointItem = {
  id: string;
  locationName: string;
  terminalName: string;
  pointType: string;
  updatedAt: string | null;
  terminal: DeployedTerminal | null;
  locationPoint: DeployedLocationPoint | null;
  stops: DeployedStop[];
};

/** Real road-congestion reading for this bus's corridor — see services/congestionEngine.js
 *  (Admin_Backend). Never render `level` as "live traffic"; see `trafficSource` below. */
export type LiveBusCongestion = {
  status: "ok" | "not_applicable" | "unavailable" | "insufficient_data";
  level?: "FREE_FLOW" | "MODERATE" | "SLOW" | "HEAVY" | "SEVERE";
  reason?: string;
};

/** Delay classification derived from expected-vs-actual schedule progress — see
 *  services/delayClassifier.js (Admin_Backend). */
export type LiveBusDelay = {
  tier: "EARLY" | "ON_TIME" | "MINOR_DELAY" | "MODERATE_DELAY" | "SEVERE_DELAY" | "STOPPED" | "GPS_STALE" | "UNKNOWN";
  delayMinutes: number | null;
  reason: string | null;
};

export type LiveBusPosition = {
  busId: string;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
  nextTerminal: string | null;
  etaMinutes: number | null;
  /** Already returned by GET /api/buses/live today — previously unused by this page. Never
   *  "live_provider" unless a real traffic-aware routing API is configured (none is, today):
   *  render honestly as "GPS-derived traffic" / "Historical estimate" / "Limited data". */
  trafficSource?: "live_provider" | "gps_derived" | "historical" | "route_only" | "unavailable" | null;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" | null;
  congestion?: LiveBusCongestion | null;
  delay?: LiveBusDelay | null;
};

export async function fetchDeployedPoints(): Promise<DeployedPointItem[]> {
  const data = await fetchPublicGetJson<{ items?: DeployedPointItem[]; error?: string }>(
    "/api/public/deployed-points"
  );
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchLiveBusPositions(): Promise<LiveBusPosition[]> {
  const data = await fetchPublicGetJson<{ items?: LiveBusPosition[]; error?: string }>("/api/buses/live");
  return Array.isArray(data.items) ? data.items : [];
}

/** PLANNED route geometry for a bus's assigned corridor — never the bus's live GPS position. */
export type BusRouteGeometry = {
  busId: string;
  available: boolean;
  reason?: string;
  routeId?: string;
  routeLabel?: string;
  origin?: { name: string; latitude: number; longitude: number };
  destination?: { name: string; latitude: number; longitude: number };
  geometry?: { type: "LineString"; coordinates: [number, number][] };
  distanceMeters?: number;
  durationSeconds?: number;
};

export async function fetchBusRouteGeometry(busId: string): Promise<BusRouteGeometry> {
  return fetchPublicGetJson<BusRouteGeometry>(`/api/public/buses/${encodeURIComponent(busId)}/route`);
}
