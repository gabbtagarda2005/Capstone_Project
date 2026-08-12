import { useCallback, useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { FleetHardwareSummary } from "@/components/FleetHardwareSummary";
import { api, fetchAdminPortalSettings, putAdminPortalSettings } from "@/lib/api";
import {
  COMMAND_CENTER_BROADCAST,
  COMMAND_CENTER_FLEET_SENSORS,
  COMMAND_CENTER_MAINTENANCE,
  COMMAND_CENTER_SYSTEM_FEEDBACK,
} from "@/pages/commandCenterPaths";
import { fetchWeatherApiSpot, getWeatherApiKey } from "@/lib/weatherApi";
import { COMMAND_WEATHER_SPOTS, type CommandWeatherRow, weatherEmoji, weatherLabelFromCode } from "@/pages/commandCenterWeather";
import "./CommandCenterPage.css";

type CoverageTerminalLean = {
  _id: string;
  locationName: string;
  pointType: string;
  terminal: { name: string; latitude: number; longitude: number };
};

type CommandCenterWeatherSpot = { spotKey: string; label: string; lat: number; lon: number };

function defaultWeatherSpots(): CommandCenterWeatherSpot[] {
  return COMMAND_WEATHER_SPOTS.map((s) => ({
    spotKey: s.key,
    label: s.key,
    lat: s.lat,
    lon: s.lon,
  }));
}

export function CommandCenterPage() {
  const id = useId();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAuditor = user?.rbacRole === "auditor";
  const [live, setLive] = useState(true);
  const [deckLoading, setDeckLoading] = useState(true);
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const [weather, setWeather] = useState<Record<string, CommandWeatherRow>>({});
  const [weatherSpots, setWeatherSpots] = useState<CommandCenterWeatherSpot[]>(defaultWeatherSpots);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { settings } = await fetchAdminPortalSettings();
        if (!cancelled) setLive(settings.operationsDeckLive !== false);
      } catch {
        /* default LIVE */
      } finally {
        if (!cancelled) setDeckLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleOperationsDeck = useCallback(async () => {
    if (isAuditor || deckLoading) return;
    const next = !live;
    setLive(next);
    setSentFlash(
      next
        ? "Passengers can see live buses on the map and fleet registry again."
        : "Passengers no longer see live buses on the map or the fleet registry until you go LIVE."
    );
    try {
      await putAdminPortalSettings({ commandCenter: { operationsDeckLive: next } });
    } catch (e) {
      setLive(!next);
      setSentFlash(e instanceof Error ? e.message : "Could not save operations deck.");
    }
    window.setTimeout(() => setSentFlash(null), 4200);
  }, [deckLoading, isAuditor, live]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cov = await api<{ items: CoverageTerminalLean[] }>("/api/locations/coverage");
        if (cancelled) return;
        const terminals = (cov.items ?? [])
          .filter(
            (c) =>
              c.pointType === "terminal" &&
              Number.isFinite(c.terminal?.latitude) &&
              Number.isFinite(c.terminal?.longitude)
          )
          .map((c) => ({
            spotKey: c._id,
            label: (c.locationName || c.terminal?.name || "Terminal").trim() || "Terminal",
            lat: c.terminal.latitude,
            lon: c.terminal.longitude,
          }));
        if (terminals.length > 0) setWeatherSpots(terminals);
      } catch {
        /* keep default Bukidnon spots */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const useWxApi = Boolean(getWeatherApiKey());
        const results = await Promise.all(
          weatherSpots.map(async (s) => {
            if (useWxApi) {
              const row = await fetchWeatherApiSpot(s.lat, s.lon);
              if (row) return [s.spotKey, row] as const;
            }
            const url =
              `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}` +
              `&current=temperature_2m,relative_humidity_2m,weather_code` +
              `&hourly=precipitation&forecast_hours=3&timezone=auto`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("wx");
            const data = (await res.json()) as {
              current?: { weather_code?: number; temperature_2m?: number; relative_humidity_2m?: number };
              hourly?: { precipitation?: number[] };
            };
            const cur = data.current;
            const code = Number(cur?.weather_code ?? 0);
            const trend = (data.hourly?.precipitation ?? []).slice(0, 3).map((n) => Number(n) || 0);
            const t2 = cur?.temperature_2m;
            const h2 = cur?.relative_humidity_2m;
            const tempC = typeof t2 === "number" && Number.isFinite(t2) ? t2 : null;
            const humidityPct =
              typeof h2 === "number" && Number.isFinite(h2) ? Math.round(Math.min(100, Math.max(0, h2))) : null;
            return [
              s.spotKey,
              { code, label: weatherLabelFromCode(code), emoji: weatherEmoji(code), trend, tempC, humidityPct },
            ] as const;
          })
        );
        if (!cancelled) setWeather(Object.fromEntries(results));
      } catch {
        /* ignore */
      }
    };
    void run();
    const wxInt = window.setInterval(() => void run(), 300_000);
    return () => {
      cancelled = true;
      window.clearInterval(wxInt);
    };
  }, [weatherSpots]);

  return (
    <div className="command-center command-center--tactical command-center--hub">
      <header className="command-center__hero">
        <div className="command-center__hero-text">
          <p className="command-center__eyebrow">Operations deck</p>
          <h1 className="command-center__title">Command center</h1>
          <p className="command-center__lead">Tactical transit mission control · Bukidnon network pulse</p>
        </div>
        <div className="command-center__hero-actions">
          <button
            type="button"
            className={"command-center__live" + (live ? " command-center__live--on" : "")}
            onClick={() => void toggleOperationsDeck()}
            aria-pressed={live}
            disabled={isAuditor || deckLoading}
            title={
              isAuditor
                ? "Auditors cannot change the operations deck."
                : "When OFFLINE, passengers do not see live buses on the map or buses in Check buses · Fleet registry."
            }
          >
            <span className="command-center__live-dot" aria-hidden />
            {deckLoading ? "…" : live ? "LIVE" : "OFFLINE"}
          </button>
        </div>
      </header>

      {sentFlash ? <div className="command-center__flash">{sentFlash}</div> : null}

      <div className="command-center__hub-layout">
        <section className="command-center__card command-center__card--glass" aria-labelledby={`${id}-sensors`}>
          <h2 id={`${id}-sensors`} className="command-center__h2">
            Fleet sensors
          </h2>
          <FleetHardwareSummary />
        </section>

        <div className="command-center__hub-row command-center__hub-row--single">
          <section className="command-center__card command-center__card--glass" aria-labelledby={`${id}-wx`}>
            <h2 id={`${id}-wx`} className="command-center__h2">
              Weather overlay
            </h2>
            <ul className="command-center__wx-list">
              {weatherSpots.map((s) => {
                const w = weather[s.spotKey];
                const metrics =
                  w && (w.tempC != null || w.humidityPct != null)
                    ? [
                        w.tempC != null ? `${w.tempC.toFixed(1)}°C` : null,
                        w.humidityPct != null ? `${w.humidityPct}% humidity` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null;
                return (
                  <li key={s.spotKey} className="command-center__wx-row">
                    <span className="command-center__wx-city">{s.label}</span>
                    <span className="command-center__wx-meta command-center__wx-meta--stack">
                      <span className="command-center__wx-condition">{w ? `${w.emoji} ${w.label}` : "…"}</span>
                      {metrics ? <span className="command-center__wx-temp-hum">{metrics}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <nav className="command-center__hub-nav" aria-label="Command modules">
          <button type="button" className="command-center__hub-btn command-center__hub-btn--intel" onClick={() => navigate(COMMAND_CENTER_SYSTEM_FEEDBACK)}>
            <span className="command-center__hub-btn-label">Feedback intelligence</span>
            <span className="command-center__hub-btn-hint">Passenger CSAT, alerts, route hotspots</span>
          </button>
          <button type="button" className="command-center__hub-btn command-center__hub-btn--broadcast" onClick={() => navigate(COMMAND_CENTER_BROADCAST)}>
            <span className="command-center__hub-btn-label">Broadcast center</span>
            <span className="command-center__hub-btn-hint">Passenger &amp; attendant notices</span>
          </button>
          <button type="button" className="command-center__hub-btn command-center__hub-btn--maint" onClick={() => navigate(COMMAND_CENTER_MAINTENANCE)}>
            <span className="command-center__hub-btn-label">Maintenance window</span>
            <span className="command-center__hub-btn-hint">Deck flag &amp; settings</span>
          </button>
          <button type="button" className="command-center__hub-btn command-center__hub-btn--broadcast" onClick={() => navigate(COMMAND_CENTER_FLEET_SENSORS)}>
            <span className="command-center__hub-btn-label">System health</span>
            <span className="command-center__hub-btn-hint">Admin API, database, Firebase &amp; mail status</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
