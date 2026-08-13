import type { DeployedPointItem } from "@/lib/fetchPassengerMapData";
import { haversineKm } from "@/lib/passengerGeo";

export type NearestTerminalResult = {
  coverageId: string;
  label: string;
  distanceKm: number;
};

export type RankedTerminal = {
  coverageId: string;
  label: string;
  name: string;
  locationName: string;
  latitude: number;
  longitude: number;
  geofenceRadiusM: number;
  distanceKm: number;
};

/**
 * All deployed **terminal** pins, ranked nearest-first for the passenger's position.
 */
export function rankDeployedTerminalsByDistance(
  userLat: number,
  userLng: number,
  items: DeployedPointItem[]
): RankedTerminal[] {
  const ranked: RankedTerminal[] = [];
  for (const row of items) {
    const t = row.terminal;
    if (!t || !Number.isFinite(t.latitude) || !Number.isFinite(t.longitude)) continue;
    const label = `${t.name} (${row.locationName})`.replace(/\s+/g, " ").trim();
    ranked.push({
      coverageId: row.id,
      label,
      name: t.name,
      locationName: row.locationName,
      latitude: t.latitude,
      longitude: t.longitude,
      geofenceRadiusM: t.geofenceRadiusM,
      distanceKm: haversineKm(userLat, userLng, t.latitude, t.longitude),
    });
  }
  ranked.sort((a, b) => a.distanceKm - b.distanceKm);
  return ranked;
}

/**
 * Closest deployed **terminal** pin to the passenger (by terminal lat/lng).
 */
export function findNearestDeployedTerminal(userLat: number, userLng: number, items: DeployedPointItem[]): NearestTerminalResult | null {
  const [best] = rankDeployedTerminalsByDistance(userLat, userLng, items);
  if (!best) return null;
  return { coverageId: best.coverageId, label: best.label, distanceKm: best.distanceKm };
}
