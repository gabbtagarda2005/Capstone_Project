import type { WeatherSpot } from "@/passenger/lib/fetchPublicWeatherMap";
import "./PassengerWeatherPanel.css";

type Props = {
  spot: WeatherSpot;
  onClose: () => void;
};

/** Open-Meteo WMO weather code -> emoji, matching the icon shown on the map marker. */
export function weatherEmojiForCode(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌡️";
}

function fmtTemp(v: number | null): string {
  return v == null ? "Unavailable" : `${Math.round(v)}°C`;
}

function fmtWind(v: number | null): string {
  return v == null ? "Unavailable" : `${Math.round(v)} km/h`;
}

function fmtHumidity(v: number | null): string {
  return v == null ? "Unavailable" : `${Math.round(v)}%`;
}

function fmtPrecip(v: number | null): string {
  if (v == null) return "Unavailable";
  return v <= 0 ? "None right now" : `${v.toFixed(1)} mm`;
}

/** "Updated 6 min ago" — never "Live", since this reflects a ~10-minute backend refresh cycle,
 *  not a continuous feed (see Backend/Admin_Backend/services/weatherLocationAdvisories.js). */
function fmtUpdated(iso: string | null): string {
  if (!iso) return "Update time unavailable";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Update time unavailable";
  const diffMin = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (diffMin < 1) return "Updated just now";
  if (diffMin === 1) return "Updated 1 min ago";
  if (diffMin < 60) return `Updated ${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  return diffHr === 1 ? "Updated 1 hr ago" : `Updated ${diffHr} hr ago`;
}

export function PassengerWeatherPanel({ spot, onClose }: Props) {
  return (
    <div className="pwx-panel__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="pwx-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Weather for ${spot.locationName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pwx-panel__handle" aria-hidden />
        <header className="pwx-panel__head">
          <div>
            <p className="pwx-panel__eyebrow">Weather</p>
            <h2 className="pwx-panel__title">{spot.locationName}</h2>
          </div>
          <button type="button" className="pwx-panel__close" aria-label="Close weather panel" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="pwx-panel__hero">
          <span className="pwx-panel__hero-icon" aria-hidden>
            {weatherEmojiForCode(spot.code)}
          </span>
          <div>
            <div className="pwx-panel__hero-temp">{fmtTemp(spot.tempC)}</div>
            <div className="pwx-panel__hero-cond">{spot.summary}</div>
          </div>
        </div>

        <div className="pwx-panel__grid">
          <div className="pwx-panel__stat">
            <span className="pwx-panel__stat-label">Rainfall</span>
            <span className="pwx-panel__stat-value">{fmtPrecip(spot.precipitationMm)}</span>
          </div>
          <div className="pwx-panel__stat">
            <span className="pwx-panel__stat-label">Wind</span>
            <span className="pwx-panel__stat-value">{fmtWind(spot.windKph)}</span>
          </div>
          <div className="pwx-panel__stat">
            <span className="pwx-panel__stat-label">Humidity</span>
            <span className="pwx-panel__stat-value">{fmtHumidity(spot.humidityPct)}</span>
          </div>
        </div>

        <footer className="pwx-panel__foot">
          <span>Source: Open-Meteo</span>
          <span className="pwx-panel__foot-sep" aria-hidden>
            ·
          </span>
          <span>{fmtUpdated(spot.observedAt)}</span>
        </footer>
      </div>
    </div>
  );
}
