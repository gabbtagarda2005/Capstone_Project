export type LatLng = { lat: number; lng: number };

export type WalkingRoute = {
  /** Route path as [lat, lng] pairs, ready for a Leaflet <Polyline>. */
  positions: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  /** True when this is a straight-line fallback, not a real street route. */
  approximate: boolean;
};

const OSRM_BASE = (import.meta.env.VITE_OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");

/** Walking pace used for ETA math (~80 m/min, matches the app's other walking estimates). */
const WALKING_METERS_PER_SECOND = 80 / 60;

/**
 * Real street-network walking route from OSRM.
 * Passenger's current position and the chosen destination are sent to this third-party
 * routing endpoint per request — the only external hop needed to compute an actual walking path.
 *
 * NOTE: the public OSRM demo (router.project-osrm.org) only actually hosts the car/driving
 * profile — requesting `/foot/` still returns a valid road-network route (geometry + distance
 * are real and usable), but its `duration` field is a driving-speed estimate, not a walking one.
 * A self-hosted OSRM with a real foot profile (via VITE_OSRM_BASE_URL) would return a walking
 * duration directly; until then we always derive the ETA from the route's real distance at a
 * fixed walking pace instead of trusting the server's `duration`.
 */
export async function fetchWalkingRoute(origin: LatLng, destination: LatLng, signal?: AbortSignal): Promise<WalkingRoute> {
  const url =
    `${OSRM_BASE}/route/v1/foot/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Route request failed (${res.status})`);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (data?.code !== "Ok" || !route?.geometry?.coordinates) {
    throw new Error(data?.message || "No walking route found");
  }
  const positions: [number, number][] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
  const distanceMeters = Number(route.distance) || 0;
  return {
    positions,
    distanceMeters,
    durationSeconds: distanceMeters / WALKING_METERS_PER_SECOND,
    approximate: false,
  };
}

/** Used when OSRM is unreachable/rate-limited — clearly flagged as approximate, never disguised as a real route. */
export function straightLineFallback(origin: LatLng, destination: LatLng, distanceMeters: number): WalkingRoute {
  return {
    positions: [
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ],
    distanceMeters,
    durationSeconds: distanceMeters / WALKING_METERS_PER_SECOND,
    approximate: true,
  };
}
