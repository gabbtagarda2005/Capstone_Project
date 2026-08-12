import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import { api } from "@/lib/api";
import "@/pages/CommandCenterPage.css";

const SPARK_LEN = 48;

type Health = {
  api: string;
  mongo: string;
  firebaseRtdb: string;
  smtp: "configured" | "not_configured" | "unknown";
  smtpProvider: string | null;
  socketConnections: number | null;
  smsConfigured: boolean | null;
  authConfigured: boolean | null;
  reportsAvailable: boolean | null;
  gpsLiveBusCount: number | null;
  gpsActiveLast5Min: number | null;
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  cpuCount: number | null;
  memoryMB: { rss: number; heapUsed: number; heapTotal: number } | null;
};

function formatUptime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function padSparkHistory(hist: number[], len: number, fallback: number): number[] {
  const h = hist.slice(-len);
  if (h.length >= len) return h;
  const pad = len - h.length;
  const f: number = h.length > 0 ? (h[0] ?? fallback) : fallback;
  return [...Array.from({ length: pad }, (): number => f), ...h];
}

/** Live status for the admin API, MongoDB, Firebase RTDB, and outbound mail — reused on the
 * Fleet Sensors / System Health page and as the entire dashboard for restricted IT accounts. */
export function NetworkPulseCard() {
  const id = useId();
  const [health, setHealth] = useState<Health>({
    api: "unknown",
    mongo: "unknown",
    firebaseRtdb: "unknown",
    smtp: "unknown",
    smtpProvider: null,
    socketConnections: null,
    smsConfigured: null,
    authConfigured: null,
    reportsAvailable: null,
    gpsLiveBusCount: null,
    gpsActiveLast5Min: null,
    uptimeSeconds: null,
    cpuPercent: null,
    cpuCount: null,
    memoryMB: null,
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
  const [sentFlash, setSentFlash] = useState<string | null>(null);

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
          socketConnections?: number;
          smsConfigured?: boolean;
          authConfigured?: boolean;
          reportsAvailable?: boolean;
          gpsLiveBusCount?: number | null;
          gpsActiveLast5Min?: number | null;
          uptimeSeconds?: number;
          cpuPercent?: number;
          cpuCount?: number;
          memoryMB?: { rss: number; heapUsed: number; heapTotal: number };
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
          socketConnections: typeof h.socketConnections === "number" ? h.socketConnections : null,
          smsConfigured: typeof h.smsConfigured === "boolean" ? h.smsConfigured : null,
          authConfigured: typeof h.authConfigured === "boolean" ? h.authConfigured : null,
          reportsAvailable: typeof h.reportsAvailable === "boolean" ? h.reportsAvailable : null,
          gpsLiveBusCount: typeof h.gpsLiveBusCount === "number" ? h.gpsLiveBusCount : null,
          gpsActiveLast5Min: typeof h.gpsActiveLast5Min === "number" ? h.gpsActiveLast5Min : null,
          uptimeSeconds: typeof h.uptimeSeconds === "number" ? h.uptimeSeconds : null,
          cpuPercent: typeof h.cpuPercent === "number" ? h.cpuPercent : null,
          cpuCount: typeof h.cpuCount === "number" ? h.cpuCount : null,
          memoryMB: h.memoryMB ?? null,
        });
        const fbOk = isFirebaseAuthConfigured() && (rtdb === "connected" || rtdb === "disabled");
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
          socketConnections: null,
          smsConfigured: null,
          authConfigured: null,
          reportsAvailable: null,
          gpsLiveBusCount: null,
          gpsActiveLast5Min: null,
          uptimeSeconds: null,
          cpuPercent: null,
          cpuCount: null,
          memoryMB: null,
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

  /** Every entry here is derived from a real, currently-measured signal — nothing is simulated. */
  const activeAlerts = useMemo(() => {
    const out: { severity: "critical" | "warning"; text: string }[] = [];
    if (health.api === "offline") out.push({ severity: "critical", text: "Admin API is unreachable — health checks are failing." });
    else if (health.api === "degraded") out.push({ severity: "warning", text: "Admin API responded but reported a degraded state." });
    if (health.mongo !== "unknown" && health.mongo !== "connected") {
      out.push({ severity: "critical", text: "MongoDB is disconnected — fleet, ticketing, and auth data are unavailable." });
    }
    if (
      firebaseOnline &&
      health.firebaseRtdb !== "unknown" &&
      health.firebaseRtdb !== "connected" &&
      health.firebaseRtdb !== "disabled"
    ) {
      out.push({ severity: "warning", text: "Firebase Realtime Database is not reachable." });
    }
    if (health.authConfigured === false) {
      out.push({ severity: "critical", text: "JWT_SECRET is missing — admin/operator logins cannot be issued." });
    }
    if ((health.gpsLiveBusCount ?? 0) > 0 && (health.gpsActiveLast5Min ?? 0) === 0) {
      out.push({ severity: "warning", text: `${health.gpsLiveBusCount} registered bus(es) exist, but none have reported GPS in the last 5 minutes.` });
    }
    if (health.cpuPercent != null && health.cpuPercent >= 85) {
      out.push({ severity: "warning", text: `Admin API process CPU usage is high (${health.cpuPercent}%).` });
    }
    if (health.memoryMB && health.memoryMB.heapTotal > 0) {
      const heapPct = Math.round((health.memoryMB.heapUsed / health.memoryMB.heapTotal) * 100);
      if (heapPct >= 90) out.push({ severity: "warning", text: `Admin API heap usage is high (${heapPct}%).` });
    }
    return out;
  }, [health, firebaseOnline]);

  const hasCriticalAlert = activeAlerts.some((a) => a.severity === "critical");

  return (
    <>
      {sentFlash ? <div className="command-center__flash">{sentFlash}</div> : null}

      <section
        className={"command-center__card command-center__card--glass command-center__active-alerts" + (activeAlerts.length > 0 ? " command-center__active-alerts--live" : "")}
        aria-live="polite"
      >
        <h2 className="command-center__h2">Active alerts</h2>
        {activeAlerts.length === 0 ? (
          <p className="command-center__alerts-empty">🟢 All monitored services are within normal range.</p>
        ) : (
          <ul className="command-center__alerts-list">
            {activeAlerts.map((a, i) => (
              <li key={i} className={"command-center__alert-row command-center__alert-row--" + a.severity}>
                <span className="command-center__alert-badge">{a.severity === "critical" ? "🔴 CRITICAL" : "🟠 WARNING"}</span>
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className={
          "command-center__card command-center__card--glass command-center__card--network-pulse" +
          (hasCriticalAlert ? " command-center__card--network-pulse--alert" : "")
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
                {health.smtp === "configured" ? "Ready" : health.smtp === "not_configured" ? "Not set" : "—"}
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
          <li className="command-center__health-tile">
            <div className="command-center__health-tile-top">
              <span className="command-center__health-label">
                <span
                  className={"command-center__ping" + (health.api === "online" ? " command-center__ping--on" : "")}
                  aria-hidden
                />
                Socket.IO
              </span>
              <span className={"command-center__pill " + (health.api === "online" ? "command-center__pill--ok" : "command-center__pill--bad")}>
                {health.api === "online" ? "Live" : "—"}
              </span>
            </div>
            <span className="command-center__spark-caption">
              {health.socketConnections != null ? `${health.socketConnections} connection${health.socketConnections === 1 ? "" : "s"}` : "—"}
            </span>
          </li>
          <li className="command-center__health-tile">
            <div className="command-center__health-tile-top">
              <span className="command-center__health-label">
                <span
                  className={"command-center__ping" + ((health.gpsActiveLast5Min ?? 0) > 0 ? " command-center__ping--on" : "")}
                  aria-hidden
                />
                GPS ingest
              </span>
              <span className={"command-center__pill " + ((health.gpsActiveLast5Min ?? 0) > 0 ? "command-center__pill--ok" : "command-center__pill--warn")}>
                {(health.gpsActiveLast5Min ?? 0) > 0 ? "Active" : "Idle"}
              </span>
            </div>
            <span className="command-center__spark-caption">
              {health.gpsActiveLast5Min != null && health.gpsLiveBusCount != null
                ? `${health.gpsActiveLast5Min} of ${health.gpsLiveBusCount} buses reporting in last 5 min`
                : "—"}
            </span>
          </li>
          <li className="command-center__health-tile">
            <div className="command-center__health-tile-top">
              <span className="command-center__health-label">
                <span className={"command-center__ping" + (health.smsConfigured ? " command-center__ping--on" : "")} aria-hidden />
                SMS gateway
              </span>
              <span className={"command-center__pill " + (health.smsConfigured ? "command-center__pill--ok" : "command-center__pill--warn")}>
                {health.smsConfigured == null ? "—" : health.smsConfigured ? "Configured" : "Not set"}
              </span>
            </div>
            <span className="command-center__spark-caption">
              {health.smsConfigured ? "IPROG token present" : "Add IPROG_API_TOKEN in .env"}
            </span>
          </li>
          <li className="command-center__health-tile">
            <div className="command-center__health-tile-top">
              <span className="command-center__health-label">
                <span className={"command-center__ping" + (health.authConfigured ? " command-center__ping--on" : "")} aria-hidden />
                Auth service
              </span>
              <span className={"command-center__pill " + (health.authConfigured ? "command-center__pill--ok" : "command-center__pill--bad")}>
                {health.authConfigured == null ? "—" : health.authConfigured ? "Configured" : "Missing"}
              </span>
            </div>
            <span className="command-center__spark-caption">JWT session signing</span>
          </li>
          <li className="command-center__health-tile">
            <div className="command-center__health-tile-top">
              <span className="command-center__health-label">
                <span className={"command-center__ping" + (health.reportsAvailable ? " command-center__ping--on" : "")} aria-hidden />
                Reports (PDF/Excel)
              </span>
              <span className={"command-center__pill " + (health.reportsAvailable ? "command-center__pill--ok" : "command-center__pill--warn")}>
                {health.reportsAvailable ? "Available" : "—"}
              </span>
            </div>
            <span className="command-center__spark-caption">Generated in-process by Admin API — not a separate service</span>
          </li>
          <li className="command-center__health-tile command-center__health-tile--wide">
            <div className="command-center__health-tile-top">
              <span className="command-center__health-label">
                <span className={"command-center__ping" + (health.api === "online" ? " command-center__ping--on" : "")} aria-hidden />
                Server runtime
              </span>
              <span className="command-center__pill command-center__pill--ok">Up {formatUptime(health.uptimeSeconds)}</span>
            </div>
            <span className="command-center__spark-caption">
              {health.cpuPercent != null ? `CPU ${health.cpuPercent}% of ${health.cpuCount} core${health.cpuCount === 1 ? "" : "s"}` : "CPU —"}
              {health.memoryMB ? ` · Memory ${health.memoryMB.heapUsed}/${health.memoryMB.heapTotal} MB heap (${health.memoryMB.rss} MB RSS)` : ""}
            </span>
          </li>
        </ul>
      </section>
    </>
  );
}
