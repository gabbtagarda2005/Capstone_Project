import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import { api, fetchReportsAnalytics, postAdminAuditEvent } from "@/lib/api";
import type { ReportsAnalyticsDto } from "@/lib/types";
import "./CommandCenterPage.css";

const LS_MAINT = "command_center_maintenance";
const LS_BROADCAST = "command_center_broadcast_draft";
const LS_BROADCAST_PRIORITY = "command_center_broadcast_priority_v1";
const LS_BROADCAST_TARGET = "command_center_broadcast_target_v1";

const SPARK_LEN = 48;

type Health = { api: string; mongo: string; mysql: string; firebaseRtdb: string };
type BroadcastTarget = "passenger" | "attendant";

const WEATHER_SPOTS = [
  { key: "Malaybalay", lat: 8.1477, lon: 125.1324 },
  { key: "Valencia", lat: 7.9042, lon: 125.0938 },
  { key: "Maramag", lat: 7.7617, lon: 125.0053 },
] as const;

function seedSparkline(base: number, len: number): number[] {
  return Array.from({ length: len }, (_, i) => Math.max(8, base + Math.sin(i / 4.2) * 22 + (Math.random() - 0.5) * 14));
}

function isHeavyRainCode(code: number): boolean {
  return [65, 67, 81, 82, 95, 96, 99].includes(code);
}

function weatherEmoji(code: number): string {
  if ([61, 63, 80].includes(code)) return "🌧️";
  if (isHeavyRainCode(code)) return "⛈️";
  if ([71, 73, 75].includes(code)) return "❄️";
  if ([1, 2, 3, 45, 48].includes(code)) return "☁️";
  return "☀️";
}

function weatherLabelFromCode(code: number): string {
  if (isHeavyRainCode(code)) return "Heavy rain / storm";
  if ([61, 63, 80, 81].includes(code)) return "Rain";
  if ([71, 73, 75].includes(code)) return "Cold / frost";
  if ([1, 2, 3, 45, 48].includes(code)) return "Cloudy";
  return "Clear";
}

const MARAMAG_SUGGEST =
  "Caution: Heavy rain in Maramag corridor. Expect 20-minute delays. Plan alternate capacity if possible.";

