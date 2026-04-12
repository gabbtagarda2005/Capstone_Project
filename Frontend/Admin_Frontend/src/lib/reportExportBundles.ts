import type { ReportExportSectionKey } from "@/lib/reportsCsvExport";

export type ReportExportBundleId =
  | "passenger"
  | "attendants"
  | "bus"
  | "route"
  | "insights"
  | "timeWindowPickups"
  | "revenue";

const CSV_BY_BUNDLE: Record<ReportExportBundleId, ReportExportSectionKey[]> = {
  passenger: ["pickups", "refunds", "operatorsToday"],
  revenue: ["executive", "hourlyToday", "dailyTrend", "monthlyTrend", "yearlyTrend"],
  insights: ["insightsMeta"],
  timeWindowPickups: ["peakPeriodPickups"],
  attendants: ["attendants"],
  bus: ["buses"],
  route: ["routes"],
};

const PDF_BY_BUNDLE: Record<ReportExportBundleId, string[]> = {
  passenger: ["pickups", "refunds", "operatorsToday"],
  revenue: ["executive", "hourlyToday", "dailyTrend", "monthlyTrend", "yearlyTrend"],
  insights: ["insightsMeta"],
  timeWindowPickups: ["peakPeriodPickups"],
  attendants: ["attendants"],
  bus: ["buses"],
  route: ["routes"],
};

export const REPORT_EXPORT_BUNDLES: { id: ReportExportBundleId; label: string; description: string }[] = [
  { id: "passenger", label: "Passenger reports", description: "Top pickup locations, refunds, operators on duty today" },
  { id: "attendants", label: "Bus attendants reports", description: "Tickets and revenue by attendant (all-time)" },
  { id: "bus", label: "Bus reports", description: "Fleet bus ticket and fare totals" },
  {
    id: "route",
    label: "Route report",
    description: "All routes (or top routes) plus route mix for top buses when present",
  },
  {
    id: "insights",
    label: "Insights",
    description: "Peak boarding window, corridor hint, delay sentiment, spare capacity, constants",
  },
  {
    id: "timeWindowPickups",
    label: "Time-window pickups",
    description: "Today / 30d / MTD / YTD top starts and peak hour–year location breakdowns",
  },
  {
    id: "revenue",
    label: "Revenue",
    description: "Executive KPIs, hourly today, and daily / monthly / yearly revenue trends",
  },
];

export function bundlesToCsvKeys(bundles: Set<ReportExportBundleId>): Set<ReportExportSectionKey> {
  const s = new Set<ReportExportSectionKey>();
  for (const b of bundles) {
    for (const k of CSV_BY_BUNDLE[b]) s.add(k);
  }
  return s;
}

export function bundlesToPdfKeys(bundles: Set<ReportExportBundleId>): Set<string> {
  const s = new Set<string>();
  for (const b of bundles) {
    for (const k of PDF_BY_BUNDLE[b]) s.add(k);
  }
  return s;
}
