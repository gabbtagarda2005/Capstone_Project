import { useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Line,
  Pie,
  PieChart,
  ReferenceArea,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportsAnalyticsDto, ReportPickupRow } from "@/lib/types";
import { REPORT_EXPORT_BUNDLES, type ReportExportBundleId } from "@/lib/reportExportBundles";
import "@/pages/ReportsPage.css";

export type HubTab = "passenger" | "attendants" | "bus" | "route" | "export";

type PassengerCongestionPeriod = "hour" | "day" | "month" | "year";

function truncateLabel(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const SLATE_PRIMARY = "#4A6BBE";
const SLATE_SECONDARY = "#1F5885";
const SLATE_AXIS = "#87A8DA";
const PASSENGER_ORANGE = "#F97316";
const PASSENGER_ORANGE_2 = "#FB923C";
const FLEET_GREEN = "#10B981";
const FLEET_GREEN_2 = "#34D399";

const PIE_COLORS_FLEET = [FLEET_GREEN, FLEET_GREEN_2, SLATE_AXIS, FLEET_GREEN, FLEET_GREEN_2, SLATE_AXIS];
const hubAxisTick = { fill: SLATE_AXIS, fontSize: 9 };
const hubAxisStroke = SLATE_AXIS;
const hubTooltipStyle = {
  background: "rgba(4, 14, 35, 0.92)",
  border: `1px solid rgba(74, 107, 190, 0.35)`,
  borderRadius: 12,
  backdropFilter: "blur(12px) saturate(1.2)",
  WebkitBackdropFilter: "blur(12px) saturate(1.2)",
  boxShadow: "0 16px 44px rgba(0, 0, 0, 0.35)",
};
const hubBarActive = {
  fill: SLATE_PRIMARY,
  stroke: SLATE_AXIS,
  strokeWidth: 2,
  style: { filter: "drop-shadow(0 0 14px rgba(74, 107, 190, 0.9))" },
};

function LeadingEdgeBarShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, fill = SLATE_PRIMARY } = props;
  if (width <= 0 || height <= 0) return null;

  const triH = Math.max(6, Math.min(14, height * 0.16));
  const rectH = Math.max(0, height - triH);
  const r = Math.max(2, Math.min(8, width * 0.18));
  const xMid = x + width / 2;

  return (
    <g style={{ filter: "drop-shadow(0 0 8px #00F2FF)" }}>
      <rect x={x} y={y + triH} width={width} height={rectH} rx={r} fill={fill} />
      <path
        d={`M ${xMid - width * 0.18} ${y + triH} L ${xMid + width * 0.18} ${y + triH} L ${xMid} ${y} Z`}
        fill="rgba(0,242,255,0.92)"
      />
    </g>
  );
}

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

