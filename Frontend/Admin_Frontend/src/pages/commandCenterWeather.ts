/**
 * Default weather pins when the admin has not saved any terminal coverage yet.
 * Command Center prefers GET /api/locations/coverage (parent terminal hubs).
 */

export const COMMAND_WEATHER_SPOTS = [
  { key: "Malaybalay", lat: 8.1477, lon: 125.1324 },
  { key: "Valencia", lat: 7.9042, lon: 125.0938 },
  { key: "Maramag", lat: 7.7617, lon: 125.0053 },
] as const;

export type CommandWeatherSpot = (typeof COMMAND_WEATHER_SPOTS)[number];

export type CommandWeatherRow = {
  code: number;
  label: string;
  emoji: string;
  trend: number[];
  /** °C when known */
  tempC: number | null;
  /** 0–100 when known */
  humidityPct: number | null;
};

export function isHeavyRainCode(code: number): boolean {
  return [65, 67, 81, 82, 95, 96, 99].includes(code);
}

export function weatherEmoji(code: number): string {
  if ([61, 63, 80].includes(code)) return "🌧️";
  if (isHeavyRainCode(code)) return "⛈️";
  if ([71, 73, 75].includes(code)) return "❄️";
  if ([1, 2, 3, 45, 48].includes(code)) return "☁️";
  return "☀️";
}

export function weatherLabelFromCode(code: number): string {
  if (isHeavyRainCode(code)) return "Heavy rain / storm";
  if ([61, 63, 80, 81].includes(code)) return "Rain";
  if ([71, 73, 75].includes(code)) return "Cold / frost";
  if ([1, 2, 3, 45, 48].includes(code)) return "Cloudy";
  return "Clear";
}
