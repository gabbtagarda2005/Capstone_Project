import { fetchPublicGetJson } from "@/lib/fetchWithPublicApiBases";

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

export type LiveBusPosition = {
  busId: string;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
  nextTerminal: string | null;
  etaMinutes: number | null;
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
