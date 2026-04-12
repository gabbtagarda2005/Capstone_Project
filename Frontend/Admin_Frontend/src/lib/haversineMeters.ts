/** Great-circle distance in meters (WGS84 spherical approximation). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Local equirectangular distance from point P to segment AB (meters; OK for ~Bukidnon scale). */
function distancePointToSegmentMeters(
  lat: number,
  lng: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const d12 = haversineMeters(lat1, lng1, lat2, lng2);
  if (d12 < 2) return haversineMeters(lat, lng, lat1, lng1);
  const midLat = (lat1 + lat2) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  const toXY = (la: number, ln: number) => ({
    x: ((ln * Math.PI) / 180) * 6371000 * cos,
    y: ((la * Math.PI) / 180) * 6371000,
  });
  const A = toXY(lat1, lng1);
  const B = toXY(lat2, lng2);
  const P = toXY(lat, lng);
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const apx = P.x - A.x;
  const apy = P.y - A.y;
  const denom = abx * abx + aby * aby;
  const t = denom > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom)) : 0;
  const cx = A.x + t * abx;
  const cy = A.y + t * aby;
  return Math.hypot(P.x - cx, P.y - cy);
}

/** Minimum distance from a point to any segment of a polyline (meters). */
export function minDistanceToPolylineMeters(lat: number, lng: number, pts: [number, number][]): number {
  if (pts.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = distancePointToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Same as min distance, plus which segment (i → i+1) achieved the minimum.
 * Used for per-stop fleet policy (flexible segment = no route-deviation flag).
 */
export function minDistanceToPolylineMetersWithClosestSegment(
  lat: number,
  lng: number,
  pts: [number, number][]
): { distanceM: number; segmentIndex: number | null } {
  if (pts.length < 2) return { distanceM: Infinity, segmentIndex: null };
  let min = Infinity;
  let bestSeg: number | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = distancePointToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    if (d < min) {
      min = d;
      bestSeg = i;
    }
  }
  return { distanceM: min, segmentIndex: bestSeg };
}
