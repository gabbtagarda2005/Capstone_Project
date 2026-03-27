import { useMemo, useState, type ComponentProps, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportsAnalyticsDto, ReportPickupRow } from "@/lib/types";
import "@/pages/ReportsPage.css";

export type HubTab = "passenger" | "attendants" | "bus" | "route";

type PassengerCongestionPeriod = "hour" | "day" | "month" | "year";

function truncateLabel(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const SLATE_PRIMARY = "#4A6BBE";
const SLATE_SECONDARY = "#1F5885";
const SLATE_AXIS = "#87A8DA";
const HUB_PIE_COLORS = [SLATE_PRIMARY, SLATE_SECONDARY, SLATE_AXIS, SLATE_PRIMARY, SLATE_SECONDARY, SLATE_AXIS];
const hubAxisTick = { fill: SLATE_AXIS, fontSize: 9 };
const hubAxisStroke = SLATE_AXIS;
const hubTooltipStyle = {
  background: "rgba(4, 14, 35, 0.96)",
  border: `1px solid ${SLATE_AXIS}55`,
  borderRadius: 12,
};
const hubBarActive = {
  fill: SLATE_PRIMARY,
  stroke: SLATE_AXIS,
  strokeWidth: 2,
  style: { filter: "drop-shadow(0 0 14px rgba(74, 107, 190, 0.9))" },
};

function hubSvgGlowDefs() {
  return (
    <defs>
      <filter id="reportsHubPointGlow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="3" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function pickupTrendFromShare(sharePct: number, status: string): "up" | "down" | "stable" {
  const s = status.toLowerCase();
  if (s.includes("high") || s.includes("peak") || s.includes("hot")) return "up";
  if (s.includes("low") || s.includes("cold") || s.includes("drop")) return "down";
  if (sharePct >= 26) return "up";
  if (sharePct <= 10) return "down";
  return "stable";
}

function TrendIcon({ kind }: { kind: "up" | "down" | "stable" }) {
  if (kind === "up") {
    return (
      <svg className="reports-hub__trend reports-hub__trend--up" width="12" height="12" viewBox="0 0 24 24" aria-hidden>
        <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M23 6l-9.5 9.5-5-5L1 18" />
        <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M17 6h6v6" />
      </svg>
    );
  }
  if (kind === "down") {
    return (
      <svg className="reports-hub__trend reports-hub__trend--down" width="12" height="12" viewBox="0 0 24 24" aria-hidden>
        <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M23 18l-9.5-9.5-5 5L1 6" />
        <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M17 18h6v-6" />
      </svg>
    );
  }
  return (
    <span className="reports-hub__trend reports-hub__trend--flat" aria-hidden>
      —
    </span>
  );
}

function donutMtdCenterContent(monthlyRev: number) {
  return function MtdCenter(props: { viewBox?: { cx?: number; cy?: number } }) {
    const cx = props.viewBox?.cx ?? 0;
    const cy = props.viewBox?.cy ?? 0;
    return (
      <g>
        <text x={cx} y={cy - 8} textAnchor="middle" fill="#94a3b8" fontSize={9} fontWeight={800} letterSpacing="0.12em">
          TOTAL MTD
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#f8fafc" fontSize={16} fontWeight={900}>
          ₱{monthlyRev.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>
      </g>
    );
  };
}

function HourlyCongestionHeatmap({
  hourlyToday,
  peakStart,
  peakEnd,
}: {
  hourlyToday: ReportsAnalyticsDto["hourlyToday"];
  peakStart: number;
  peakEnd: number;
}) {
  const byHour = useMemo(() => {
    const m = new Map<number, { tickets: number; revenue: number }>();
    hourlyToday.forEach((r) => m.set(r.hour, { tickets: r.tickets, revenue: r.revenue }));
    return m;
  }, [hourlyToday]);
  const maxTickets = useMemo(() => Math.max(1, ...Array.from(byHour.values()).map((v) => v.tickets)), [byHour]);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  return (
    <div className="reports-hub__heatmap-wrap">
      <p className="reports-hub__heatmap-legend">Deeper blue = higher ticket volume · outlined = peak boarding window</p>
      <div className="reports-hub__heatmap" role="img" aria-label="Hourly congestion heatmap">
        {hours.map((h) => {
          const cell = byHour.get(h) ?? { tickets: 0, revenue: 0 };
          const intensity = cell.tickets / maxTickets;
          const inPeak = h >= peakStart && h <= peakEnd;
          const deep = 0.18 + intensity * 0.82;
          const style: CSSProperties = {
            background: `rgba(4, 12, 32, ${deep})`,
            boxShadow: intensity > 0.65 ? `inset 0 0 12px rgba(74, 107, 190, ${0.25 + intensity * 0.45})` : undefined,
          };
          return (
            <button
              key={h}
              type="button"
              className={`reports-hub__heatmap-cell${inPeak ? " reports-hub__heatmap-cell--peak" : ""}`}
              style={style}
              title={`${String(h).padStart(2, "0")}:00 — ${cell.tickets} tickets · ₱${cell.revenue.toFixed(2)}`}
            />
          );
        })}
      </div>
      <div className="reports-hub__heatmap-axis">
        {hours
          .filter((h) => h % 4 === 0)
          .map((h) => (
            <span key={h} className="reports-hub__heatmap-tick">
              {h}:00
            </span>
          ))}
      </div>
    </div>
  );
}

function LedRow({ text }: { text: string }) {
  return (
    <div className="reports-hub__led">
      <span className="reports-hub__led-dot reports-hub__animate-heartbeat" aria-hidden />
      <span className="reports-hub__led-text">{text}</span>
    </div>
  );
}

function PeakPickupBlock({
  title,
  subtitle,
  locations,
}: {
  title: string;
  subtitle: string;
  locations: ReportPickupRow[];
}) {
  return (
    <div className="reports-hub__peak-block">
      <h4 className="reports-hub__peak-block-title">{title}</h4>
      <p className="reports-hub__peak-block-sub">{subtitle}</p>
      {locations.length === 0 ? (
        <p className="reports-hub__empty-table">No pickup data for this cycle.</p>
      ) : (
        <ul className="reports-hub__pickup-rank">
          {locations.slice(0, 5).map((p, i) => {
            const tr = pickupTrendFromShare(p.sharePct, p.status);
            return (
              <li key={`${title}-${p.location}-${i}`} className="reports-hub__pickup-rank-row">
                <div className="reports-hub__pickup-rank-left">
                  <span className="reports-hub__pickup-idx">{String(i + 1).padStart(2, "0")}</span>
                  <div className="reports-hub__pickup-text">
                    <span className="reports-hub__pickup-loc">{truncateLabel(p.location, 28)}</span>
                    <span className="reports-hub__pickup-vol">
                      <span className="reports-hub__pickup-vol-dot reports-hub__animate-heartbeat" aria-hidden />
                      {p.ticketCount.toLocaleString()} tickets
                    </span>
                  </div>
                </div>
                <div className="reports-hub__pickup-rank-right">
                  <span className="reports-hub__pickup-share">{p.sharePct > 0 ? `${p.sharePct}%` : "—"}</span>
                  <TrendIcon kind={tr} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type HubProps = {
  data: ReportsAnalyticsDto;
  hubTab: HubTab;
  onHubTab: (t: HubTab) => void;
  exportProgress: number;
  refundAlert: boolean;
  onOpenExport: () => void;
  /** Disables the export control (e.g. no data loaded yet, or PDF in progress). */
  exportDisabled?: boolean;
  /** When true, label reads "Preparing…" (PDF generation). When false but disabled, still shows "Export data". */
  exportBusy?: boolean;
  sentimentLabel: string;
  predictiveInsight: string;
  peakSubtitle: string;
  monthlyRev: number;
};

export function ReportsIntelligenceHub({
  data,
  hubTab,
  onHubTab,
  exportProgress,
  refundAlert,
  onOpenExport,
  exportDisabled = false,
  exportBusy = false,
  sentimentLabel,
  predictiveInsight,
  peakSubtitle,
  monthlyRev,
}: HubProps) {
  const hourlyRevData = useMemo(
    () => data.hourlyToday.map((row) => ({ ...row, hourLabel: `${String(row.hour).padStart(2, "0")}:00` })),
    [data.hourlyToday]
  );
  const daily = data.dailyLast14 ?? [];
  const monthly = data.monthlyThisYear ?? [];
  const yearly = data.yearlyAll ?? [];
  const peak = data.peakPickups;
  const buses = data.topBusesAll ?? [];
  const routesAll = data.allRoutes?.length ? data.allRoutes : data.topRoutes;
  const routePie = useMemo(() => routesAll.slice(0, 6).map((r) => ({ name: r.route, revenue: r.revenue })), [routesAll]);
  const busPie = useMemo(() => buses.slice(0, 5).map((b) => ({ name: b.busLabel, revenue: b.revenue })), [buses]);
  const attendantsBar = useMemo(
    () => data.operatorsAllTime.map((o) => ({ name: truncateLabel(o.operator, 16), revenue: o.revenue, tickets: o.tickets })),
    [data.operatorsAllTime]
  );
  const ex = data.executive;

  const emptyCongestion = !data.hourlyToday.some((x) => x.tickets > 0);
  const emptyDaily = !daily.some((x) => x.tickets > 0);
  const emptyMonthly = !monthly.some((x) => x.tickets > 0);
  const emptyYearly = yearly.length === 0;

  const [passengerCongestionPeriod, setPassengerCongestionPeriod] = useState<PassengerCongestionPeriod>("hour");
  const [passengerRevenuePeriod, setPassengerRevenuePeriod] = useState<PassengerCongestionPeriod>("hour");
  const [routeRevenuePeriod, setRouteRevenuePeriod] = useState<PassengerCongestionPeriod>("hour");
  const [busTicketPeriod, setBusTicketPeriod] = useState<PassengerCongestionPeriod>("hour");

  const congestionSubtitle = useMemo(() => {
    switch (passengerCongestionPeriod) {
      case "hour":
        return emptyCongestion ? peakSubtitle : "By hour";
      case "day":
        return "Tickets per day (last 14 days)";
      case "month":
        return "Tickets by month (this year)";
      case "year":
        return "Tickets by calendar year";
      default:
        return "";
    }
  }, [passengerCongestionPeriod, peakSubtitle, emptyCongestion]);

  const passengerRevenueSubtitle = useMemo(() => {
    const peakHint = data.insights.peakCorridorHint?.trim();
    const peakLoc =
      peakHint && peakHint.length > 0
        ? ` · Passenger peak location: ${peakHint}`
        : " · Passenger peak locations — connect ticketing";
    switch (passengerRevenuePeriod) {
      case "hour":
        return `Today — fare collected by clock hour${peakLoc}`;
      case "day":
        return "Last 14 days";
      case "month":
        return "This calendar year";
      case "year":
        return "All years on record";
      default:
        return "";
    }
  }, [passengerRevenuePeriod, data.insights.peakCorridorHint]);

  const routeRevenueSubtitle = useMemo(() => {
    switch (routeRevenuePeriod) {
      case "hour":
        return "All routes combined — by clock hour (today)";
      case "day":
        return "Combined fare per calendar day (14 days)";
      case "month":
        return "This calendar year";
      case "year":
        return "All years on record";
      default:
        return "";
    }
  }, [routeRevenuePeriod]);

  const busTicketSubtitle = useMemo(() => {
    switch (busTicketPeriod) {
      case "hour":
        return emptyCongestion ? peakSubtitle : "By hour — all buses (tickets today)";
      case "day":
        return "Tickets per day — all buses (last 14 days)";
      case "month":
        return "Tickets by month — all buses (this year)";
      case "year":
        return "Tickets by calendar year — all buses";
      default:
        return "";
    }
  }, [busTicketPeriod, peakSubtitle, emptyCongestion]);

  function panelHead(title: string, sub: string, live: "feed" | "muted" | "table" = "feed") {
    return (
      <header className="reports-hub__col-head reports-hub__col-head--split">
        <div>
          <h3 className="reports-hub__col-title">{title}</h3>
          <p className="reports-hub__col-sub">{sub}</p>
        </div>
        {live === "table" ? (
          <span className="reports-hub__live-badge reports-hub__live-badge--muted">TABLE</span>
        ) : (
          <span className={`reports-hub__live-badge${live === "muted" ? " reports-hub__live-badge--muted" : ""}`}>
            <span className="reports-hub__live-dot reports-hub__animate-heartbeat" aria-hidden />
            {live === "muted" ? "LIVE" : "LIVE FEED"}
          </span>
        )}
      </header>
    );
  }

  return (
    <div className="reports-hub reports-hub--tab-split">
      <div
        className={`reports-hub__export-progress${exportProgress > 0 ? " reports-hub__export-progress--active" : ""}`}
        role="progressbar"
        aria-valuenow={Math.round(exportProgress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Export progress"
      >
        <div className="reports-hub__export-progress-fill" style={{ width: `${exportProgress}%` }} />
      </div>
      <div className="reports-hub__watermark" aria-hidden />
      <div className="reports-hub__glow" aria-hidden />

      <nav className="reports-hub__nav reports-hub__nav--integrated" aria-label="Intelligence hub reporting">
        <div className="reports-hub__nav-group">
          <button
            type="button"
            className={`reports-hub__nav-btn${hubTab === "passenger" ? " reports-hub__nav-btn--active" : ""}`}
            onClick={() => onHubTab("passenger")}
          >
            Passenger reports
          </button>
          <button
            type="button"
            className={`reports-hub__nav-btn${hubTab === "attendants" ? " reports-hub__nav-btn--active" : ""}`}
            onClick={() => onHubTab("attendants")}
          >
            Bus attendants reports
          </button>
          <button
            type="button"
            className={`reports-hub__nav-btn${hubTab === "bus" ? " reports-hub__nav-btn--active" : ""}`}
            onClick={() => onHubTab("bus")}
          >
            Bus reports
          </button>
          <button
            type="button"
            className={`reports-hub__nav-btn${hubTab === "route" ? " reports-hub__nav-btn--active" : ""}`}
            onClick={() => onHubTab("route")}
          >
            Route report
          </button>
          <button
            type="button"
            className="reports-hub__nav-btn reports-hub__nav-btn--exportish"
            disabled={exportDisabled}
            title={exportDisabled && !exportBusy ? "Load analytics before exporting." : undefined}
            onClick={onOpenExport}
          >
            {exportBusy ? "Preparing…" : "Export data"}
          </button>
        </div>
        {refundAlert ? (
          <span className="reports-hub__export-fraud-dot reports-hub__nav-fraud" title="Refund-flagged tickets present" aria-label="Financial anomaly" />
        ) : null}
      </nav>

      <div className="reports-hub__main-row">
        <div className="reports-hub__charts-stage">
          <div className="reports-hub__charts" key={hubTab}>
            <div
              className={`reports-hub__charts-grid${
                hubTab === "passenger" || hubTab === "bus" || hubTab === "route"
                  ? " reports-hub__charts-grid--dense reports-hub__charts-grid--split-row"
                  : ""
              }`}
            >
              {hubTab === "passenger" ? (
                <>
                  <div className="reports-hub__stack">
                    <header className="reports-hub__col-head reports-hub__col-head--split reports-hub__col-head--congestion">
                      <div className="reports-hub__col-head-main">
                        <h3 className="reports-hub__col-title">Passenger peak hours</h3>
                        <p className="reports-hub__col-sub">{congestionSubtitle}</p>
                      </div>
                      <div className="reports-hub__congestion-tools">
                        <div className="reports-hub__segmented" role="tablist" aria-label="Congestion time scale">
                          {(
                            [
                              ["hour", "Hour"],
                              ["day", "Day"],
                              ["month", "Month"],
                              ["year", "Year"],
                            ] as const
                          ).map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              role="tab"
                              aria-selected={passengerCongestionPeriod === key}
                              className={`reports-hub__segment-btn${passengerCongestionPeriod === key ? " reports-hub__segment-btn--active" : ""}`}
                              onClick={() => setPassengerCongestionPeriod(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className="reports-hub__live-badge">
                          <span className="reports-hub__live-dot reports-hub__animate-heartbeat" aria-hidden />
                          LIVE FEED
                        </span>
                      </div>
                    </header>
                    <div
                      className={`reports-hub__chart-shell${passengerCongestionPeriod === "hour" ? " reports-hub__chart-shell--heatmap" : ""}`}
                    >
                      {passengerCongestionPeriod === "hour" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--heatmap">
                            {emptyCongestion ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <HourlyCongestionHeatmap
                                hourlyToday={data.hourlyToday}
                                peakStart={data.insights.peakBoardingWindow.startHour}
                                peakEnd={data.insights.peakBoardingWindow.endHour}
                              />
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {passengerCongestionPeriod === "day" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyDaily ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={daily} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  {hubSvgGlowDefs()}
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis
                                    dataKey="date"
                                    tickFormatter={(v) => String(v).slice(5)}
                                    stroke={hubAxisStroke}
                                    tick={hubAxisTick}
                                  />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} />
                                  <Bar dataKey="tickets" radius={[6, 6, 0, 0]} activeBar={hubBarActive}>
                                    {daily.map((_, i) => (
                                      <Cell key={i} className="reports-hub__chart-glow" fill={i % 2 ? SLATE_SECONDARY : SLATE_PRIMARY} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {passengerCongestionPeriod === "month" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyMonthly ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="label" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} />
                                  <Bar dataKey="tickets" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {passengerCongestionPeriod === "year" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyYearly ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={yearly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="year" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} />
                                  <Bar dataKey="tickets" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="reports-hub__stack">
                    <header className="reports-hub__col-head reports-hub__col-head--split reports-hub__col-head--congestion">
                      <div className="reports-hub__col-head-main">
                        <h3 className="reports-hub__col-title">Passenger revenue</h3>
                        <p className="reports-hub__col-sub">{passengerRevenueSubtitle}</p>
                      </div>
                      <div className="reports-hub__congestion-tools">
                        <div className="reports-hub__segmented" role="tablist" aria-label="Revenue time scale">
                          {(
                            [
                              ["hour", "Hour"],
                              ["day", "Day"],
                              ["month", "Month"],
                              ["year", "Year"],
                            ] as const
                          ).map(([key, label]) => (
                            <button
                              key={`rev-${key}`}
                              type="button"
                              role="tab"
                              aria-selected={passengerRevenuePeriod === key}
                              className={`reports-hub__segment-btn${passengerRevenuePeriod === key ? " reports-hub__segment-btn--active" : ""}`}
                              onClick={() => setPassengerRevenuePeriod(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className="reports-hub__live-badge reports-hub__live-badge--muted">
                          <span className="reports-hub__live-dot reports-hub__animate-heartbeat" aria-hidden />
                          LIVE
                        </span>
                      </div>
                    </header>
                    <div className="reports-hub__chart-shell">
                      {passengerRevenuePeriod === "hour" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyCongestion ? (
                              <p className="reports-hub__placeholder">No live revenue data detected for this cycle.</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={hourlyRevData} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="hourLabel" stroke={hubAxisStroke} tick={{ ...hubAxisTick, fontSize: 8 }} interval={3} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {passengerRevenuePeriod === "day" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyDaily ? (
                              <p className="reports-hub__placeholder">No live revenue data detected for this cycle.</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={daily} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {passengerRevenuePeriod === "month" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyMonthly ? (
                              <p className="reports-hub__placeholder">No live revenue data detected for this cycle.</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="label" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {passengerRevenuePeriod === "year" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyYearly ? (
                              <p className="reports-hub__placeholder">No live revenue data detected for this cycle.</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={yearly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="year" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · route delay sentiment — ${sentimentLabel}`} />
                        </>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              {hubTab === "attendants" ? (
                <>
                  <div className="reports-hub__col">
                    {panelHead("Bus attendant revenue", "Bar view — every attendant desk by collected fare")}
                    <div className="reports-hub__chart-shell">
                      <div className="reports-hub__chart-canvas reports-hub__chart-canvas--tall">
                        {attendantsBar.length === 0 ? (
                          <p className="reports-hub__placeholder">Awaiting live feed…</p>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={attendantsBar} margin={{ top: 10, right: 8, left: 0, bottom: 40 }}>
                              {hubSvgGlowDefs()}
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                              <XAxis
                                dataKey="name"
                                stroke={hubAxisStroke}
                                tick={{ ...hubAxisTick, fontSize: 8 }}
                                angle={-25}
                                textAnchor="end"
                                height={48}
                              />
                              <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                              <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                              <Bar dataKey="revenue" radius={[6, 6, 0, 0]} activeBar={hubBarActive}>
                                {attendantsBar.map((_, i) => (
                                  <Cell key={i} className="reports-hub__chart-glow" fill={i % 2 ? SLATE_SECONDARY : SLATE_PRIMARY} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                      <LedRow text={`Live sync · attendant throughput — ${sentimentLabel}`} />
                    </div>
                  </div>
                  <div className="reports-hub__col">
                    {panelHead("Attendant leaderboard", "Top 5 — tickets and revenue", "table")}
                    <div className="reports-hub__table-panel">
                      {data.operatorsAllTime.length === 0 ? (
                        <p className="reports-hub__empty-table">No live attendant data detected for this cycle.</p>
                      ) : (
                        <ul className="reports-hub__mini-list">
                          {data.operatorsAllTime.slice(0, 5).map((r) => (
                            <li key={`${r.operatorId}-${r.operator}`} className="reports-hub__mini-row">
                              <span className="reports-hub__mini-name">{truncateLabel(r.operator, 28)}</span>
                              <span className="reports-hub__mini-meta">
                                {r.tickets} tk · <span className="reports-hub__mini-rev">₱{r.revenue.toFixed(2)}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              ) : null}

              {hubTab === "bus" ? (
                <>
                  <div className="reports-hub__stack">
                    <header className="reports-hub__col-head reports-hub__col-head--split reports-hub__col-head--congestion">
                      <div className="reports-hub__col-head-main">
                        <h3 className="reports-hub__col-title">Bus ticket volume</h3>
                        <p className="reports-hub__col-sub">{busTicketSubtitle}</p>
                      </div>
                      <div className="reports-hub__congestion-tools">
                        <div className="reports-hub__segmented" role="tablist" aria-label="Bus ticket time scale">
                          {(
                            [
                              ["hour", "Hour"],
                              ["day", "Day"],
                              ["month", "Month"],
                              ["year", "Year"],
                            ] as const
                          ).map(([key, label]) => (
                            <button
                              key={`bus-${key}`}
                              type="button"
                              role="tab"
                              aria-selected={busTicketPeriod === key}
                              className={`reports-hub__segment-btn${busTicketPeriod === key ? " reports-hub__segment-btn--active" : ""}`}
                              onClick={() => setBusTicketPeriod(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className="reports-hub__live-badge">
                          <span className="reports-hub__live-dot reports-hub__animate-heartbeat" aria-hidden />
                          LIVE FEED
                        </span>
                      </div>
                    </header>
                    <div
                      className={`reports-hub__chart-shell${busTicketPeriod === "hour" ? " reports-hub__chart-shell--heatmap" : ""}`}
                    >
                      {busTicketPeriod === "hour" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--heatmap">
                            {emptyCongestion ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <HourlyCongestionHeatmap
                                hourlyToday={data.hourlyToday}
                                peakStart={data.insights.peakBoardingWindow.startHour}
                                peakEnd={data.insights.peakBoardingWindow.endHour}
                              />
                            )}
                          </div>
                          <LedRow text={`Live sync · fleet demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {busTicketPeriod === "day" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyDaily ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={daily} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  {hubSvgGlowDefs()}
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis
                                    dataKey="date"
                                    tickFormatter={(v) => String(v).slice(5)}
                                    stroke={hubAxisStroke}
                                    tick={hubAxisTick}
                                  />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} />
                                  <Bar dataKey="tickets" radius={[6, 6, 0, 0]} activeBar={hubBarActive}>
                                    {daily.map((_, i) => (
                                      <Cell key={i} className="reports-hub__chart-glow" fill={i % 2 ? SLATE_SECONDARY : SLATE_PRIMARY} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · fleet demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {busTicketPeriod === "month" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyMonthly ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="label" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} />
                                  <Bar dataKey="tickets" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · fleet demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {busTicketPeriod === "year" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyYearly ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={yearly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="year" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} />
                                  <Bar dataKey="tickets" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · fleet demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="reports-hub__col">
                    {panelHead("Top 5 buses", "Share of fare by bus identifier", "muted")}
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--pad reports-hub__chart-shell--donut">
                      <div className="reports-hub__chart-canvas">
                        {busPie.length === 0 ? (
                          <p className="reports-hub__placeholder">No live revenue data detected for this cycle.</p>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              {hubSvgGlowDefs()}
                              <Pie
                                data={busPie}
                                dataKey="revenue"
                                nameKey="name"
                                innerRadius="58%"
                                outerRadius="88%"
                                paddingAngle={2}
                                stroke="rgba(4,14,35,0.5)"
                                strokeWidth={1}
                                labelLine={false}
                              >
                                {busPie.map((_, i) => (
                                  <Cell key={i} className="reports-hub__chart-glow" fill={HUB_PIE_COLORS[i % HUB_PIE_COLORS.length]} />
                                ))}
                                <Label content={donutMtdCenterContent(monthlyRev) as ComponentProps<typeof Label>["content"]} />
                              </Pie>
                              <Tooltip formatter={(v) => `₱${Number(v ?? 0).toFixed(2)}`} contentStyle={hubTooltipStyle} />
                            </PieChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                      {busPie.length > 0 ? (
                        <ul className="reports-hub__donut-legend">
                          {busPie.map((r, i) => (
                            <li key={r.name} className="reports-hub__donut-legend-item">
                              <span className="reports-hub__donut-swatch" style={{ background: HUB_PIE_COLORS[i % HUB_PIE_COLORS.length] }} aria-hidden />
                              <span className="reports-hub__donut-legend-label">{truncateLabel(r.name, 22)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              {hubTab === "route" ? (
                <>
                  <div className="reports-hub__stack">
                    <header className="reports-hub__col-head reports-hub__col-head--split reports-hub__col-head--congestion">
                      <div className="reports-hub__col-head-main">
                        <h3 className="reports-hub__col-title">Route network revenue</h3>
                        <p className="reports-hub__col-sub">{routeRevenueSubtitle}</p>
                      </div>
                      <div className="reports-hub__congestion-tools">
                        <div className="reports-hub__segmented" role="tablist" aria-label="Route revenue time scale">
                          {(
                            [
                              ["hour", "Hour"],
                              ["day", "Day"],
                              ["month", "Month"],
                              ["year", "Year"],
                            ] as const
                          ).map(([key, label]) => (
                            <button
                              key={`rr-${key}`}
                              type="button"
                              role="tab"
                              aria-selected={routeRevenuePeriod === key}
                              className={`reports-hub__segment-btn${routeRevenuePeriod === key ? " reports-hub__segment-btn--active" : ""}`}
                              onClick={() => setRouteRevenuePeriod(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <span className="reports-hub__live-badge">
                          <span className="reports-hub__live-dot reports-hub__animate-heartbeat" aria-hidden />
                          LIVE FEED
                        </span>
                      </div>
                    </header>
                    <div className="reports-hub__chart-shell">
                      {routeRevenuePeriod === "hour" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyCongestion ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={hourlyRevData} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  {hubSvgGlowDefs()}
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="hourLabel" stroke={hubAxisStroke} tick={{ ...hubAxisTick, fontSize: 8 }} interval={3} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · corridor demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {routeRevenuePeriod === "day" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyDaily ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={daily} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  {hubSvgGlowDefs()}
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · corridor demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {routeRevenuePeriod === "month" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyMonthly ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="label" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · corridor demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                      {routeRevenuePeriod === "year" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyYearly ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={yearly} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="year" stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <YAxis stroke={hubAxisStroke} tick={hubAxisTick} />
                                  <Tooltip contentStyle={hubTooltipStyle} formatter={(v) => [`₱${Number(v).toFixed(2)}`, "Revenue"]} />
                                  <Bar dataKey="revenue" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                          <LedRow text={`Live sync · corridor demand — ${sentimentLabel}`} />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="reports-hub__col">
                    {panelHead("Route revenue share", "Top corridors by fare", "muted")}
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--pad reports-hub__chart-shell--donut">
                      <div className="reports-hub__chart-canvas">
                        {routePie.length === 0 ? (
                          <p className="reports-hub__placeholder">No live revenue data detected for this cycle.</p>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              {hubSvgGlowDefs()}
                              <Pie
                                data={routePie}
                                dataKey="revenue"
                                nameKey="name"
                                innerRadius="58%"
                                outerRadius="88%"
                                paddingAngle={2}
                                stroke="rgba(4,14,35,0.5)"
                                strokeWidth={1}
                                labelLine={false}
                              >
                                {routePie.map((_, i) => (
                                  <Cell key={i} className="reports-hub__chart-glow" fill={HUB_PIE_COLORS[i % HUB_PIE_COLORS.length]} />
                                ))}
                                <Label content={donutMtdCenterContent(monthlyRev) as ComponentProps<typeof Label>["content"]} />
                              </Pie>
                              <Tooltip formatter={(v) => `₱${Number(v ?? 0).toFixed(2)}`} contentStyle={hubTooltipStyle} />
                            </PieChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="reports-hub__sidebar-pickups" aria-label="Context panel">
          <div className="reports-hub__pickups reports-hub__pickups--sidebar">
            <div className="reports-hub__pickups-head">
              <h3 className="reports-hub__pickups-title">
                {hubTab === "passenger"
                  ? "Peak passenger starts"
                  : hubTab === "attendants"
                    ? "Fleet revenue snapshot"
                    : hubTab === "bus"
                      ? "Routes — top buses"
                      : "Top 5 routes"}
              </h3>
              <div className="reports-hub__pickups-dots" aria-hidden>
                <span className="reports-hub__animate-heartbeat" />
                <span />
              </div>
            </div>

            {hubTab === "passenger" && peak ? (
              <div className="reports-hub__peak-stack">
                <PeakPickupBlock
                  title={`Busiest hour today (${String(peak.hour.slot).padStart(2, "0")}:00)`}
                  subtitle={`${peak.hour.tickets} tickets · top start locations`}
                  locations={peak.hour.locations as ReportPickupRow[]}
                />
                <PeakPickupBlock
                  title="Busiest day (30d)"
                  subtitle={peak.day.date ? `${peak.day.date} · ${peak.day.tickets} tickets` : "—"}
                  locations={peak.day.locations as ReportPickupRow[]}
                />
                <PeakPickupBlock
                  title="Busiest month (YTD)"
                  subtitle={peak.month.label ? `${peak.month.label} · ${peak.month.tickets} tickets` : "—"}
                  locations={peak.month.locations as ReportPickupRow[]}
                />
                <PeakPickupBlock
                  title="Busiest year"
                  subtitle={peak.year.year ? `${peak.year.year} · ${peak.year.tickets} tickets` : "—"}
                  locations={peak.year.locations as ReportPickupRow[]}
                />
              </div>
            ) : null}
            {hubTab === "passenger" && !peak ? (
              <p className="reports-hub__empty-table">Connect ticketing to see peak passenger start locations by period.</p>
            ) : null}

            {hubTab === "attendants" ? (
              <div className="reports-hub__rev-snapshot">
                <div className="reports-hub__rev-snapshot-row">
                  <span>Revenue / hour (today)</span>
                  <strong>₱{(ex.todayHourlyRevenueTotal ?? 0).toFixed(2)}</strong>
                </div>
                <div className="reports-hub__rev-snapshot-row">
                  <span>Revenue / day (today)</span>
                  <strong>₱{ex.todayRevenue.toFixed(2)}</strong>
                </div>
                <div className="reports-hub__rev-snapshot-row">
                  <span>Revenue / month (MTD)</span>
                  <strong>₱{ex.monthlyRevenue.toFixed(2)}</strong>
                </div>
                <div className="reports-hub__rev-snapshot-row">
                  <span>Revenue / year (YTD)</span>
                  <strong>₱{(ex.ytdRevenue ?? 0).toFixed(2)}</strong>
                </div>
              </div>
            ) : null}

            {hubTab === "bus" ? (
              <ul className="reports-hub__mini-list">
                {(data.routesForTopBuses ?? []).length === 0 ? (
                  <p className="reports-hub__empty-table">No route data for top buses.</p>
                ) : (
                  data.routesForTopBuses!.map((r) => (
                    <li key={r.route} className="reports-hub__mini-row">
                      <span className="reports-hub__mini-name">{truncateLabel(r.route, 30)}</span>
                      <span className="reports-hub__mini-meta">
                        {r.tickets} tk · <span className="reports-hub__mini-rev">₱{r.revenue.toFixed(2)}</span>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}

            {hubTab === "route" ? (
              <ul className="reports-hub__mini-list">
                {data.topRoutes.slice(0, 5).length === 0 ? (
                  <p className="reports-hub__empty-table">No route data for this cycle.</p>
                ) : (
                  data.topRoutes.slice(0, 5).map((r) => (
                    <li key={r.route} className="reports-hub__mini-row">
                      <span className="reports-hub__mini-name">{truncateLabel(r.route, 30)}</span>
                      <span className="reports-hub__mini-meta">
                        {r.tickets} tk · <span className="reports-hub__mini-rev">₱{r.revenue.toFixed(2)}</span>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </aside>
      </div>

      <footer className="reports-hub__predictive reports-hub__predictive--premium">
        <span className="reports-hub__predictive-glow" aria-hidden />
        <div className="reports-hub__predictive-inner">
          <strong className="reports-hub__predictive-k">AI insight</strong>
          <p className="reports-hub__predictive-text">{predictiveInsight}</p>
        </div>
      </footer>
    </div>
  );
}
