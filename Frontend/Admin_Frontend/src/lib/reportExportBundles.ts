import type { ReportExportSectionKey } from "@/lib/reportsCsvExport";

export type ReportExportBundleId = "passenger" | "attendants" | "bus" | "route" | "everything";

const ALL_CSV_KEYS: ReportExportSectionKey[] = [
  "executive",
  "hourlyToday",
  "dailyTrend",
  "monthlyTrend",
  "yearlyTrend",
  "pickups",
  "routes",
  "attendants",
  "buses",
  "refunds",
];

const ALL_PDF_KEYS = new Set([
  "executive",
  "hourlyToday",
  "pickups",
  "routes",
  "attendants",
  "buses",
  "refunds",
]);

const CSV_BY_BUNDLE: Record<Exclude<ReportExportBundleId, "everything">, ReportExportSectionKey[]> = {
  passenger: ["executive", "hourlyToday", "dailyTrend", "monthlyTrend", "yearlyTrend", "pickups"],
  attendants: ["attendants"],
  bus: ["buses"],
  route: ["routes"],
};

const PDF_BY_BUNDLE: Record<Exclude<ReportExportBundleId, "everything">, string[]> = {
  passenger: ["executive", "hourlyToday", "pickups"],
  attendants: ["attendants"],
  bus: ["buses"],
  route: ["routes"],
};

export const REPORT_EXPORT_BUNDLES: { id: ReportExportBundleId; label: string; description: string }[] = [
  { id: "passenger", label: "Passenger reports", description: "Volume, revenue trends, top pickup starts" },
  { id: "attendants", label: "Bus attendant reports", description: "Tickets and revenue by attendant" },
  { id: "bus", label: "Bus reports", description: "Fleet bus ticket and fare totals" },
  { id: "route", label: "Route reports", description: "Corridor / route ticket and revenue" },
  { id: "everything", label: "Everything", description: "All datasets including refunds and executive summary" },
];

export function bundlesToCsvKeys(bundles: Set<ReportExportBundleId>): Set<ReportExportSectionKey> {
  if (bundles.has("everything")) return new Set(ALL_CSV_KEYS);
  const s = new Set<ReportExportSectionKey>();
  for (const b of bundles) {
    if (b === "everything") continue;
    for (const k of CSV_BY_BUNDLE[b]) s.add(k);
  }
  return s;
}

export function bundlesToPdfKeys(bundles: Set<ReportExportBundleId>): Set<string> {
  if (bundles.has("everything")) return new Set(ALL_PDF_KEYS);
  const s = new Set<string>();
  for (const b of bundles) {
    if (b === "everything") continue;
    for (const k of PDF_BY_BUNDLE[b]) s.add(k);
  }
  return s;
}
