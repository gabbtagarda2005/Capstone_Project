import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import {
  peakByDayOfMonth,
  peakByHourForDay,
  peakByMonthYear,
  revenueByDayOfMonth,
  revenueByHourDay,
  revenueByMonthYear,
  totalPassengersAllTime,
  totalRevenueAllTime,
} from "@/lib/chartAggregates";
import type { TicketRow } from "@/lib/types";
import dashboardBackground from "@/Design/DashboardBackground.png";
import "./analytics.css";

type Stats = { totalTicketCount: number; filteredCount: number; filteredRevenue: number };

type Tab = "day" | "month" | "year";

const CHART_COLORS = {
  peak: "#22d3ee",
  peak2: "#e879f9",
  rev: "#a855f7",
  rev2: "#fb923c",
};

function demoPeakDay() {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: [12, 8, 5, 4, 6, 18, 45, 62, 55, 40, 35, 42, 38, 44, 50, 58, 72, 85, 68, 45, 32, 22, 15, 10][hour] ?? 10,
  }));
}

function demoPeakMonth() {
  return Array.from({ length: 31 }, (_, i) => ({
    day: i + 1,
    count: 20 + Math.round(25 * Math.sin((i / 31) * Math.PI) + (i % 7) * 3),
  }));
}

function demoPeakYear() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months.map((month, i) => ({
    month,
    count: 400 + i * 80 + (i % 5) * 24,
  }));
}

function demoRevDay() {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: [120, 80, 40, 30, 50, 200, 450, 620, 580, 400, 350, 420][hour] ?? 100 + hour * 8,
  }));
}

function demoRevMonth() {
  return Array.from({ length: 31 }, (_, i) => ({
    day: i + 1,
    revenue: 2000 + (i % 9) * 180 + i * 40,
  }));
}

