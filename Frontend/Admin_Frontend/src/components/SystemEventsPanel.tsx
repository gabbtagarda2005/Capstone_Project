import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import "@/pages/CommandCenterPage.css";
import "./SystemEventsPanel.css";

type SystemEvent = {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "critical";
  service: string;
  message: string;
};

type LevelFilter = "all" | "critical" | "error" | "warn" | "info";

const FILTERS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "info", label: "Info" },
];

function levelBadge(level: SystemEvent["level"]): string {
  if (level === "critical") return "🔴 CRITICAL";
  if (level === "error") return "🔴 ERROR";
  if (level === "warn") return "🟠 WARN";
  return "🔵 INFO";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour12: false });
}

/** Real backend-sourced event log — Mongo connection changes, uncaught route errors, and
 * health-check state transitions. Empty means nothing bad has actually happened, not a fake zero. */
export function SystemEventsPanel() {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    const load = async () => {
      try {
        const q = filter === "all" ? "" : `?level=${filter}`;
        const r = await api<{ items: SystemEvent[] }>(`/api/admin/system-events${q}`);
        if (!cancelled) {
          setEvents(r.items ?? []);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load system events.");
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [filter, paused]);

  return (
    <section className="command-center__card command-center__card--glass" aria-label="Recent system events">
      <div className="sys-events__head">
        <h2 className="command-center__h2">Recent errors &amp; events</h2>
        <button type="button" className="sys-events__pause" onClick={() => setPaused((p) => !p)}>
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <div className="sys-events__filters" role="tablist" aria-label="Filter by severity">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            className={"sys-events__filter" + (filter === f.value ? " sys-events__filter--active" : "")}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {err ? <p className="sys-events__empty">{err}</p> : null}
      {!err && events.length === 0 ? (
        <p className="sys-events__empty">No {filter === "all" ? "" : `${filter} `}events recorded since the server started.</p>
      ) : (
        <ul className="sys-events__list">
          {events.map((e) => (
            <li key={e.id} className={"sys-events__row sys-events__row--" + e.level}>
              <span className="sys-events__time">{fmtTime(e.timestamp)}</span>
              <span className="sys-events__badge">{levelBadge(e.level)}</span>
              <span className="sys-events__service">{e.service}</span>
              <span className="sys-events__msg">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
