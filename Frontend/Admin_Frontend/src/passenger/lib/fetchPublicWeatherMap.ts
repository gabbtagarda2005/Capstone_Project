import { fetchPublicGetJson } from "@/passenger/lib/fetchWithPublicApiBases";

export type WeatherSpot = {
  locationName: string;
  lat: number;
  lon: number;
  /** Open-Meteo WMO weather code. */
  code: number;
  summary: string;
  isRain: boolean;
  isFog: boolean;
  tempC: number | null;
  humidityPct: number | null;
  windKph: number | null;
  precipitationMm: number | null;
  /** Provider's own "as of" timestamp for this reading, when supplied. */
  observedAt: string | null;
};

export type WeatherMapFeed = {
  spots: WeatherSpot[];
  /** When this backend cache was last refreshed (polls Open-Meteo roughly every 10 minutes). */
  updatedAt: string | null;
};

function hasCoords(x: unknown): x is WeatherSpot {
  const s = x as Partial<WeatherSpot> | null;
  return !!s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)) && Number.isFinite(Number(s.code));
}

/** Reuses the existing passenger weather-advisories cache (Open-Meteo, backend-proxied, no API key) — see
 *  Backend/Admin_Backend/services/weatherLocationAdvisories.js. Same data that powers the "Weather alert"
 *  command-feed cards, now also carrying lat/lon + temperature/humidity/wind/precipitation for map plotting. */
export async function fetchPublicWeatherMap(): Promise<WeatherMapFeed> {
  const data = await fetchPublicGetJson<{ byLocation?: unknown[]; updatedAt?: string | null }>(
    "/api/public/weather-advisories"
  );
  const spots = Array.isArray(data.byLocation) ? data.byLocation.filter(hasCoords) : [];
  return { spots, updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null };
}
