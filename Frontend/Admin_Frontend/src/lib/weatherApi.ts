/**
 * WeatherAPI.com — https://www.weatherapi.com/docs/
 * Set VITE_WEATHERAPI_KEY in .env.local (never commit the key).
 */

import type { CommandWeatherRow } from "@/pages/commandCenterWeather";

export function getWeatherApiKey(): string {
  return (import.meta.env.VITE_WEATHERAPI_KEY as string | undefined)?.trim() ?? "";
}

type ForecastJson = {
  error?: { message: string };
  current?: {
    temp_c?: number;
    humidity?: number;
    condition: { text: string; code: number };
  };
  forecast?: {
    forecastday?: Array<{
      hour?: Array<{ precip_mm?: number }>;
    }>;
  };
};

/** Emoji from API condition text (works across WeatherAPI code set). */
export function emojiFromConditionText(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("thunder")) return "⛈️";
  if (t.includes("blizzard") || t.includes("snow") || t.includes("sleet") || t.includes("ice")) return "❄️";
  if (t.includes("rain") || t.includes("drizzle") || t.includes("shower")) return "🌧️";
  if (t.includes("cloud") || t.includes("overcast") || t.includes("mist") || t.includes("fog")) return "☁️";
  if (t.includes("clear") || t.includes("sunny")) return "☀️";
  return "☁️";
}

export async function fetchWeatherApiSpot(lat: number, lon: number): Promise<CommandWeatherRow | null> {
  const key = getWeatherApiKey();
  if (!key) return null;

  const q = `${lat},${lon}`;
  const url =
    `https://api.weatherapi.com/v1/forecast.json?` +
    new URLSearchParams({
      key,
      q,
      days: "1",
      aqi: "no",
      alerts: "no",
    }).toString();

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as ForecastJson;
  if (data.error?.message) return null;

  const current = data.current;
  if (!current?.condition) return null;

  const label = current.condition.text || "Weather";
  const emoji = emojiFromConditionText(label);
  const code = Number(current.condition.code) || 0;
  const hours = data.forecast?.forecastday?.[0]?.hour ?? [];
  const trend = hours.slice(0, 3).map((h) => Math.max(0, Number(h.precip_mm) || 0));
  const tempRaw = current.temp_c;
  const humRaw = current.humidity;
  const tempC = typeof tempRaw === "number" && Number.isFinite(tempRaw) ? tempRaw : null;
  const humidityPct = typeof humRaw === "number" && Number.isFinite(humRaw) ? Math.round(Math.min(100, Math.max(0, humRaw))) : null;

  return { code, label, emoji, trend, tempC, humidityPct };
}

/** Hub label for map / legend (no sparkline). */
export async function fetchWeatherApiHubSummary(
  lat: number,
  lon: number
): Promise<{ label: string; emoji: string; tempC: number | null; humidityPct: number | null } | null> {
  const row = await fetchWeatherApiSpot(lat, lon);
  if (!row) return null;
  return { label: row.label, emoji: row.emoji, tempC: row.tempC, humidityPct: row.humidityPct };
}
