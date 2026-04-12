import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  downloadReportsMasterExport,
  fetchReportsAnalytics,
  postAdminAuditEvent,
} from "@/lib/api";
import { bundlesToCsvKeys, bundlesToPdfKeys } from "@/lib/reportExportBundles";
import type { ReportExportBundleId } from "@/lib/reportExportBundles";
import { downloadOperationsReportPdf } from "@/lib/generateOperationsReportPdf";
import { downloadReportsCsv } from "@/lib/reportsCsvExport";
import { downloadReportsXlsx } from "@/lib/reportsXlsxExport";
import { ReportsExecutiveMetrics } from "@/components/ReportsExecutiveMetrics";
import { ReportsIntelligenceHub, type HubTab } from "@/components/ReportsIntelligenceHub";
import { DailyOperationsReportPanel } from "@/components/DailyOperationsReportPanel";
import { ReportsSnapshotsArchive } from "@/components/ReportsSnapshotsArchive";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import type { ReportsAnalyticsDto } from "@/lib/types";
import "./ReportsPage.css";

const GOAL_STREAK_STORAGE_KEY = "admin_reports_rev_below_goal_streak";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetweenUtc(a: string, b: string): number {
  const t0 = Date.parse(`${a}T12:00:00Z`);
  const t1 = Date.parse(`${b}T12:00:00Z`);
  return Math.round((t1 - t0) / 86400000);
}

function revenueBelowGoalSignal(d: ReportsAnalyticsDto): boolean {
  const { todayRevenue, avgDailyLast7Days, goalProgressPct } = d.executive;
  if (avgDailyLast7Days <= 0) return goalProgressPct < 18;
  return goalProgressPct < 34 && todayRevenue < avgDailyLast7Days * 0.42;
}

function buildPredictiveInsight(d: ReportsAnalyticsDto | null): string {
  if (!d) {
    return "Open Reports when ticketing data is available to unlock fleet recommendations and corridor insights.";
  }
  const parts: string[] = [];
  const { startHour, endHour } = d.insights.peakBoardingWindow;
  const a = String(startHour).padStart(2, "0");
  const b = String(endHour).padStart(2, "0");
  const corridor = d.insights.peakCorridorHint || "primary corridors";
  const extra = d.insights.suggestedExtraBuses;
  if (extra > 0) {
    parts.push(
      `High passenger density expected near ${corridor}. Consider dispatching ${extra} standby unit${extra > 1 ? "s" : ""} for the ${b}:00 return window.`
    );
  } else {
    parts.push(
      `Peak boarding window ${a}:00–${b}:00 (${corridor}). Route delay sentiment reads ${d.insights.routeDelaySentiment ?? "stable"} — align capacity to historical load.`
    );
  }
  if (d.refunds.length > 0) {
    parts.push(`${d.refunds.length} refund-flagged ticket(s) need finance review before close of day.`);
  }
  return parts.join(" ");
}

function emptyReportsAnalytics(): ReportsAnalyticsDto {
  return {
    generatedAt: new Date().toISOString(),
    constants: { monthlyProfitGoalPesos: 100_000, tomorrowGrowthRate: 0.08 },
    executive: {
      totalRevenue: 0,
      totalTickets: 0,
      todayRevenue: 0,
      todayTickets: 0,
      monthlyRevenue: 0,
      monthlyProfitGoalPesos: 100_000,
      goalProgressPct: 0,
      tomorrowProjection: 0,
      avgDailyLast7Days: 0,
      ytdRevenue: 0,
      ytdTickets: 0,
      todayHourlyRevenueTotal: 0,
    },
    topPickupLocations: [],
    topRoutes: [],
    hourlyToday: Array.from({ length: 24 }, (_, hour) => ({ hour, tickets: 0, revenue: 0 })),
    dailyLast14: [],
    monthlyThisYear: [],
    yearlyAll: [],
    operatorsAllTime: [],
    operatorsToday: [],
    refunds: [],
    insights: {
      peakBoardingWindow: { startHour: 6, endHour: 19 },
      peakCorridorHint: "",
      routeDelaySentiment: "—",
      suggestedExtraBuses: 0,
    },
  };
}