function demoRevYear() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months.map((month, i) => ({
    month,
    revenue: 120000 + i * 18000 + (i % 4) * 4000,
  }));
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [peakTab, setPeakTab] = useState<Tab>("day");
  const [revTab, setRevTab] = useState<Tab>("day");
  const [revSummaryTab, setRevSummaryTab] = useState<Tab>("year");

  const refresh = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [st, list] = await Promise.all([
        api<Stats>("/api/tickets/stats"),
        api<{ items: TicketRow[] }>("/api/tickets"),
      ]);
      setStats(st);
      setTickets(list.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load analytics");
      setTickets([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refDate = useMemo(() => new Date(), []);
  const year = refDate.getFullYear();

  /** Demo KPI numbers only when the tickets API actually failed (not while loading). */
  const useDemoKpis = loadError != null;

  const totalPaxDisplay = useDemoKpis
    ? 7_541_390
    : stats != null
      ? stats.totalTicketCount
      : totalPassengersAllTime(tickets);
  const totalRevDisplay = useDemoKpis
    ? 12_847_000
    : tickets.length > 0
      ? totalRevenueAllTime(tickets)
      : Number(stats?.filteredRevenue ?? 0);

  const revenueSummary = useMemo(() => {
    if (useDemoKpis) {
      return {
        day: 428_700,
        month: 3_916_000,
        year: 12_847_000,
      };
    }
    const now = refDate;
    const day = tickets
      .filter((t) => {
        const dt = new Date(t.createdAt);
        return (
          dt.getFullYear() === now.getFullYear() &&
          dt.getMonth() === now.getMonth() &&
          dt.getDate() === now.getDate()
        );
      })
      .reduce((s, t) => s + t.fare, 0);
    const month = tickets
      .filter((t) => {
        const dt = new Date(t.createdAt);
        return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
      })
      .reduce((s, t) => s + t.fare, 0);
    const year = tickets
      .filter((t) => new Date(t.createdAt).getFullYear() === now.getFullYear())
      .reduce((s, t) => s + t.fare, 0);
    return { day, month, year };
  }, [useDemoKpis, refDate, tickets]);

  const topLocations = useMemo(() => {
    if (useDemoKpis) {
      return [
        { name: "Malaybalay", count: 4200 },
        { name: "Valencia", count: 2800 },
        { name: "Maramag", count: 1800 },
        { name: "Don Carlos", count: 1200 },
        { name: "Quezon", count: 900 },
      ];
    }
    const map = new Map<string, number>();
    tickets.forEach((t) => {
      const key = t.startLocation || "Unknown";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [useDemoKpis, tickets]);

  const topLocTotal = Math.max(
    1,
    topLocations.reduce((s, x) => s + x.count, 0)
  );

  /** Chart series: placeholder curves when API failed or there are no ticket rows to aggregate */
  const chartSeriesDemo = loadError != null || tickets.length === 0;

  const peakData = useMemo(() => {
    if (chartSeriesDemo) {
      if (peakTab === "day") return demoPeakDay();
      if (peakTab === "month") return demoPeakMonth();
      return demoPeakYear();
    }
    if (peakTab === "day") {
      const rows = peakByHourForDay(tickets, refDate);
      return rows.map((r) => ({ hour: r.hour, count: r.count }));
    }
    if (peakTab === "month") {
      return peakByDayOfMonth(tickets, refDate);
    }
    return peakByMonthYear(tickets, year);
  }, [tickets, peakTab, refDate, year, chartSeriesDemo]);

  const revData = useMemo(() => {
    if (chartSeriesDemo) {
      if (revTab === "day") return demoRevDay();
      if (revTab === "month") return demoRevMonth();
      return demoRevYear();
    }
    if (revTab === "day") {
      return revenueByHourDay(tickets, refDate).map((r) => ({ hour: r.hour, revenue: r.revenue }));
    }
    if (revTab === "month") {
      return revenueByDayOfMonth(tickets, refDate);
    }
    return revenueByMonthYear(tickets, year);
  }, [tickets, revTab, refDate, year, chartSeriesDemo]);

  const peakXKey = peakTab === "day" ? "hour" : peakTab === "month" ? "day" : "month";

  const peakChart =
    peakTab === "month" && !chartSeriesDemo ? (
      <div className="neo-chart-box">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={peakData as { day: number; count: number }[]}>
            <defs>
              <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.peak} stopOpacity={0.5} />
                <stop offset="100%" stopColor={CHART_COLORS.peak} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }}
              labelStyle={{ color: "#e2e8f0" }}
            />
            <Area type="monotone" dataKey="count" stroke={CHART_COLORS.peak} fill="url(#pg)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    ) : (
      <div className="neo-chart-box">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={peakData as Record<string, unknown>[]}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={peakXKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }} />
            <Bar dataKey="count" fill={CHART_COLORS.peak} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );

  const revXKey = revTab === "day" ? "hour" : revTab === "month" ? "day" : "month";

  const revChart = (
    <div className="neo-chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={revData as Record<string, unknown>[]}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={revXKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }}
            formatter={(v) => [`₱${Number(v ?? 0).toLocaleString()}`, "Revenue"]}
          />
          <Line type="monotone" dataKey="revenue" stroke={CHART_COLORS.rev} strokeWidth={2.5} dot={{ r: 3, fill: CHART_COLORS.rev2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  const fmtMoney = (n: number) =>
    `₱${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const TabBtns = ({
    value,
    onChange,
  }: {
    value: Tab;
    onChange: (t: Tab) => void;
  }) => (
    <div className="neo-tabs" role="tablist">
      {(["day", "month", "year"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          className={"neo-tab" + (value === t ? " neo-tab--on" : "")}
          onClick={() => onChange(t)}
        >
          {t === "day" ? "Day" : t === "month" ? "Month" : "Year"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="dash-analytics">
      {!loading && chartSeriesDemo ? (
        <div
          className="neo-error"
          style={{
            background: loadError
              ? "rgba(127, 29, 29, 0.35)"
              : "rgba(30, 58, 138, 0.35)",
            borderColor: loadError ? "rgba(248, 113, 113, 0.45)" : "rgba(96, 165, 250, 0.4)",
            color: loadError ? "#fecaca" : "#bfdbfe",
          }}
        >
          {loadError
            ? `Could not load ticket analytics (${loadError}). Showing demo chart series.`
            : "No ticket rows yet — charts show sample curves until data exists."}
        </div>
      ) : null}

      <div className="dash-analytics__grid">
        <div className="dash-analytics__left-col">
          <div className="dash-analytics__hero">
            <div className="neo-card">
              <div className="neo-card__label">All passengers</div>
              <div className="neo-card__value">{totalPaxDisplay.toLocaleString()}</div>
              <div className="neo-activity-bar" aria-hidden>
                <div className="neo-activity-bar__seg neo-activity-bar__seg--a" />
                <div className="neo-activity-bar__seg neo-activity-bar__seg--b" />
                <div className="neo-activity-bar__seg neo-activity-bar__seg--c" />
              </div>
              <p className="neo-card__hint">Top 5 pickup locations by passenger count</p>
              <div style={{ marginTop: "0.75rem" }}>
                {topLocations.map((loc, i) => (
                  <div key={loc.name} className="neo-list-row">
                    <span style={{ display: "flex", alignItems: "center" }}>
                      <span className="neo-dot" style={{ background: ["#22d3ee", "#fb923c", "#a3e635", "#a855f7", "#38bdf8"][i] }} />
                      {loc.name}
                    </span>
                    <span>{Math.round((loc.count / topLocTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="neo-card">
              <div className="neo-card__label">Total revenue</div>
              <TabBtns value={revSummaryTab} onChange={setRevSummaryTab} />
              <div className="neo-card__value">{fmtMoney(revenueSummary[revSummaryTab])}</div>
              <p className="neo-card__hint">Revenue per {revSummaryTab}</p>
              <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#4ade80", fontWeight: 700 }}>▲ 10% vs last period</div>
            </div>
          </div>

          <div className="neo-card">
            <div className="neo-chart-title">
              <h3>Passenger peak hours</h3>
              <TabBtns value={peakTab} onChange={setPeakTab} />
            </div>
            <p className="neo-card__hint" style={{ marginBottom: "0.5rem" }}>
              {peakTab === "day" ? "By hour" : peakTab === "month" ? "By day" : "By month"}
            </p>
            {peakChart}
          </div>
        </div>

        <button
          type="button"
          className="neo-globe-wrap neo-globe-wrap--clickable"
          onClick={() => navigate("/dashboard/locations?focus=bukidnon")}
          title="Open Bukidnon map"
        >
          <img src={dashboardBackground} alt="Bukidnon live network" className="neo-globe-media" />
          <p className="neo-globe__caption">Bukidnon transport · live network</p>
        </button>

        <div className="neo-side-stack">
          <div className="neo-card neo-stat-sm">
            <div className="neo-stat-sm__icon neo-stat-sm__icon--p">👥</div>
            <div>
              <div className="neo-stat-sm__lbl">Overall passengers</div>
              <div className="neo-stat-sm__val">{totalPaxDisplay.toLocaleString()}</div>
            </div>
          </div>
          <div className="neo-card neo-stat-sm">
            <div className="neo-stat-sm__icon neo-stat-sm__icon--c">✦</div>
            <div>
              <div className="neo-stat-sm__lbl">Total passenger revenue</div>
              <div className="neo-stat-sm__val">{fmtMoney(totalRevDisplay)}</div>
            </div>
          </div>
          <div className="neo-card">
            <div className="neo-card__label">Forecast</div>
            <div className="neo-forecast">
              <div className="neo-forecast__box">
                <span style={{ fontSize: "0.7rem", color: "rgba(148,163,184,0.9)" }}>Monthly</span>
                <strong>{fmtMoney(useDemoKpis ? 890000 : totalRevDisplay / 12)}</strong>
                <span className="neo-trend-up">▲ 8%</span>
              </div>
              <div className="neo-forecast__box">
                <span style={{ fontSize: "0.7rem", color: "rgba(148,163,184,0.9)" }}>Yearly</span>
                <strong>{fmtMoney(useDemoKpis ? 10200000 : totalRevDisplay)}</strong>
                <span className="neo-trend-up">▲ 12%</span>
              </div>
            </div>
          </div>
          <div className="neo-card">
            <div className="neo-chart-title">
              <h3>Revenue</h3>
              <TabBtns value={revTab} onChange={setRevTab} />
            </div>
            <p className="neo-card__hint" style={{ marginBottom: "0.5rem" }}>
              {revTab === "day" ? "Per hour" : revTab === "month" ? "Per day" : "Per month"}
            </p>
            {revChart}
          </div>
        </div>
      </div>
    </div>
  );
}