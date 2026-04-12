import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { LoginLogRow, OperatorSummary, TicketRow } from "@/lib/types";
import "./DashboardPage.css";

export function OperatorViewPage() {
  const { operatorId } = useParams();
  const id = Number(operatorId);
  const [op, setOp] = useState<OperatorSummary | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [logs, setLogs] = useState<LoginLogRow[]>([]);
  const [stats, setStats] = useState<{ ticketCount: number; totalRevenue: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    let cancelled = false;
    (async () => {
      try {
        const [profile, tix, lg, st] = await Promise.all([
          api<OperatorSummary>(`/api/operators/${id}`),
          api<{ items: TicketRow[] }>(`/api/operators/${id}/tickets`),
          api<{ items: LoginLogRow[] }>(`/api/operators/${id}/login-logs`),
          api<{ ticketCount: number; totalRevenue: number }>(`/api/operators/${id}/ticket-stats`),
        ]);
        if (!cancelled) {
          setOp(profile);
          setTickets(tix.items);
          setLogs(lg.items);
          setStats(st);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!Number.isFinite(id)) {
    return (
      <div className="dash-glass" style={{ minHeight: "100vh", padding: "2rem" }}>
        <p>Invalid operator.</p>
        <Link to="/dashboard" className="dg-link-btn" style={{ display: "inline-block", marginTop: "0.75rem" }}>
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dash-glass" style={{ minHeight: "100vh" }}>
        <div className="dash-glass__inner">
          <p className="dash-error-banner">{error}</p>
          <Link to="/dashboard">← Dashboard</Link>
        </div>
      </div>
    );
  }

  if (!op) {
    return (
      <div className="dash-glass" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.7)" }}>Loading…</p>
      </div>
    );
  }

  const name = [op.firstName, op.middleName, op.lastName].filter(Boolean).join(" ");

  return (
    <div className="dash-glass">
      <div className="dash-glass__blobs" aria-hidden>
        <div className="dash-glass__blob dash-glass__blob--1" />
        <div className="dash-glass__blob dash-glass__blob--2" />
      </div>
      <div className="dash-glass__inner" style={{ maxWidth: 720 }}>
        <p style={{ marginTop: 0 }}>
          <Link to="/dashboard" style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
            ← Dashboard
          </Link>
        </p>
        <h1 className="dash-topbar__title" style={{ marginBottom: "0.35rem" }}>
          {name}
        </h1>
        <p className="dash-topbar__sub" style={{ marginBottom: "1.25rem" }}>
          {op.email} · ID {op.operatorId} · {op.role}
        </p>

        {stats && (
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
            <article className="dg-stat" style={{ flex: "1 1 200px" }}>
              <div className="dg-stat__label">Tickets issued</div>
              <div className="dg-stat__value">{stats.ticketCount}</div>
            </article>
            <article className="dg-stat" style={{ flex: "1 1 200px" }}>
              <div className="dg-stat__label">Total ₱ collected</div>
              <div className="dg-stat__value">₱{stats.totalRevenue.toFixed(2)}</div>
            </article>
          </div>
        )}

        <h2 className="dash-h2">Tickets issued</h2>
        <ul style={{ paddingLeft: "1.25rem", margin: "0.35rem 0 1.35rem", color: "rgba(255,255,255,0.82)", lineHeight: 1.55 }}>
          {tickets.length === 0 ? (
            <li style={{ color: "rgba(255,255,255,0.55)" }}>No tickets.</li>
          ) : (
            tickets.map((t) => (
              <li key={String(t.id)} style={{ marginBottom: "0.45rem" }}>
                <strong>{t.passengerId}</strong> — {t.startLocation} → {t.destination} · ₱{t.fare.toFixed(2)}
                {t.busOperatorName ? <> · {t.busOperatorName}</> : null} · {new Date(t.createdAt).toLocaleString()}
              </li>
            ))
          )}
        </ul>

        <h2 className="dash-h2">Login history</h2>
        <ul style={{ paddingLeft: "1.25rem", margin: "0.35rem 0 0", color: "rgba(255,255,255,0.82)", lineHeight: 1.55 }}>
          {logs.length === 0 ? (
            <li style={{ color: "rgba(255,255,255,0.55)" }}>No logins recorded.</li>
          ) : (
            logs.map((l) => (
              <li key={l.logId} style={{ marginBottom: "0.35rem" }}>
                {new Date(l.loginTimestamp).toLocaleString()}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
