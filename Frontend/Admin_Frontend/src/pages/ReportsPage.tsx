import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import "./ReportsPage.css";

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function ReportsPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: TicketRow[] }>("/api/tickets");
        if (!cancelled) setTickets(res.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load reports");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = useMemo(() => new Date(), []);

  const hourly = useMemo(() => {
    const base = Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: 0, revenue: 0 }));
    tickets.forEach((t) => {
      const dt = new Date(t.createdAt);
      if (!sameDay(dt, today)) return;
      const row = base[dt.getHours()];
      if (!row) return;
      row.tickets += 1;
      row.revenue += t.fare;
    });
    return base;
  }, [tickets, today]);

  const routeRevenue = useMemo(() => {
    const map = new Map<string, number>();
    tickets.forEach((t) => {
      const route = `${t.startLocation} → ${t.destination}`;
      map.set(route, (map.get(route) ?? 0) + t.fare);
    });
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([route, revenue]) => ({ route, revenue }));
  }, [tickets]);

  const operatorLeaderboard = useMemo(() => {
    const map = new Map<string, { operator: string; tickets: number; revenue: number }>();
    tickets.forEach((t) => {
      const key = t.busOperatorName || `Operator ${t.issuedByOperatorId}`;
      const cur = map.get(key) ?? { operator: key, tickets: 0, revenue: 0 };
      cur.tickets += 1;
      cur.revenue += t.fare;
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [tickets]);

  const projection = useMemo(() => {
    const byDay = new Map<string, number>();
    tickets.forEach((t) => {
      const d = new Date(t.createdAt);
      const k = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      byDay.set(k, (byDay.get(k) ?? 0) + t.fare);
    });
    const values = [...byDay.values()].slice(0, 7);
    if (values.length === 0) return 0;
    return values.reduce((s, n) => s + n, 0) / values.length;
  }, [tickets]);

  const totalRevenue = tickets.reduce((s, t) => s + t.fare, 0);
  const monthlyGoal = 100000;
  const goalPct = Math.max(0, Math.min(100, (totalRevenue / monthlyGoal) * 100));

  const cashOut = useMemo(() => {
    const today = new Date();
    const same = (d: Date) => d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    const map = new Map<string, { operator: string; tickets: number; total: number }>();
    tickets.forEach((t) => {
      const dt = new Date(t.createdAt);
      if (!same(dt)) return;
      const operator = t.busOperatorName || `Operator ${t.issuedByOperatorId}`;
      const cur = map.get(operator) ?? { operator, tickets: 0, total: 0 };
      cur.tickets += 1;
      cur.total += t.fare;
      map.set(operator, cur);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [tickets]);

  const refundTracker = useMemo(() => {
    return tickets
      .filter((t) => t.passengerId.toUpperCase().includes("REFUND"))
      .slice(0, 20)
      .map((t) => ({
        id: t.id,
        passengerId: t.passengerId,
        route: `${t.startLocation} → ${t.destination}`,
        amount: t.fare,
        at: new Date(t.createdAt).toLocaleString(),
      }));
  }, [tickets]);

  return (
    <div className="reports-page admin-mgmt">
      <header className="reports-page__head">
        <h1 className="reports-page__title">Reports</h1>
        <p className="reports-page__lead">Leaderboard, daily trends, and revenue projection.</p>
      </header>

      {error ? <p className="dash-error-banner">{error}</p> : null}

      <div className="reports-page__summary">
        <article className="reports-page__stat">
          <div>Total revenue</div>
          <strong>₱{totalRevenue.toFixed(2)}</strong>
        </article>
        <article className="reports-page__stat">
          <div>Total tickets</div>
          <strong>{tickets.length}</strong>
        </article>
        <article className="reports-page__stat">
          <div>Tomorrow projection</div>
          <strong>₱{projection.toFixed(2)}</strong>
        </article>
      </div>

      <div className="reports-page__grid">
        <section className="reports-page__card">
          <h2>Daily trends (hourly)</h2>
          <div className="reports-page__chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hourly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip formatter={(v, n) => [n === "revenue" ? `₱${Number(v ?? 0).toFixed(2)}` : Number(v ?? 0), n]} />
                <Line type="monotone" dataKey="tickets" stroke="#22d3ee" strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="reports-page__card">
          <h2>Revenue by route</h2>
          <div className="reports-page__chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={routeRevenue}
                  dataKey="revenue"
                  nameKey="route"
                  innerRadius={45}
                  outerRadius={85}
                  fill="#a855f7"
                  label
                />
                <Tooltip formatter={(v) => `₱${Number(v ?? 0).toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="reports-page__card">
        <h2>Top performing operators</h2>
        <div className="reports-page__table-wrap">
          <table className="reports-page__table">
            <thead>
              <tr>
                <th>Operator</th>
                <th>Tickets</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {operatorLeaderboard.length === 0 ? (
                <tr>
                  <td colSpan={3} className="reports-page__muted">
                    No ticket data yet.
                  </td>
                </tr>
              ) : (
                operatorLeaderboard.map((r) => (
                  <tr key={r.operator}>
                    <td>{r.operator}</td>
                    <td>{r.tickets}</td>
                    <td>₱{r.revenue.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="reports-page__card">
        <h2>Operator cash-out report (today)</h2>
        <div className="reports-page__table-wrap">
          <table className="reports-page__table">
            <thead>
              <tr>
                <th>Operator</th>
                <th>Tickets</th>
                <th>Calculated Total</th>
              </tr>
            </thead>
            <tbody>
              {cashOut.length === 0 ? (
                <tr>
                  <td colSpan={3} className="reports-page__muted">
                    No tickets issued today.
                  </td>
                </tr>
              ) : (
                cashOut.map((r) => (
                  <tr key={r.operator}>
                    <td>{r.operator}</td>
                    <td>{r.tickets}</td>
                    <td>₱{r.total.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="reports-page__card">
        <h2>Monthly profit goal</h2>
        <div className="reports-page__goal-bar">
          <div className="reports-page__goal-fill" style={{ width: `${goalPct}%` }} />
        </div>
        <p className="reports-page__goal-meta">
          ₱{totalRevenue.toFixed(2)} of ₱{monthlyGoal.toFixed(2)} target · {goalPct.toFixed(1)}%
        </p>
      </section>

      <section className="reports-page__card">
        <h2>Refund tracker</h2>
        <div className="reports-page__table-wrap">
          <table className="reports-page__table">
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Passenger ID</th>
                <th>Route</th>
                <th>Amount</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {refundTracker.length === 0 ? (
                <tr>
                  <td colSpan={5} className="reports-page__muted">
                    No refund/cancelled tickets detected (IDs containing REFUND).
                  </td>
                </tr>
              ) : (
                refundTracker.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.passengerId}</td>
                    <td>{r.route}</td>
                    <td>₱{r.amount.toFixed(2)}</td>
                    <td>{r.at}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