export function ReportsPage() {
  const { user } = useAuth();
  const { branding } = useAdminBranding();
  const { showError, showSuccess, showInfo } = useToast();
  const [data, setData] = useState<ReportsAnalyticsDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [hubTab, setHubTab] = useState<HubTab>("passenger");
  const lastNonExportHubTabRef = useRef<Exclude<HubTab, "export">>("passenger");
  const [reportsMainTab, setReportsMainTab] = useState<"dashboard" | "archive">("dashboard");

  function handleHubTab(t: HubTab) {
    if (t !== "export") {
      lastNonExportHubTabRef.current = t;
    }
    setHubTab(t);
  }
  const [exportProgress, setExportProgress] = useState(0);
  const [goalAnomalyPulse, setGoalAnomalyPulse] = useState(false);
  const exportRampRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function isSilentTicketingFailure(message: string): boolean {
    const m = message.toLowerCase();
    return (
      m.includes("mysql not configured") ||
      m.includes("ticketing data unavailable") ||
      (m.includes("/api/reports/analytics") && (m.includes("received html") || m.includes("non-json response"))) ||
      m.includes("received html instead of json") ||
      m.includes("unexpected token '<'") ||
      m.includes("invalid json")
    );
  }

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetchReportsAnalytics();
      setData(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load analytics";
      if (isSilentTicketingFailure(msg)) {
        setLoadError(null);
        setData(null);
        return;
      }
      setLoadError(msg);
      setData(null);
      showError(msg);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const d = data;
    if (!d) {
      setGoalAnomalyPulse(false);
      return;
    }
    const low = revenueBelowGoalSignal(d);
    const todayStr = dayKey(new Date());
    try {
      const raw = localStorage.getItem(GOAL_STREAK_STORAGE_KEY);
      const prev = raw ? (JSON.parse(raw) as { last?: string; streak: number }) : null;
      let streak = 0;
      if (!low) {
        streak = 0;
        localStorage.setItem(GOAL_STREAK_STORAGE_KEY, JSON.stringify({ last: todayStr, streak: 0 }));
      } else if (!prev?.last) {
        streak = 1;
        localStorage.setItem(GOAL_STREAK_STORAGE_KEY, JSON.stringify({ last: todayStr, streak: 1 }));
      } else if (prev.last === todayStr) {
        streak = Math.max(1, prev.streak || 1);
      } else {
        const gap = daysBetweenUtc(prev.last, todayStr);
        if (gap === 1) {
          streak = Math.min((prev.streak || 0) + 1, 30);
        } else {
          streak = 1;
        }
        localStorage.setItem(GOAL_STREAK_STORAGE_KEY, JSON.stringify({ last: todayStr, streak }));
      }
      setGoalAnomalyPulse(low && streak >= 3);
    } catch {
      setGoalAnomalyPulse(low);
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (exportRampRef.current) clearInterval(exportRampRef.current);
    };
  }, []);

  const hubData = data ?? emptyReportsAnalytics();
  const predictiveInsight = useMemo(() => buildPredictiveInsight(data), [data]);
  const refundAlert = (data?.refunds?.length ?? 0) > 0;
  const monthlyRev = hubData.executive.monthlyRevenue ?? 0;

  const peakSubtitle = useMemo(() => {
    if (!data) return "Connect ticketing to see peak windows.";
    const { startHour, endHour } = data.insights.peakBoardingWindow;
    const a = String(startHour).padStart(2, "0");
    const b = String(endHour).padStart(2, "0");
    return `Peak periods: ${a}:00–${b}:00 (${data.insights.peakCorridorHint})`;
  }, [data]);

  const sentimentLabel = (hubData.insights.routeDelaySentiment ?? "—").toUpperCase();

  function isMysqlExportUnavailable(message: string): boolean {
    const m = message.toLowerCase();
    return (
      m.includes("mysql not configured") ||
      m.includes("ticketing exports unavailable") ||
      (m.includes("503") && m.includes("mysql"))
    );
  }

  async function runMasterExport(args: {
    areas: ReportExportBundleId[];
    format: "pdf" | "csv" | "xlsx";
    dateRange: { start: string; end: string };
  }) {
    if (exportRampRef.current) clearInterval(exportRampRef.current);
    setPdfBusy(true);
    setExportProgress(8);
    exportRampRef.current = setInterval(() => {
      setExportProgress((p) => (p >= 88 ? p : p + 4 + Math.random() * 3));
    }, 160);
    try {
      await downloadReportsMasterExport({
        selectedAreas: args.areas,
        format: args.format,
        dateRange: args.dateRange,
      });
      setExportProgress(100);
      showSuccess("Report downloaded (server aggregate).");
      void postAdminAuditEvent({
        action: "VIEW",
        module: "Reports & Analytics",
        details: `Downloaded master ${args.format.toUpperCase()} (${args.dateRange.start} → ${args.dateRange.end})`,
      }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      if (isMysqlExportUnavailable(msg)) {
        showInfo("Server ticketing export unavailable — using on-device export from the current dashboard data.");
        const payload = data ?? emptyReportsAnalytics();
        const bundleSet = new Set(args.areas);
        if (args.format === "pdf") {
          await downloadOperationsReportPdf(payload, user?.email ?? "admin", {
            companyName: branding.companyName,
            reportFooter: branding.reportFooter,
            sections: bundlesToPdfKeys(bundleSet),
          });
          showSuccess("PDF downloaded (browser snapshot).");
        } else if (args.format === "csv") {
          downloadReportsCsv(payload, bundlesToCsvKeys(bundleSet));
          showSuccess("CSV downloaded.");
        } else {
          downloadReportsXlsx(payload, bundlesToCsvKeys(bundleSet));
          showSuccess("Excel workbook downloaded.");
        }
        void postAdminAuditEvent({
          action: "VIEW",
          module: "Reports & Analytics",
          details: "Downloaded browser-side reports export (fallback)",
        }).catch(() => {});
        return;
      }
      showError(msg);
      throw e;
    } finally {
      if (exportRampRef.current) {
        clearInterval(exportRampRef.current);
        exportRampRef.current = null;
      }
      setPdfBusy(false);
      window.setTimeout(() => setExportProgress(0), 420);
    }
  }

  return (
    <div className="reports-page admin-mgmt">
      <header className="reports-page__head reports-page__toolbar">
        <div>
          <h1 className="reports-page__title">Reports &amp; data analytics</h1>
        </div>
      </header>

      <div className="reports-page__subtabs" role="tablist" aria-label="Reports views">
        <button
          type="button"
          role="tab"
          className={`reports-page__subtab${reportsMainTab === "dashboard" ? " reports-page__subtab--active" : ""}`}
          aria-selected={reportsMainTab === "dashboard"}
          onClick={() => setReportsMainTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          type="button"
          role="tab"
          className={`reports-page__subtab${reportsMainTab === "archive" ? " reports-page__subtab--active" : ""}`}
          aria-selected={reportsMainTab === "archive"}
          onClick={() => setReportsMainTab("archive")}
        >
          Archive
        </button>
      </div>

      {loadError ? <p className="reports-page__banner">{loadError}</p> : null}

      {reportsMainTab === "archive" ? (
        <ReportsSnapshotsArchive />
      ) : (
        <>
      <ReportsExecutiveMetrics analytics={hubData} isLive={!!data} goalAnomalyPulse={goalAnomalyPulse} />

      <ReportsIntelligenceHub
        data={hubData}
        hubTab={hubTab}
        onHubTab={handleHubTab}
        onCancelExport={() => setHubTab(lastNonExportHubTabRef.current)}
        exportProgress={exportProgress}
        refundAlert={refundAlert}
        onRunMasterExport={(args) => runMasterExport(args)}
        exportDisabled={pdfBusy}
        exportBusy={pdfBusy}
        sentimentLabel={sentimentLabel}
        predictiveInsight={predictiveInsight}
        peakSubtitle={peakSubtitle}
        monthlyRev={monthlyRev}
      />

      <DailyOperationsReportPanel />

        </>
      )}
    </div>
  );
}
