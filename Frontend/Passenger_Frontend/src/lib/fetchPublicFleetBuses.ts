import { fetchPublicGetJson, publicPathWithQuery } from "@/lib/fetchWithPublicApiBases";

export type PublicFleetBus = {
  busId: string;
  busNumber: string;
  plateNumber: string | null;
  route: string | null;
  /** Resolved from corridor routes (terminal names) when `route` matches a corridor or `ROUTE N` index. */
  routeStart?: string | null;
  routeEnd?: string | null;
  status: string;
  seatCapacity: number;
  /** Live GPS → passenger Haversine ETA (minutes) when `userLat`/`userLng` were sent and GPS is fresh. */
  etaMinutesFromUser?: number | null;
  distanceToUserKm?: number | null;
  lastLatitude?: number | null;
  lastLongitude?: number | null;
  gpsRecordedAt?: string | null;
  /** Boarded tickets today (Manila) for this bus, excluding completed/cancelled. */
  occupiedSeats?: number;
  vacantSeats?: number;
  /** e.g. "37/50" */
  seatLine?: string;
  /** Smart copy when full / almost full (uses `viewerHub` on the API). */
  seatNotice?: string | null;
};

export type FleetIntelQuery = {
  viewerHub?: string;
  userLat?: number;
  userLng?: number;
};

export async function fetchPublicFleetBuses(q?: FleetIntelQuery): Promise<PublicFleetBus[]> {
  const path =
    q && (q.viewerHub != null || q.userLat != null || q.userLng != null)
      ? publicPathWithQuery("/api/public/fleet-buses", {
          viewerHub: q.viewerHub,
          userLat: q.userLat,
          userLng: q.userLng,
        })
      : "/api/public/fleet-buses";
  const data = await fetchPublicGetJson<{ items?: PublicFleetBus[]; error?: string }>(path);
  return Array.isArray(data.items) ? data.items : [];
}
