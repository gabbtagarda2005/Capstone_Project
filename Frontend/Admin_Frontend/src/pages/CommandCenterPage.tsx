import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import { getGeofenceAlerts } from "@/lib/opsEvents";
import "./CommandCenterPage.css";

const LS_MAINT = "command_center_maintenance";
const LS_BROADCAST = "command_center_broadcast_draft";
const LS_MAINT_RESUME = "command_center_resume_at";
const LS_BROADCAST_LOG = "command_center_broadcast_log_v1";
const LS_LIVE_ERRORS = "command_center_live_errors_v1";
const LS_AUDIT_LOG = "command_center_admin_audit_v1";

type BroadcastLogItem = { id: string; message: string; admin: string; createdAt: string };
type LiveError = { id: string; level: "warning" | "error"; message: string; createdAt: string };
type Health = { api: string; mongo: string; mysql: string };
type AuditItem = { id: string; admin: string; action: string; createdAt: string };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, val: T) {
  localStorage.setItem(key, JSON.stringify(val));
}

export function CommandCenterPage() {
  const { user } = useAuth();
  const id = useId();
  const [broadcast, setBroadcast] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const [resumeAt, setResumeAt] = useState("");
  const [live, setLive] = useState(true);
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const [broadcastLog, setBroadcastLog] = useState<BroadcastLogItem[]>([]);
  const [liveErrors, setLiveErrors] = useState<LiveError[]>([]);
  const [health, setHealth] = useState<Health>({ api: "unknown", mongo: "unknown", mysql: "unknown" });
  const [auditLog, setAuditLog] = useState<AuditItem[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dbPingMs, setDbPingMs] = useState<number | null>(null);

  useEffect(() => {
    try {
      setMaintenance(localStorage.getItem(LS_MAINT) === "1");
      const d = localStorage.getItem(LS_BROADCAST);
      if (d) setBroadcast(d);
      setResumeAt(localStorage.getItem(LS_MAINT_RESUME) ?? "");
      setBroadcastLog(readJson<BroadcastLogItem[]>(LS_BROADCAST_LOG, []));
      setLiveErrors(readJson<LiveError[]>(LS_LIVE_ERRORS, []));
      setAuditLog(readJson<AuditItem[]>(LS_AUDIT_LOG, []));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!user?.email) return;
    setAuditLog((cur) => {
      const entry: AuditItem = {
        id: `aud-${Date.now()}`,
        admin: user.email,
        action: "is currently editing fares",
        createdAt: new Date().toISOString(),
      };
      const next = [entry, ...cur].slice(0, 60);
      writeJson(LS_AUDIT_LOG, next);
      return next;
    });
  }, [user?.email]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_MAINT, maintenance ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [maintenance]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_MAINT_RESUME, resumeAt);
    } catch {
      /* ignore */
    }
  }, [resumeAt]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!maintenance || !resumeAt) return;
      const t = new Date(resumeAt).getTime();
      if (!Number.isFinite(t)) return;
      if (Date.now() >= t) {
        setMaintenance(false);
        setResumeAt("");
        setSentFlash("Maintenance mode ended automatically by scheduler.");
        window.setTimeout(() => setSentFlash(null), 2600);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [maintenance, resumeAt]);

  useEffect(() => {
    const syncExternal = () => {
      const geofence = getGeofenceAlerts().slice(0, 20).map((a) => ({
        id: `geo-${a.id}`,
        level: a.severity === "critical" ? ("error" as const) : ("warning" as const),
        message: `Geofence: Bus ${a.busId} off route (${a.assignedRoute}) near ${a.currentTerminal}`,
        createdAt: a.createdAt,
      }));
      const existing = readJson<LiveError[]>(LS_LIVE_ERRORS, []);
      const merged = [...geofence, ...existing].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 80);
      setLiveErrors(merged);
    };
    syncExternal();
    const interval = window.setInterval(syncExternal, 3000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const pullHealth = async () => {
      try {
        const t0 = performance.now();
        const h = await api<{ ok: boolean; mongo: string; mysqlTicketing: string }>("/health");
        setDbPingMs(Math.round(performance.now() - t0));
        setHealth({ api: h.ok ? "online" : "degraded", mongo: h.mongo, mysql: h.mysqlTicketing });
      } catch {
        setHealth({ api: "offline", mongo: "unknown", mysql: "unknown" });
        setDbPingMs(null);
      }
    };
    void pullHealth();
    const id = window.setInterval(() => {
      if (live) void pullHealth();
    }, 8000);
    return () => window.clearInterval(id);
  }, [live]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: TicketRow[] }>("/api/tickets");
        if (!cancelled) setTickets(res.items);
      } catch {
        if (!cancelled) setTickets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      const templates: LiveError[] = [
        { id: `err-${Date.now()}`, level: "warning", message: "Failed Login attempt detected (operator kiosk)", createdAt: new Date().toISOString() },
        { id: `err-${Date.now()}-2`, level: "error", message: "Transient database timeout on tickets query", createdAt: new Date().toISOString() },
      ];
      if (Math.random() > 0.68) {
        setLiveErrors((cur) => {
          const next = [templates[Math.floor(Math.random() * templates.length)]!, ...cur].slice(0, 80);
          writeJson(LS_LIVE_ERRORS, next.filter((x) => !x.id.startsWith("geo-")));
          return next;
        });
      }
    }, 6000);
    return () => window.clearInterval(id);
  }, [live]);

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(LS_BROADCAST, broadcast);
      setSentFlash("Draft saved locally.");
      window.setTimeout(() => setSentFlash(null), 2200);
    } catch {
      setSentFlash("Could not save draft.");
    }
  }, [broadcast]);

  const sendBroadcast = useCallback(() => {
    if (!broadcast.trim()) {
      setSentFlash("Enter a message first.");
      window.setTimeout(() => setSentFlash(null), 2000);
      return;
    }
    const item: BroadcastLogItem = {
      id: `msg-${Date.now()}`,
      message: broadcast.trim(),
      admin: user?.email ?? "admin@local",
      createdAt: new Date().toISOString(),
    };
    setBroadcastLog((cur) => {
      const next = [item, ...cur].slice(0, 80);
      writeJson(LS_BROADCAST_LOG, next);
      return next;
    });
    setAuditLog((cur) => {
      const entry: AuditItem = {
        id: `aud-${Date.now()}`,
        admin: user?.email ?? "admin@local",
        action: "is currently sending broadcast messages",
        createdAt: new Date().toISOString(),
      };
      const next = [entry, ...cur].slice(0, 60);
      writeJson(LS_AUDIT_LOG, next);
      return next;
    });
    setSentFlash("Broadcast queued for connected terminals.");
    window.setTimeout(() => setSentFlash(null), 2800);
  }, [broadcast, user?.email]);

  const resumeCountdown = useMemo(() => {
    if (!maintenance || !resumeAt) return null;
    const diff = new Date(resumeAt).getTime() - Date.now();
    if (!Number.isFinite(diff) || diff <= 0) return "ending soon";
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${m}m remaining`;
  }, [maintenance, resumeAt, sentFlash]);

  const suspiciousPassengers = useMemo(() => {
    const now = new Date();
    const sameDay = (d: Date) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const map = new Map<string, number>();
    tickets.forEach((t) => {
      const dt = new Date(t.createdAt);
      if (!sameDay(dt)) return;
      map.set(t.passengerId, (map.get(t.passengerId) ?? 0) + 1);
    });
    return [...map.entries()].filter(([, count]) => count >= 2).map(([passengerId, count]) => ({ passengerId, count })).slice(0, 10);
  }, [tickets]);

  return (
    <div className="command-center">
      <header className="command-center__head">
        <div>
          <h1 className="command-center__title">Command center</h1>
          <p className="command-center__lead">Operations, health, and system controls</p>
        </div>
        <div className="command-center__head-actions">
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

      <div className="command-center__grid">
        <div className="command-center__stack command-center__stack--main">
          <section className="command-center__card" aria-labelledby={`${id}-bc`}>
            <h2 id={`${id}-bc`} className="command-center__h2">
              Broadcast message
            </h2>
            <p className="command-center__hint">Message to show on operator terminals and public displays (demo — not wired to backend yet).</p>
            <textarea
              className="command-center__textarea"
              rows={5}
              value={broadcast}
              onChange={(e) => setBroadcast(e.target.value)}
              placeholder="e.g. Route 12 delayed 15 minutes due to weather in Valencia…"
              maxLength={2000}
            />
            <div className="command-center__row">
              <span className="command-center__meta">{broadcast.length} / 2000</span>
              <div className="command-center__btn-row">
                <button type="button" className="command-center__btn command-center__btn--ghost" onClick={() => saveDraft()}>
                  Save draft
                </button>
                <button type="button" className="command-center__btn command-center__btn--primary" onClick={sendBroadcast}>
                  Send broadcast
                </button>
              </div>
            </div>
          </section>

          <section className="command-center__card" aria-labelledby={`${id}-intel`}>
            <h2 id={`${id}-intel`} className="command-center__h2">
              System feedback intelligence
            </h2>
            <p className="command-center__hint">Automated signals from tickets, uptime checks, and user reports (sample).</p>
            <ul className="command-center__intel">
              <li>
                <span className="command-center__intel-badge">Load</span>
                Peak boarding window <strong>07:00–09:00</strong> · Malaybalay corridor
              </li>
              <li>
                <span className="command-center__intel-badge">Alert</span>
                No critical incidents in the last 24h (demo data)
              </li>
              <li>
                <span className="command-center__intel-badge">Insight</span>
                Feedback sentiment on route delays: <strong>stable</strong>
              </li>
            </ul>
            <div className="command-center__dup-block">
              <p className="command-center__dup-title">Suspicious activity alert</p>
              {suspiciousPassengers.length === 0 ? (
                <p className="command-center__hint">No duplicate Passenger IDs detected today.</p>
              ) : (
                <ul className="command-center__dup-list">
                  {suspiciousPassengers.map((x) => (
                    <li key={x.passengerId}>
                      <span>{x.passengerId}</span>
                      <strong>{x.count} duplicate issues</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="command-center__card" aria-labelledby={`${id}-bclog`}>
            <h2 id={`${id}-bclog`} className="command-center__h2">
              Broadcast log
            </h2>
            <div className="command-center__log">
              {broadcastLog.length === 0 ? (
                <p className="command-center__hint">No broadcast history yet.</p>
              ) : (
                broadcastLog.map((x) => (
                  <div key={x.id} className="command-center__log-item">
                    <div className="command-center__log-title">{x.message}</div>
                    <div className="command-center__log-meta">
                      {x.admin} · {new Date(x.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="command-center__stack command-center__stack--side">
          <section className="command-center__card" aria-labelledby={`${id}-health`}>
            <h2 id={`${id}-health`} className="command-center__h2">
              Health snapshot
            </h2>
            <ul className="command-center__health">
              <li>
                <span className="command-center__health-label">API</span>
                <span className={"command-center__pill " + (health.api === "online" ? "command-center__pill--ok" : "command-center__pill--bad")}>
                  {health.api}
                </span>
              </li>
              <li>
                <span className="command-center__health-label">MongoDB</span>
                <span className={"command-center__pill " + (health.mongo === "connected" ? "command-center__pill--ok" : "command-center__pill--bad")}>
                  {health.mongo}
                </span>
              </li>
              <li>
                <span className="command-center__health-label">MySQL / ticketing</span>
                <span className={"command-center__pill " + (health.mysql === "connected" ? "command-center__pill--ok" : "command-center__pill--bad")}>
                  {health.mysql}
                </span>
              </li>
              <li>
                <span className="command-center__health-label">Last deploy</span>
                <span className="command-center__health-val">—</span>
              </li>
              <li>
                <span className="command-center__health-label">Database connectivity ping</span>
                <span className="command-center__health-val">{dbPingMs != null ? `${dbPingMs} ms` : "—"}</span>
              </li>
            </ul>
          </section>

          <section className="command-center__card" aria-labelledby={`${id}-maint`}>
            <h2 id={`${id}-maint`} className="command-center__h2">
              Maintenance mode
            </h2>
            <p className="command-center__hint">When on, new passenger flows can be paused (demo — UI only).</p>
            <label className="command-center__toggle">
              <input type="checkbox" checked={maintenance} onChange={(e) => setMaintenance(e.target.checked)} />
              <span className="command-center__toggle-ui" />
              <span className="command-center__toggle-text">{maintenance ? "Maintenance ON" : "Maintenance OFF"}</span>
            </label>
            <div className="command-center__maint-row">
              <label htmlFor={`${id}-resume`} className="command-center__health-label">
                Resume at
              </label>
              <input
                id={`${id}-resume`}
                className="command-center__resume-input"
                type="datetime-local"
                value={resumeAt}
                onChange={(e) => setResumeAt(e.target.value)}
              />
            </div>
            {maintenance && resumeAt ? <p className="command-center__hint">Scheduler: {resumeCountdown}</p> : null}
            {maintenance ? (
              <p className="command-center__warn">Operators may still use the portal; public booking can be gated when wired to API.</p>
            ) : null}
          </section>

          <section className="command-center__card" aria-labelledby={`${id}-errs`}>
            <h2 id={`${id}-errs`} className="command-center__h2">
              Live error log
            </h2>
            <div className="command-center__errors">
              {liveErrors.length === 0 ? (
                <p className="command-center__hint">No live errors yet.</p>
              ) : (
                liveErrors.slice(0, 50).map((e) => (
                  <div key={e.id} className={"command-center__error-item command-center__error-item--" + e.level}>
                    <span>{e.message}</span>
                    <time>{new Date(e.createdAt).toLocaleTimeString()}</time>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="command-center__card" aria-labelledby={`${id}-audit`}>
            <h2 id={`${id}-audit`} className="command-center__h2">
              Admin audit log
            </h2>
            <div className="command-center__log">
              {auditLog.length === 0 ? (
                <p className="command-center__hint">No admin activity yet.</p>
              ) : (
                auditLog.map((a) => (
                  <div key={a.id} className="command-center__log-item">
                    <div className="command-center__log-title">
                      {a.admin} {a.action}
                    </div>
                    <div className="command-center__log-meta">{new Date(a.createdAt).toLocaleString()}</div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
