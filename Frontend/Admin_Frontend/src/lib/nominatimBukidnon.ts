/**
 * OpenStreetMap Nominatim — Bukidnon-focused search (free, no API key).
 * Queries go through Admin_Backend `/api/geocode/nominatim` to avoid browser CORS and
 * shared-IP 429 rate limits on nominatim.openstreetmap.org.
 * @see https://nominatim.org/release-docs/latest/api/Search/
 */

import { api } from "./api";

/** min_lon, max_lat, max_lon, min_lat — Bukidnon + northern corridor (e.g. Libona ~8.25°N) */
export const NOMINATIM_BUKIDNON_VIEWBOX = "124.35,8.55,125.65,7.45";

export type NominatimAddress = {
  amenity?: string;
  name?: string;
  road?: string;
  building?: string;
  shop?: string;
  house_number?: string;
  neighbourhood?: string;
  quarter?: string;
  suburb?: string;
  village?: string;
  hamlet?: string;
  city?: string;
  town?: string;
  municipality?: string;
  county?: string;
  state?: string;
  [key: string]: string | undefined;
};

export type NominatimSearchRow = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  class?: string;
  type?: string;
  addresstype?: string;
  address?: NominatimAddress;
};

export type NominatimMappedHit = {
  id: string;
  /** Compressed: place + barangay / area (for form fields) */
  label: string;
  /** Full Nominatim display_name (tooltip / secondary UI) */
  detail: string;
  lat: number;
  lng: number;
};

function fallbackCompress(displayName: string): string {
  if (!displayName) return "";
  const parts = displayName
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 2 ? `${parts[0]}, ${parts[1]}` : displayName;
}

/** Place + barangay style label from Nominatim address object. */
export function nominatimCompressedLabel(row: Pick<NominatimSearchRow, "display_name" | "address">): string {
  const a = row.address;
  if (a) {
    const place =
      a.amenity ||
      a.building ||
      a.shop ||
      (a.house_number && a.road ? `${a.house_number} ${a.road}` : undefined) ||
      a.road ||
      a.name ||
      "";
    const barangay =
      a.quarter || a.suburb || a.neighbourhood || a.village || a.hamlet || a.city || a.town || a.municipality || "";
    const p = String(place).trim();
    const b = String(barangay).trim();
    if (p && b) return `${p}, ${b}`;
    if (p) return p;
    if (b) return b;
  }
  return fallbackCompress(row.display_name || "");
}

/**
 * Raw Nominatim rows via admin API (throttled server-side; sends proper User-Agent upstream).
 */
export async function fetchNominatimRowsViaProxy(
  query: string,
  opts: { bounded: 0 | 1; limit?: number; signal?: AbortSignal }
): Promise<NominatimSearchRow[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    q,
    bounded: String(opts.bounded),
    limit: String(opts.limit ?? 14),
  });
  const rows = await api<NominatimSearchRow[]>(`/api/geocode/nominatim?${params.toString()}`, {
    signal: opts.signal,
  });
  return Array.isArray(rows) ? rows : [];
}

function mapRows(rows: NominatimSearchRow[]): NominatimMappedHit[] {
  return rows
    .filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)) && String(r.display_name || "").trim())
    .map((r) => {
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      const detail = String(r.display_name || "").trim();
      return {
        id: `nom-${r.place_id}`,
        label: nominatimCompressedLabel(r),
        detail,
        lat,
        lng,
      };
    });
}

/**
 * Search with strict Bukidnon viewbox first; if empty, retry with soft bias (same viewbox, bounded=0).
 */
export async function searchNominatimBukidnon(
  query: string,
  signal?: AbortSignal
): Promise<NominatimMappedHit[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  const strict = mapRows(await fetchNominatimRowsViaProxy(q, { bounded: 1, limit: 14, signal }));
  if (strict.length > 0) return strict.slice(0, 12);
  return mapRows(await fetchNominatimRowsViaProxy(q, { bounded: 0, limit: 14, signal })).slice(0, 12);
}
