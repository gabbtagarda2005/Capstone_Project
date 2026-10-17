import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
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
import { useAuth } from "@/context/AuthContext";
import { ADMIN_API_ORIGIN, fetchReportsAnalytics } from "@/lib/api";
import { shortPickupLocationLabel } from "@/lib/humanizeAdminAudit";
import type { ReportForecast, ReportsAnalyticsDto, ReportTrend } from "@/lib/types";
import dashboardBackground from "@/Design/DashboardBackground.png";
import dashboardBackgroundLight from "@/Design/DashboardBackgroundLight.jpg";
import "./analytics.css";

type Tab = "day" | "month" | "year";

const CHART_COLORS = {
  peak: "#22d3ee",
  peak2: "#e879f9",
  rev: "#a855f7",
  rev2: "#fb923c",
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { token: adminToken } = useAuth();
  const [data, setData] = useState<ReportsAnalyticsDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [peakTab, setPeakTab] = useState<Tab>("day");
  const [revTab, setRevTab] = useState<Tab>("day");
  const [revSummaryTab, setRevSummaryTab] = useState<Tab>("year");

  const refresh = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const dto = await fetchReportsAnalytics();
      setData(dto);
    } catch (e) {
      // Deliberately does NOT fall back to fabricated numbers on failure — an honest error
      // state is better than a dashboard that silently shows fake, impressive-looking figures.
      setLoadError(e instanceof Error ? e.message : "Failed to load analytics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live refresh: the backend emits "dashboardAnalyticsStale" right after any ticket is issued
  // (routes/ticketsTicketing.js), so this page updates on its own instead of needing a reload.
  useEffect(() => {
    if (!adminToken) return undefined;
    const socket = io(ADMIN_API_ORIGIN.replace(/\/$/, ""), {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 12,
      reconnectionDelay: 2000,
      auth: { token: adminToken },
    });
    let debounceId: number | null = null;
    const onStale = () => {
      if (debounceId != null) window.clearTimeout(debounceId);
      debounceId = window.setTimeout(() => {
        void refresh();
      }, 2000);
    };
    socket.on("dashboardAnalyticsStale", onStale);
    return () => {
      if (debounceId != null) window.clearTimeout(debounceId);
      socket.disconnect();
    };
  }, [adminToken, refresh]);

  const totalPaxDisplay = data?.executive.totalTickets ?? 0;
  const totalRevDisplay = data?.executive.totalRevenue ?? 0;
  const topLocations = data?.topPickupLocations ?? [];

  const peakData = useMemo(() => {
    if (!data?.peakPassengers) return [];
    return data.peakPassengers[peakTab];
  }, [data, peakTab]);

  const revData = useMemo(() => {
    if (!data?.revenueSeries) return [];
    return data.revenueSeries[revTab];
  }, [data, revTab]);

  const peakXKey = peakTab === "day" ? "hour" : peakTab === "month" ? "day" : "month";
  const revXKey = revTab === "day" ? "hour" : revTab === "month" ? "day" : "month";

  const peakChart =
    peakTab === "month" ? (
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

  const TabBtns = ({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) => (
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

  /** Renders a real current-vs-previous-period change, honestly handling the "no prior period
   *  data" and "flat" cases instead of always showing a hardcoded up arrow. */
  const TrendLine = ({ trend }: { trend?: ReportTrend }) => {
    if (!trend) return null;
    if (trend.direction === "no_prior_data") {
      return (
        <div style={{ marginTop: "1rem", fontSize: "0.82rem", color: "#94a3b8" }}>No prior-period data yet</div>
      );
    }
    if (trend.direction === "flat") {
      return (
        <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#94a3b8", fontWeight: 700 }}>
          No change vs last period
        </div>
      );
    }
    const up = trend.direction === "up";
    return (
      <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: up ? "#4ade80" : "#f87171", fontWeight: 700 }}>
        {up ? "▲" : "▼"} {Math.abs(trend.pctChangePct ?? 0)}% vs last period
      </div>
    );
  };

  /** Shows the real forecast estimate and its method, or an honest "insufficient data" message —
   *  never a number invented to fill the box. */
  const ForecastBox = ({ label, forecast }: { label: string; forecast?: ReportForecast }) => (
    <div className="neo-forecast__box">
      <span style={{ fontSize: "0.7rem", color: "rgba(148,163,184,0.9)" }}>{label}</span>
      {forecast?.available ? (
        <>
          <strong title={forecast.method}>{fmtMoney(forecast.estimatedRevenue)}</strong>
          <span style={{ fontSize: "0.62rem", color: "rgba(148,163,184,0.8)" }}>Estimate</span>
        </>
      ) : (
        <span style={{ fontSize: "0.7rem", color: "rgba(148,163,184,0.85)", lineHeight: 1.3 }}>
          {forecast?.reason ?? "Insufficient historical data for a reliable forecast"}
        </span>
      )}
    </div>
  );

  return (
    <div className="dash-analytics">
      {loadError ? (
        <div
          className="neo-error"
          style={{
            background: "rgba(127, 29, 29, 0.35)",
            borderColor: "rgba(248, 113, 113, 0.45)",
            color: "#fecaca",
          }}
        >
          Unable to load dashboard analytics ({loadError}). Try refreshing the page.
        </div>
      ) : !loading && data && data.executive.totalTickets === 0 ? (
        <div
          className="neo-error"
          style={{
            background: "rgba(30, 58, 138, 0.35)",
            borderColor: "rgba(96, 165, 250, 0.4)",
            color: "#bfdbfe",
          }}
        >
          No ticket activity recorded yet — figures below will populate as tickets are issued.
        </div>
      ) : null}

      {!data ? (
        loading ? <p className="neo-card__hint">Loading analytics…</p> : null
      ) : (
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
                    <div key={loc.location} className="neo-list-row">
                      <span style={{ display: "flex", alignItems: "center" }} title={loc.location}>
                        <span
                          className="neo-dot"
                          style={{ background: ["#22d3ee", "#fb923c", "#a3e635", "#a855f7", "#38bdf8"][i] }}
                        />
                        {shortPickupLocationLabel(loc.location)}
                      </span>
                      <span>{loc.sharePct}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="neo-card">
                <div className="neo-card__label">Total revenue</div>
                <TabBtns value={revSummaryTab} onChange={setRevSummaryTab} />
                <div className="neo-card__value">{fmtMoney(data.revenueTrend?.[revSummaryTab]?.current ?? 0)}</div>
                <p className="neo-card__hint">Revenue per {revSummaryTab}</p>
                <TrendLine trend={data.revenueTrend?.[revSummaryTab]} />
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
            <img src={dashboardBackground} alt="Bukidnon live network" className="neo-globe-media neo-globe-media--dark" />
            <img src={dashboardBackgroundLight} alt="Bukidnon live network" className="neo-globe-media neo-globe-media--light" />
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
                <ForecastBox label="Monthly" forecast={data.forecast?.monthly} />
                <ForecastBox label="Yearly" forecast={data.forecast?.yearly} />
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
      )}
    </div>
  );
}