/** Bar + line chart for 24h ticket volume; peak boarding window as shaded band + brighter bars. */
function HourlyTicketsVolumeChart({
  hourlyToday,
  peakStart,
  peakEnd,
  barColor,
  barColorPeak,
  lineColor,
  legend,
}: {
  hourlyToday: ReportsAnalyticsDto["hourlyToday"];
  peakStart: number;
  peakEnd: number;
  barColor: string;
  barColorPeak: string;
  lineColor: string;
  legend: string;
}) {
  const data = useMemo(
    () =>
      hourlyToday.map((row) => ({
        ...row,
        hourLabel: `${String(row.hour).padStart(2, "0")}:00`,
        inPeak: row.hour >= peakStart && row.hour <= peakEnd,
      })),
    [hourlyToday, peakStart, peakEnd]
  );

  const peakX1 = `${String(Math.min(peakStart, peakEnd)).padStart(2, "0")}:00`;
  const peakX2 = `${String(Math.max(peakStart, peakEnd)).padStart(2, "0")}:00`;

  return (
    <div className="reports-hub__hourly-volume-chart">
      <p className="reports-hub__hourly-volume-legend">{legend}</p>
      <div className="reports-hub__hourly-volume-canvas" role="img" aria-label="Tickets by hour bar and line chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="hourLabel" stroke={hubAxisStroke} tick={{ ...hubAxisTick, fontSize: 8 }} interval={3} />
            <YAxis stroke={hubAxisStroke} tick={hubAxisTick} allowDecimals={false} />
            <Tooltip
              contentStyle={hubTooltipStyle}
              formatter={(v) => [`${v ?? 0} tickets`, "Volume"]}
              labelFormatter={(l) => `Hour ${l}`}
            />
            <ReferenceArea
              x1={peakX1}
              x2={peakX2}
              fill="rgba(255, 255, 255, 0.06)"
              stroke="rgba(135, 168, 218, 0.35)"
              strokeDasharray="4 4"
            />
            <Bar dataKey="tickets" maxBarSize={22} radius={[5, 5, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.inPeak ? barColorPeak : barColor} className={entry.inPeak ? "reports-hub__chart-glow" : undefined} />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="tickets"
              stroke={lineColor}
              strokeWidth={2}
              dot={{ r: 2.5, fill: lineColor, strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: lineColor, fill: "#fff" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
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
        <p className="reports-hub__peak-empty">No pickup data for this cycle.</p>
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

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type HubProps = {
  data: ReportsAnalyticsDto;
  hubTab: HubTab;
  onHubTab: (t: HubTab) => void;
  /** Return to the last chart tab when closing the export panel. */
  onCancelExport: () => void;
  exportProgress: number;
  refundAlert: boolean;
  /**
   * Server-side master export (MySQL aggregates). Resolve on success; reject so the panel stays open on failure.
   */
  onRunMasterExport: (args: {
    areas: ReportExportBundleId[];
    format: "pdf" | "csv" | "xlsx";
    dateRange: { start: string; end: string };
  }) => void | Promise<void>;
  /** Disables the export control (e.g. no data loaded yet, or PDF in progress). */
  exportDisabled?: boolean;
  /** When true, label reads "Preparing…" (PDF generation). When false but disabled, still shows "Export data". */
  exportBusy?: boolean;
  sentimentLabel: string;
  predictiveInsight: string;
  peakSubtitle: string;
  monthlyRev: number;
};

const EXPORT_AREA_IDS: ReportExportBundleId[] = [
  "passenger",
  "attendants",
  "bus",
  "route",
  "insights",
  "timeWindowPickups",
  "revenue",
];

function toggleExportBundleSelection(prev: Set<ReportExportBundleId>, id: ReportExportBundleId): Set<ReportExportBundleId> {
  const n = new Set(prev);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  if (n.size === 0) n.add("passenger");
  return n;
}

export function ReportsIntelligenceHub({
  data,
  hubTab,
  onHubTab,
  onCancelExport,
  exportProgress,
  refundAlert,
  onRunMasterExport,
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

  // Live "current time" pulse line for hourly charts.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const nowHourLabel = `${String(new Date(nowTick).getHours()).padStart(2, "0")}:00`;
  const hasNowHourLabel = hourlyRevData.some((x) => x.hourLabel === nowHourLabel);

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
  /** Sidebar “Busiest hour / day / month / year” — one panel at a time. */
  const [peakPickupPeriod, setPeakPickupPeriod] = useState<PassengerCongestionPeriod>("hour");
  const [passengerRevenuePeriod, setPassengerRevenuePeriod] = useState<PassengerCongestionPeriod>("hour");
  const [routeRevenuePeriod, setRouteRevenuePeriod] = useState<PassengerCongestionPeriod>("hour");
  const [busTicketPeriod, setBusTicketPeriod] = useState<PassengerCongestionPeriod>("hour");

  const [exportBundles, setExportBundles] = useState<Set<ReportExportBundleId>>(
    () =>
      new Set<ReportExportBundleId>([
        "passenger",
        "attendants",
        "bus",
        "route",
        "insights",
        "timeWindowPickups",
        "revenue",
      ])
  );
  const [exportFormat, setExportFormat] = useState<"pdf" | "csv" | "xlsx">("pdf");

  const [exportRangeStart, setExportRangeStart] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    return localYmd(start);
  });
  const [exportRangeEnd, setExportRangeEnd] = useState(() => localYmd(new Date()));

  const exportRangeValid = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exportRangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(exportRangeEnd)) {
      return false;
    }
    return exportRangeStart <= exportRangeEnd;
  }, [exportRangeStart, exportRangeEnd]);

  async function handleConfirmHubExport() {
    if (exportBundles.size === 0 || !exportRangeValid) return;
    try {
      await onRunMasterExport({
        areas: Array.from(exportBundles),
        format: exportFormat,
        dateRange: { start: exportRangeStart, end: exportRangeEnd },
      });
      onCancelExport();
    } catch {
      /* Parent shows toast; keep export panel open. */
    }
  }

  const exportAreaLabels = useMemo(() => {
    const m = new Map<ReportExportBundleId, string>();
    for (const o of REPORT_EXPORT_BUNDLES) {
      m.set(o.id, o.label);
    }
    return m;
  }, []);

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
        </div>
        <div className="reports-hub__nav-actions">
          <button
            type="button"
            className={`reports-hub__export-action-btn${hubTab === "export" ? " reports-hub__export-action-btn--active" : ""}`}
            disabled={exportDisabled}
            title={
              exportBusy
                ? "Preparing export…"
                : "Pick report areas, Manila date range, and format. Download uses server MySQL aggregates when ticketing is online."
            }
            onClick={() => onHubTab("export")}
          >
            {exportBusy ? "Preparing…" : "Export data"}
          </button>
          {refundAlert ? (
            <span className="reports-hub__export-fraud-dot reports-hub__nav-fraud" title="Refund-flagged tickets present" aria-label="Financial anomaly" />
          ) : null}
        </div>
      </nav>

      <div className={`reports-hub__main-row${hubTab === "export" ? " reports-hub__main-row--export" : ""}`}>
        <div className="reports-hub__charts-stage">
          {hubTab === "export" ? (
            <div className="reports-hub__export-panel-wrap" key="export-panel">
              <div className="reports-hub__export-panel">
                <header className="reports-hub__export-panel-head">
                  <h3 className="reports-hub__export-panel-title">Export data</h3>
                </header>

                <p className="reports-hub__export-panel-kicker">Report areas</p>
                <div className="reports-hub__export-toggles" role="group" aria-label="Datasets to include">
                  {EXPORT_AREA_IDS.map((id) => {
                    const on = exportBundles.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        role="switch"
                        aria-checked={on}
                        className={`reports-hub__export-toggle${on ? " reports-hub__export-toggle--on" : ""}`}
                        onClick={() => setExportBundles((prev) => toggleExportBundleSelection(prev, id))}
                      >
                        <span className="reports-hub__export-toggle-track" aria-hidden>
                          <span className="reports-hub__export-toggle-knob" />
                        </span>
                        <span className="reports-hub__export-toggle-label">{exportAreaLabels.get(id) ?? id}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="reports-hub__export-panel-kicker">Date range (inclusive, Asia / Manila)</p>
                <div className="reports-hub__export-dates" role="group" aria-label="Report date range">
                  <label className="reports-hub__export-date-field">
                    <span className="reports-hub__export-date-label">Start</span>
                    <input
                      type="date"
                      className="reports-hub__export-date-input"
                      value={exportRangeStart}
                      onChange={(e) => setExportRangeStart(e.target.value)}
                    />
                  </label>
                  <label className="reports-hub__export-date-field">
                    <span className="reports-hub__export-date-label">End</span>
                    <input
                      type="date"
                      className="reports-hub__export-date-input"
                      value={exportRangeEnd}
                      onChange={(e) => setExportRangeEnd(e.target.value)}
                    />
                  </label>
                </div>
                {!exportRangeValid ? (
                  <p className="reports-hub__export-date-hint reports-hub__export-date-hint--err">
                    Use valid YYYY-MM-DD dates; start must be on or before end.
                  </p>
                ) : (
                  <p className="reports-hub__export-date-hint">
                    Ticket rows are filtered by <code>created_at</code> converted to Manila local hours for time-window
                    charts.
                  </p>
                )}

                <p className="reports-hub__export-panel-kicker">File format</p>
                <div className="reports-hub__segmented reports-hub__segmented--export" role="tablist" aria-label="Export format">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={exportFormat === "pdf"}
                    className={`reports-hub__segment-btn${exportFormat === "pdf" ? " reports-hub__segment-btn--active" : ""}`}
                    onClick={() => setExportFormat("pdf")}
                  >
                    PDF
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={exportFormat === "csv"}
                    className={`reports-hub__segment-btn${exportFormat === "csv" ? " reports-hub__segment-btn--active" : ""}`}
                    onClick={() => setExportFormat("csv")}
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={exportFormat === "xlsx"}
                    className={`reports-hub__segment-btn${exportFormat === "xlsx" ? " reports-hub__segment-btn--active" : ""}`}
                    onClick={() => setExportFormat("xlsx")}
                  >
                    Excel
                  </button>
                </div>

                <div className="reports-hub__export-actions">
                  <button type="button" className="reports-hub__export-cancel" onClick={onCancelExport}>
                    Back to charts
                  </button>
                  <button
                    type="button"
                    className="reports-hub__export-submit"
                    disabled={exportDisabled || !exportRangeValid || exportBundles.size === 0}
                    onClick={() => void handleConfirmHubExport()}
                  >
                    {exportFormat === "pdf"
                      ? "Download PDF"
                      : exportFormat === "csv"
                        ? "Download CSV"
                        : "Download Excel"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
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
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-passenger">
                      {passengerCongestionPeriod === "hour" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyCongestion ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <HourlyTicketsVolumeChart
                                hourlyToday={data.hourlyToday}
                                peakStart={data.insights.peakBoardingWindow.startHour}
                                peakEnd={data.insights.peakBoardingWindow.endHour}
                                barColor={PASSENGER_ORANGE_2}
                                barColorPeak={PASSENGER_ORANGE}
                                lineColor="#fde68a"
                                legend="Bars = tickets per hour · line = trend · shaded band = peak boarding window"
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
                                      <Cell key={i} className="reports-hub__chart-glow" fill={i % 2 ? PASSENGER_ORANGE_2 : PASSENGER_ORANGE} />
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
                                  <Bar dataKey="tickets" fill={PASSENGER_ORANGE_2} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
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
                                  <Bar dataKey="tickets" fill={PASSENGER_ORANGE} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
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
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-revenue">
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
                                  {hasNowHourLabel ? (
                                    <ReferenceLine
                                      x={nowHourLabel}
                                      stroke="rgba(255,255,255,0.92)"
                                      strokeWidth={1.5}
                                      className="reports-hub__live-time-line"
                                    />
                                  ) : null}
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
                                  <Bar dataKey="revenue" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} shape={LeadingEdgeBarShape} />
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
                                  <Bar dataKey="revenue" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} shape={LeadingEdgeBarShape} />
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
                                  <Bar dataKey="revenue" fill={SLATE_SECONDARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} shape={LeadingEdgeBarShape} />
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
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-fleet">
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
                                  <Cell key={i} className="reports-hub__chart-glow" fill={i % 2 ? FLEET_GREEN_2 : FLEET_GREEN} />
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
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-fleet">
                      {busTicketPeriod === "hour" ? (
                        <>
                          <div className="reports-hub__chart-canvas reports-hub__chart-canvas--congestion-bar">
                            {emptyCongestion ? (
                              <p className="reports-hub__placeholder">Awaiting live feed…</p>
                            ) : (
                              <HourlyTicketsVolumeChart
                                hourlyToday={data.hourlyToday}
                                peakStart={data.insights.peakBoardingWindow.startHour}
                                peakEnd={data.insights.peakBoardingWindow.endHour}
                                barColor={FLEET_GREEN_2}
                                barColorPeak={FLEET_GREEN}
                                lineColor="#a7f3d0"
                                legend="Bars = tickets per hour · line = trend · shaded band = peak boarding window"
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
                                      <Cell key={i} className="reports-hub__chart-glow" fill={i % 2 ? FLEET_GREEN_2 : FLEET_GREEN} />
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
                                  <Bar dataKey="tickets" fill={FLEET_GREEN_2} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
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
                                  <Bar dataKey="tickets" fill={FLEET_GREEN} radius={[6, 6, 0, 0]} activeBar={hubBarActive} />
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
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--pad reports-hub__chart-shell--donut reports-hub__chart-shell--ambient-fleet">
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
                                  <Cell key={i} className="reports-hub__chart-glow" fill={PIE_COLORS_FLEET[i % PIE_COLORS_FLEET.length]} />
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
                              <span className="reports-hub__donut-swatch" style={{ background: PIE_COLORS_FLEET[i % PIE_COLORS_FLEET.length] }} aria-hidden />
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
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-fleet">
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
                                  {hasNowHourLabel ? (
                                    <ReferenceLine
                                      x={nowHourLabel}
                                      stroke="rgba(255,255,255,0.92)"
                                      strokeWidth={1.5}
                                      className="reports-hub__live-time-line"
                                    />
                                  ) : null}
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
                                  <Bar dataKey="revenue" fill={SLATE_PRIMARY} radius={[6, 6, 0, 0]} activeBar={hubBarActive} shape={LeadingEdgeBarShape} />
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
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--pad reports-hub__chart-shell--donut reports-hub__chart-shell--ambient-fleet">
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
                                  <Cell key={i} className="reports-hub__chart-glow" fill={PIE_COLORS_FLEET[i % PIE_COLORS_FLEET.length]} />
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
          )}
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
              <>
                <div className="reports-hub__peak-period-bar">
                  <div
                    className="reports-hub__segmented reports-hub__segmented--peak-pickups"
                    role="tablist"
                    aria-label="Peak start locations by period"
                  >
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
                        aria-selected={peakPickupPeriod === key}
                        className={`reports-hub__segment-btn${peakPickupPeriod === key ? " reports-hub__segment-btn--active" : ""}`}
                        onClick={() => setPeakPickupPeriod(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="reports-hub__live-badge">
                    <span className="reports-hub__live-dot reports-hub__animate-heartbeat" aria-hidden />
                    LIVE
                  </span>
                </div>
                <div className="reports-hub__peak-stack reports-hub__peak-stack--tabbed">
                  {peakPickupPeriod === "hour" ? (
                    <PeakPickupBlock
                      title={`Busiest hour today (${String(peak.hour.slot).padStart(2, "0")}:00)`}
                      subtitle={`${peak.hour.tickets} tickets · top start locations`}
                      locations={peak.hour.locations as ReportPickupRow[]}
                    />
                  ) : null}
                  {peakPickupPeriod === "day" ? (
                    <PeakPickupBlock
                      title="Busiest day (30d)"
                      subtitle={peak.day.date ? `${peak.day.date} · ${peak.day.tickets} tickets` : "—"}
                      locations={peak.day.locations as ReportPickupRow[]}
                    />
                  ) : null}
                  {peakPickupPeriod === "month" ? (
                    <PeakPickupBlock
                      title="Busiest month (YTD)"
                      subtitle={peak.month.label ? `${peak.month.label} · ${peak.month.tickets} tickets` : "—"}
                      locations={peak.month.locations as ReportPickupRow[]}
                    />
                  ) : null}
                  {peakPickupPeriod === "year" ? (
                    <PeakPickupBlock
                      title="Busiest year"
                      subtitle={peak.year.year ? `${peak.year.year} · ${peak.year.tickets} tickets` : "—"}
                      locations={peak.year.locations as ReportPickupRow[]}
                    />
                  ) : null}
                </div>
              </>
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