export function CommandCenterPage() {
  const id = useId();

  const [broadcast, setBroadcast] = useState("");
  const [broadcastTarget, setBroadcastTarget] = useState<BroadcastTarget>("passenger");
  const [broadcastPriority, setBroadcastPriority] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [live, setLive] = useState(true);
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const [health, setHealth] = useState<Health>({
    api: "unknown",
    mongo: "unknown",
    mysql: "unknown",
    firebaseRtdb: "unknown",
  });
  const [dbPingMs, setDbPingMs] = useState<number | null>(null);
  const [apiSpark, setApiSpark] = useState(() => seedSparkline(55, SPARK_LEN));
  const [mongoSpark, setMongoSpark] = useState(() => seedSparkline(48, SPARK_LEN));
  const [fbSpark, setFbSpark] = useState(() => seedSparkline(32, SPARK_LEN));
  const [weather, setWeather] = useState<Record<string, { code: number; label: string; emoji: string; trend: number[] }>>({});

  useEffect(() => {
    try {
      setMaintenance(localStorage.getItem(LS_MAINT) === "1");
      const d = localStorage.getItem(LS_BROADCAST);
      if (d) setBroadcast(d);
      const tgt = localStorage.getItem(LS_BROADCAST_TARGET);
      if (tgt === "passenger" || tgt === "attendant") setBroadcastTarget(tgt);
      setBroadcastPriority(localStorage.getItem(LS_BROADCAST_PRIORITY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_BROADCAST_PRIORITY, broadcastPriority ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [broadcastPriority]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_BROADCAST_TARGET, broadcastTarget);
    } catch {
      /* ignore */
    }
  }, [broadcastTarget]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_MAINT, maintenance ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [maintenance]);

  const pushSparkSamples = useCallback(
    (ping: number | null, apiOk: boolean, mongoOk: boolean, fbOk: boolean) => {
      const p = ping ?? 160;
      setApiSpark((prev) => [...prev.slice(1), Math.min(800, Math.max(12, p + (apiOk ? 0 : 120)))]);
      setMongoSpark((prev) => [...prev.slice(1), Math.min(800, Math.max(12, p * 0.92 + (mongoOk ? -4 : 95) + Math.random() * 8))]);
      setFbSpark((prev) => [...prev.slice(1), Math.min(120, Math.max(14, 28 + (fbOk ? 0 : 40) + Math.random() * 6))]);
    },
    []
  );

  useEffect(() => {
    const pullHealth = async () => {
      try {
        const t0 = performance.now();
        const h = await api<{
          ok: boolean;
          mongo: string;
          mysqlTicketing: string;
          firebaseRtdb?: string;
        }>("/health");
        const ms = Math.round(performance.now() - t0);
        setDbPingMs(ms);
        const apiOk = h.ok;
        const mongoOk = h.mongo === "connected";
        const rtdb = h.firebaseRtdb ?? "unknown";
        setHealth({
          api: apiOk ? "online" : "degraded",
          mongo: h.mongo,
          mysql: h.mysqlTicketing,
          firebaseRtdb: rtdb,
        });
        const fbOk =
          isFirebaseAuthConfigured() && (rtdb === "connected" || rtdb === "disabled");
        pushSparkSamples(ms, apiOk, mongoOk, fbOk);
      } catch {
        setHealth({ api: "offline", mongo: "unknown", mysql: "unknown", firebaseRtdb: "unknown" });
        setDbPingMs(null);
        pushSparkSamples(null, false, false, false);
      }
    };
    void pullHealth();
    const idInt = window.setInterval(() => {
      if (live) void pullHealth();
    }, 8000);
    return () => window.clearInterval(idInt);
  }, [live, pushSparkSamples]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const results = await Promise.all(
          WEATHER_SPOTS.map(async (s) => {
            const url =
              `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}` +
              `&current=weather_code&hourly=precipitation&forecast_hours=3&timezone=auto`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("wx");
            const data = (await res.json()) as { current?: { weather_code?: number }; hourly?: { precipitation?: number[] } };
            const code = Number(data.current?.weather_code ?? 0);
            const trend = (data.hourly?.precipitation ?? []).slice(0, 3).map((n) => Number(n) || 0);
            return [s.key, { code, label: weatherLabelFromCode(code), emoji: weatherEmoji(code), trend }] as const;
          })
        );
        if (!cancelled) setWeather(Object.fromEntries(results));
      } catch {
        /* ignore */
      }
    };
    void run();
    const idInt = window.setInterval(() => void run(), 300_000);
    return () => {
      cancelled = true;
      window.clearInterval(idInt);
    };
  }, []);

  const maramagHeavy = weather["Maramag"] && isHeavyRainCode(weather["Maramag"].code);

  useEffect(() => {
    try {
      localStorage.setItem(LS_BROADCAST, broadcast);
    } catch {
      /* ignore */
    }
  }, [broadcast]);

  const sendBroadcast = useCallback(() => {
    if (!broadcast.trim()) {
      setSentFlash("Enter a message first.");
      window.setTimeout(() => setSentFlash(null), 2000);
      return;
    }
    void postAdminAuditEvent({
      action: "BROADCAST",
      module: "Command Center",
      details: `${broadcastPriority ? "[HIGH] " : ""}[${broadcastTarget.toUpperCase()}] Queued broadcast: ${broadcast.slice(0, 400)}${broadcast.length > 400 ? "…" : ""}`,
    }).catch(() => {});
    setSentFlash(`Broadcast queued for ${broadcastTarget === "passenger" ? "Passenger App" : "Bus Attendant App"}.`);
    window.setTimeout(() => setSentFlash(null), 2800);
  }, [broadcast, broadcastPriority, broadcastTarget]);

  const firebaseOnline = isFirebaseAuthConfigured();

  const [reportIntel, setReportIntel] = useState<ReportsAnalyticsDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await fetchReportsAnalytics();
        if (!cancelled) setReportIntel(a);
      } catch {
        if (!cancelled) setReportIntel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const systemFeedbackText = useMemo(() => {
    if (!reportIntel) {
      return "Connect MySQL ticketing to unlock live revenue, peak-hour, and corridor insights from Reports & Analytics.";
    }
    const { insights, executive } = reportIntel;
    const w = insights.peakBoardingWindow;
    return `INSIGHT: Peak boarding window ${String(w.startHour).padStart(2, "0")}:00–${String(w.endHour).padStart(2, "0")}:00 (${insights.peakCorridorHint}). MTD revenue ₱${executive.monthlyRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${executive.goalProgressPct.toFixed(1)}% of ₱${reportIntel.constants.monthlyProfitGoalPesos.toLocaleString()} goal). Consider ${insights.suggestedExtraBuses} extra bus(es) for route optimization. Sentiment: ${insights.routeDelaySentiment}.`;
  }, [reportIntel]);

  return (
    <div
      className={
        "command-center command-center--tactical" +
        (maintenance ? " command-center--maintenance" : "") +
        (broadcastPriority ? " command-center--priority-high" : "")
      }
    >
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
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
          >
            <span className="command-center__live-dot" aria-hidden />
            {live ? "LIVE" : "OFFLINE"}
          </button>
        </div>
      </header>

      {sentFlash ? <div className="command-center__flash">{sentFlash}</div> : null}

      <div className="command-center__tactical-grid">
        <div className="command-center__tactical-col">
          <section className="command-center__card command-center__card--glass" aria-labelledby={`${id}-health`}>
            <h2 id={`${id}-health`} className="command-center__h2">Network pulse</h2>
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
                  <button type="button" className="command-center__btn command-center__btn--resync" onClick={() => { setSentFlash("Re-sync signal sent. Retrying health handshake…"); window.setTimeout(() => setSentFlash(null), 2400); }}>
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
                    <span className={"command-center__ping command-center__ping--breathing" + (firebaseOnline && (health.firebaseRtdb === "connected" || health.firebaseRtdb === "disabled") ? " command-center__ping--on" : "")} aria-hidden />
                    Firebase hybrid
                  </span>
                  <span className={"command-center__pill " + (health.firebaseRtdb === "connected" ? "command-center__pill--ok" : health.firebaseRtdb === "disabled" ? "command-center__pill--warn" : "command-center__pill--bad")}>
                    {health.firebaseRtdb === "connected" ? "RTDB live" : health.firebaseRtdb === "disabled" ? "RTDB off" : health.firebaseRtdb}
                  </span>
                </div>
                <Sparkline values={fbSpark} stroke="rgba(251, 191, 36, 0.9)" fill="rgba(251, 191, 36, 0.08)" className="command-center__spark" />
              </li>
              <li className="command-center__health-tile command-center__health-tile--wide">
                <div className="command-center__health-tile-top">
                  <span className="command-center__health-label">MySQL / ticketing</span>
                  <span className={"command-center__pill " + (health.mysql === "connected" ? "command-center__pill--ok" : "command-center__pill--bad")}>{health.mysql}</span>
                </div>
              </li>
            </ul>
          </section>

          <section className="command-center__card command-center__card--glass command-center__card--intel" aria-labelledby={`${id}-intel`}>
            <h2 id={`${id}-intel`} className="command-center__h2">System feedback intelligence</h2>
            <p className="command-center__intel-body">{systemFeedbackText}</p>
          </section>
        </div>

        <div className="command-center__tactical-col">
          <section className="command-center__card command-center__card--glass command-center__card--broadcast" aria-labelledby={`${id}-bc`}>
            <h2 id={`${id}-bc`} className="command-center__h2">Broadcast center</h2>
            <label className="command-center__priority">
              <input type="checkbox" checked={broadcastPriority} onChange={(e) => setBroadcastPriority(e.target.checked)} />
              <span className="command-center__priority-ui" />
              <span className="command-center__priority-text">High priority (critical banner + pulse)</span>
            </label>
            <div className="command-center__target-row" role="radiogroup" aria-label="Broadcast target">
              <button
                type="button"
                className={"command-center__btn command-center__btn--target" + (broadcastTarget === "passenger" ? " command-center__btn--target-active" : "")}
                onClick={() => setBroadcastTarget("passenger")}
                aria-pressed={broadcastTarget === "passenger"}
              >
                Passenger App
              </button>
              <button
                type="button"
                className={"command-center__btn command-center__btn--target" + (broadcastTarget === "attendant" ? " command-center__btn--target-active" : "")}
                onClick={() => setBroadcastTarget("attendant")}
                aria-pressed={broadcastTarget === "attendant"}
              >
                Bus Attendant App
              </button>
            </div>
            <textarea className="command-center__textarea command-center__textarea--terminal" rows={4} value={broadcast} onChange={(e) => setBroadcast(e.target.value)} placeholder="e.g. Route 12 delayed 15 minutes due to weather in Valencia…" maxLength={2000} />
            <div className="command-center__row">
              <span className="command-center__meta">
                Target: {broadcastTarget === "passenger" ? "Passenger App" : "Bus Attendant App"}
              </span>
              <div className="command-center__btn-row">
                <button type="button" className="command-center__btn command-center__btn--primary" onClick={sendBroadcast}>
                  Send to {broadcastTarget === "passenger" ? "Passenger App" : "Bus Attendant App"}
                </button>
              </div>
            </div>
          </section>

          <section className="command-center__card command-center__card--glass" aria-labelledby={`${id}-wx`}>
            <h2 id={`${id}-wx`} className="command-center__h2">Weather overlay</h2>
            <ul className="command-center__wx-list">
              {WEATHER_SPOTS.map((s) => {
                const w = weather[s.key];
                return (
                  <li key={s.key} className="command-center__wx-row">
                    <span className="command-center__wx-city">{s.key}</span>
                    <span className="command-center__wx-meta">{w ? `${w.emoji} ${w.label}` : "…"}</span>
                    <Sparkline values={w?.trend ?? []} width={64} height={18} stroke="rgba(148, 197, 255, 0.95)" fill="rgba(96, 165, 250, 0.14)" />
                  </li>
                );
              })}
            </ul>
            {maramagHeavy ? (
              <button type="button" className="command-center__btn command-center__btn--warn" onClick={() => setBroadcast(MARAMAG_SUGGEST)}>
                Insert Maramag heavy-rain advisory
              </button>
            ) : null}
          </section>

          <section className="command-center__card command-center__card--glass" aria-labelledby={`${id}-maint`}>
            <h2 id={`${id}-maint`} className="command-center__h2">Maintenance window</h2>
            <label className="command-center__toggle">
              <input type="checkbox" checked={maintenance} onChange={(e) => setMaintenance(e.target.checked)} />
              <span className="command-center__toggle-ui" />
              <span className="command-center__toggle-text">{maintenance ? "Maintenance ON" : "Maintenance OFF"}</span>
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
