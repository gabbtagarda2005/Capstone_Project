import type { DeployedPointItem } from "@/lib/fetchPassengerMapData";
import { haversineKm } from "@/lib/passengerGeo";

export type NearestTerminalResult = {
  coverageId: string;
  label: string;
  distanceKm: number;
};

/**
 * Closest deployed **terminal** pin to the passenger (by terminal lat/lng).
 */
export function findNearestDeployedTerminal(userLat: number, userLng: number, items: DeployedPointItem[]): NearestTerminalResult | null {
  let best: NearestTerminalResult | null = null;
  let bestKm = Infinity;
  for (const row of items) {
    const t = row.terminal;
    if (!t || !Number.isFinite(t.latitude) || !Number.isFinite(t.longitude)) continue;
    const km = haversineKm(userLat, userLng, t.latitude, t.longitude);
    if (km < bestKm) {
      bestKm = km;
      const label = `${t.name} (${row.locationName})`.replace(/\s+/g, " ").trim();
      best = { coverageId: row.id, label, distanceKm: km };
    }
  }
  return best;
}
