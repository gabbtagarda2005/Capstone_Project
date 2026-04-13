import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkline } from "@/components/Sparkline";
import { useAuth } from "@/context/AuthContext";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
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

const SPARK_LEN = 48;

type Health = {
  api: string;
  mongo: string;
  firebaseRtdb: string;
  smtp: "configured" | "not_configured" | "unknown";
  smtpProvider: string | null;
};

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

function padSparkHistory(hist: number[], len: number, fallback: number): number[] {
  const h = hist.slice(-len);
  if (h.length >= len) return h;
  const pad = len - h.length;
  const f: number = h.length > 0 ? (h[0] ?? fallback) : fallback;
  return [...Array.from({ length: pad }, (): number => f), ...h];
}

export function CommandCenterPage() {
  const id = useId();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAuditor = user?.rbacRole === "auditor";
  const [live, setLive] = useState(true);
  const [deckLoading, setDeckLoading] = useState(true);
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>({
    api: "unknown",
    mongo: "unknown",
    firebaseRtdb: "unknown",
    smtp: "unknown",
    smtpProvider: null,
  });
  const [dbPingMs, setDbPingMs] = useState<number | null>(null);
  const [apiSpark, setApiSpark] = useState<number[]>(() => Array(SPARK_LEN).fill(0));
  const [mongoSpark, setMongoSpark] = useState<number[]>(() => Array(SPARK_LEN).fill(0));
  const [fbSpark, setFbSpark] = useState<number[]>(() => Array(SPARK_LEN).fill(0));
  const [smtpSpark, setSmtpSpark] = useState<number[]>(() => Array(SPARK_LEN).fill(0));
  const apiHistRef = useRef<number[]>([]);
  const mongoHistRef = useRef<number[]>([]);
  const fbHistRef = useRef<number[]>([]);
  const smtpHistRef = useRef<number[]>([]);
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

  useEffect(() => {
    const roll = (ref: { current: number[] }, sample: number) => {
      ref.current = [...ref.current, sample].slice(-SPARK_LEN);
      return padSparkHistory(ref.current, SPARK_LEN, sample);
    };

    const pullHealth = async () => {
      try {
        const t0 = performance.now();
        const h = await api<{
          ok: boolean;
          mongo: string;
          firebaseRtdb?: string;
          smtp?: string;
          smtpProvider?: string | null;
          otpEmailConfigured?: boolean;
        }>("/health");
        const ms = Math.round(performance.now() - t0);
        setDbPingMs(ms);
        const apiOk = h.ok;
        const mongoOk = h.mongo === "connected";
        const rtdb = h.firebaseRtdb ?? "unknown";
        const smtpConfigured = h.smtp === "configured" || h.otpEmailConfigured === true;
        const smtpNotSet =
          h.smtp === "not_configured" || (h.otpEmailConfigured === false && h.smtp !== "configured");
        const smtpProvider =
          smtpConfigured && typeof h.smtpProvider === "string" && h.smtpProvider.trim()
            ? h.smtpProvider.trim()
            : null;
        setHealth({
          api: apiOk ? "online" : "degraded",
          mongo: h.mongo,
          firebaseRtdb: rtdb,
          smtp: smtpConfigured ? "configured" : smtpNotSet ? "not_configured" : "unknown",
          smtpProvider,
        });
        const fbOk =
          isFirebaseAuthConfigured() && (rtdb === "connected" || rtdb === "disabled");
        const apiSample = Math.min(2500, Math.max(5, apiOk ? ms : ms + 220));
        const mongoSample = Math.min(2500, Math.max(5, mongoOk ? Math.round(ms * 0.98) : ms + 180));
        const fbSample = Math.min(2500, Math.max(5, fbOk ? Math.round(ms * 0.42) : ms + 140));
        const smtpSample = Math.min(2500, Math.max(5, smtpConfigured ? Math.round(ms * 0.22) : ms + 160));
        setApiSpark(roll(apiHistRef, apiSample));
        setMongoSpark(roll(mongoHistRef, mongoSample));
        setFbSpark(roll(fbHistRef, fbSample));
        setSmtpSpark(roll(smtpHistRef, smtpSample));
      } catch {
        setHealth({
          api: "offline",
          mongo: "unknown",
          firebaseRtdb: "unknown",
          smtp: "unknown",
          smtpProvider: null,
        });
        setDbPingMs(null);
        const bad = 888;
        setApiSpark(roll(apiHistRef, bad));
        setMongoSpark(roll(mongoHistRef, bad));
        setFbSpark(roll(fbHistRef, bad));
        setSmtpSpark(roll(smtpHistRef, bad));
      }
    };
    void pullHealth();
    const idInt = window.setInterval(() => void pullHealth(), 8000);
    return () => window.clearInterval(idInt);
  }, []);

  const firebaseOnline = isFirebaseAuthConfigured();

  const networkPulseAlert = useMemo(() => {
    if (health.api === "unknown" && dbPingMs == null) return false;
    if (health.api === "offline" || health.api === "degraded") return true;
    if (health.mongo !== "unknown" && health.mongo !== "connected") return true;
    if (
      firebaseOnline &&
      health.firebaseRtdb !== "unknown" &&
      health.firebaseRtdb !== "connected" &&
      health.firebaseRtdb !== "disabled"
    ) {
      return true;
    }
    return false;
  }, [health, dbPingMs, firebaseOnline]);

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
        <div className="command-center__hub-row">
          <section
            className={
              "command-center__card command-center__card--glass command-center__card--network-pulse" +
              (networkPulseAlert ? " command-center__card--network-pulse--alert" : "")
            }
            aria-labelledby={`${id}-health`}
          >
            <h2 id={`${id}-health`} className="command-center__h2">
              Network pulse
            </h2>
            <ul className="command-center__health-grid">
            <li className="command-center__health-tile">
              <div className="command-center__health-tile-top">
                <span className="command-center__health-label">
                  <span className={"command-center__ping" + (health.api === "online" ? " command-center__ping--on" : "")} aria-hidden />
                  Admin API
                </span>
                <span className={"command-center__pill " + (health.api === "online" ? "command-center__pill--ok" : "command-center__pill--bad")}>{health.api}</span>
              </div>
              <Sparkline values={apiSpark} stroke="rgba(34, 211, 238, 0.95)" fill="rgba(34, 211, 238, 0.1)" className="command-center__spark" />
              <span className="command-center__spark-caption">Last ping {dbPingMs != null ? `${dbPingMs} ms` : "—"}</span>
              {health.api === "offline" ? (
                <button
                  type="button"
                  className="command-center__btn command-center__btn--resync"
                  onClick={() => {
                    setSentFlash("Re-sync signal sent. Retrying health handshake…");
                    window.setTimeout(() => setSentFlash(null), 2400);
                  }}
                >
                  Re-sync
                </button>
              ) : null}
            </li>
            <li className="command-center__health-tile">
              <div className="command-center__health-tile-top">
                <span className="command-center__health-label">
                  <span className={"command-center__ping command-center__ping--breathing" + (health.mongo === "connected" ? " command-center__ping--on" : "")} aria-hidden />
                  MongoDB
                </span>
                <span className={"command-center__pill " + (health.mongo === "connected" ? "command-center__pill--ok" : "command-center__pill--bad")}>{health.mongo}</span>
              </div>
              <Sparkline values={mongoSpark} stroke="rgba(167, 139, 250, 0.95)" fill="rgba(167, 139, 250, 0.1)" className="command-center__spark" />
            </li>
            <li className="command-center__health-tile">
              <div className="command-center__health-tile-top">
                <span className="command-center__health-label">
                  <span
                    className={
                      "command-center__ping command-center__ping--breathing" +
                      (firebaseOnline && (health.firebaseRtdb === "connected" || health.firebaseRtdb === "disabled") ? " command-center__ping--on" : "")
                    }
                    aria-hidden
                  />
                  Firebase hybrid
                </span>
                <span
                  className={
                    "command-center__pill " +
                    (health.firebaseRtdb === "connected" ? "command-center__pill--ok" : health.firebaseRtdb === "disabled" ? "command-center__pill--warn" : "command-center__pill--bad")
                  }
                >
                  {health.firebaseRtdb === "connected" ? "RTDB live" : health.firebaseRtdb === "disabled" ? "RTDB off" : health.firebaseRtdb}
                </span>
              </div>
              <Sparkline values={fbSpark} stroke="rgba(251, 191, 36, 0.9)" fill="rgba(251, 191, 36, 0.08)" className="command-center__spark" />
            </li>
            <li className="command-center__health-tile">
              <div className="command-center__health-tile-top">
                <span className="command-center__health-label">
                  <span
                    className={
                      "command-center__ping command-center__ping--breathing" +
                      (health.smtp === "configured" ? " command-center__ping--on" : "")
                    }
                    aria-hidden
                  />
                  Mail (SMTP)
                </span>
                <span
                  className={
                    "command-center__pill " +
                    (health.smtp === "configured"
                      ? "command-center__pill--ok"
                      : health.smtp === "not_configured"
                        ? "command-center__pill--warn"
                        : "command-center__pill--bad")
                  }
                >
                  {health.smtp === "configured"
                    ? "Ready"
                    : health.smtp === "not_configured"
                      ? "Not set"
                      : "—"}
                </span>
              </div>
              <Sparkline values={smtpSpark} stroke="rgba(244, 114, 182, 0.92)" fill="rgba(244, 114, 182, 0.1)" className="command-center__spark" />
              <span className="command-center__spark-caption">
                {health.smtp === "configured" && health.smtpProvider
                  ? health.smtpProvider
                  : health.smtp === "configured"
                    ? "Env configured (OTP & digests)"
                    : health.smtp === "not_configured"
                      ? "Add SENDGRID_API_KEY or SMTP_* in .env"
                      : "—"}
              </span>
            </li>
          </ul>
          </section>

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
            <span className="command-center__hub-btn-label">Fleet sensors</span>
            <span className="command-center__hub-btn-hint">Wi-Fi/LTE link, voltage, LTE dBm, last seen timer</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
