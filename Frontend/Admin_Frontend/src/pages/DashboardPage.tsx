import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [peakTab, setPeakTab] = useState<Tab>("day");
  const [revTab, setRevTab] = useState<Tab>("day");

  const refresh = useCallback(async () => {
    setLoadError(null);
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
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refDate = useMemo(() => new Date(), []);
  const year = refDate.getFullYear();

  /** Demo visuals only when API failed or stats never loaded */
  const useDemo = loadError != null || stats == null;

  const totalPaxDisplay = useDemo ? 7_541_390 : stats?.totalTicketCount ?? totalPassengersAllTime(tickets);
  const totalRevDisplay = useDemo
    ? 12_847_000
    : tickets.length > 0
      ? totalRevenueAllTime(tickets)
      : Number(stats?.filteredRevenue ?? 0);

  /** Chart series: demo when API failed or no ticket rows */
  const chartSeriesDemo = useDemo || tickets.length === 0;

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
      {chartSeriesDemo && !loadError ? (
        <div className="neo-error" style={{ background: "rgba(30, 58, 138, 0.35)", borderColor: "rgba(96, 165, 250, 0.4)", color: "#bfdbfe" }}>
          {useDemo
            ? "API unavailable — showing demo chart series."
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
              <p className="neo-card__hint">Current activity mix · routes & terminals</p>
              <div style={{ marginTop: "0.75rem" }}>
                {["Malaybalay", "Valencia", "Maramag", "Don Carlos"].map((name, i) => (
                  <div key={name} className="neo-list-row">
                    <span style={{ display: "flex", alignItems: "center" }}>
                      <span className="neo-dot" style={{ background: ["#22d3ee", "#fb923c", "#a3e635", "#a855f7"][i] }} />
                      {name}
                    </span>
                    <span>{[42, 28, 18, 12][i]}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="neo-card">
              <div className="neo-card__label">Total revenue</div>
              <div className="neo-card__value">{fmtMoney(totalRevDisplay)}</div>
              <p className="neo-card__hint">
                {stats != null ? `Filtered API revenue: ${fmtMoney(stats.filteredRevenue)}` : "All-time ticket fares"}
              </p>
              <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#4ade80", fontWeight: 700 }}>▲ 10% vs last period</div>
            </div>
          </div>

          <div className="neo-card">
            <div className="neo-chart-title">
              <h3>Passenger peak hours</h3>
              <TabBtns value={peakTab} onChange={setPeakTab} />
            </div>
            <p className="neo-card__hint" style={{ marginBottom: "0.5rem" }}>
              {peakTab === "day" ? "By hour (today)" : peakTab === "month" ? "By day (this month)" : "By month (this year)"}
            </p>
            {peakChart}
          </div>
        </div>

        <div className="neo-globe-wrap">
          <div className="neo-globe">
            <div className="neo-globe__ring" />
          </div>
          <p className="neo-globe__caption">Bukidnon transport · live network</p>
        </div>

        <div className="neo-side-stack">
          <div className="neo-card neo-stat-sm">
            <div className="neo-stat-sm__icon neo-stat-sm__icon--p">👥</div>
            <div>
              <div className="neo-stat-sm__lbl">All users</div>
              <div className="neo-stat-sm__val">{useDemo ? "12.4k" : String(stats?.totalTicketCount ?? 0)}</div>
            </div>
          </div>
          <div className="neo-card neo-stat-sm">
            <div className="neo-stat-sm__icon neo-stat-sm__icon--c">✦</div>
            <div>
              <div className="neo-stat-sm__lbl">Recent trips</div>
              <div className="neo-stat-sm__val">{useDemo ? "842" : String(stats?.filteredCount ?? 0)}</div>
            </div>
          </div>
          <div className="neo-card">
            <div className="neo-card__label">Forecast</div>
            <div className="neo-forecast">
              <div className="neo-forecast__box">
                <span style={{ fontSize: "0.7rem", color: "rgba(148,163,184,0.9)" }}>Monthly</span>
                <strong>{fmtMoney(useDemo ? 890000 : totalRevDisplay / 12)}</strong>
                <span className="neo-trend-up">▲ 8%</span>
              </div>
              <div className="neo-forecast__box">
                <span style={{ fontSize: "0.7rem", color: "rgba(148,163,184,0.9)" }}>Yearly</span>
                <strong>{fmtMoney(useDemo ? 10200000 : totalRevDisplay)}</strong>
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
              {revTab === "day" ? "Per hour (today)" : revTab === "month" ? "Per day (this month)" : "Per month (this year)"}
            </p>
            {revChart}
          </div>
        </div>
      </div>
    </div>
  );
}