import type { ReportsAnalyticsDto } from "@/lib/types";

export type ReportExportSectionKey =
  | "executive"
  | "hourlyToday"
  | "dailyTrend"
  | "monthlyTrend"
  | "yearlyTrend"
  | "pickups"
  | "routes"
  | "attendants"
  | "buses"
  | "refunds";

function escCell(s: string): string {
  const t = String(s ?? "");
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function row(cells: (string | number)[]): string {
  return cells.map((c) => escCell(typeof c === "number" ? String(c) : c)).join(",");
}

export function buildReportsCsv(data: ReportsAnalyticsDto, sections: Set<ReportExportSectionKey>): string {
  const lines: string[] = ["\ufeff"];

  if (sections.has("executive")) {
    const ex = data.executive;
    lines.push(row(["Executive", "Total revenue", ex.totalRevenue]));
    lines.push(row(["Executive", "Total tickets", ex.totalTickets]));
    lines.push(row(["Executive", "Today revenue", ex.todayRevenue]));
    lines.push(row(["Executive", "Month-to-date revenue", ex.monthlyRevenue]));
    lines.push(row(["Executive", "YTD revenue", ex.ytdRevenue ?? ""]));
    lines.push(row(["Executive", "Goal progress %", ex.goalProgressPct]));
  }

  if (sections.has("hourlyToday")) {
    lines.push("Hourly today,hour,tickets,revenue");
    for (const h of data.hourlyToday) {
      lines.push(`Hourly today,${h.hour},${h.tickets},${h.revenue}`);
    }
  }

  if (sections.has("dailyTrend") && data.dailyLast14?.length) {
    lines.push("Daily trend,date,tickets,revenue");
    for (const d of data.dailyLast14) {
      lines.push(`Daily trend,${d.date},${d.tickets},${d.revenue}`);
    }
  }

  if (sections.has("monthlyTrend") && data.monthlyThisYear?.length) {
    lines.push("Monthly trend,month,label,tickets,revenue");
    for (const m of data.monthlyThisYear) {
      lines.push(`Monthly trend,${m.month},${m.label},${m.tickets},${m.revenue}`);
    }
  }

  if (sections.has("yearlyTrend") && data.yearlyAll?.length) {
    lines.push("Yearly trend,year,tickets,revenue");
    for (const y of data.yearlyAll) {
      lines.push(`Yearly trend,${y.year},${y.tickets},${y.revenue}`);
    }
  }

  if (sections.has("pickups")) {
    lines.push("Top pickups,location,tickets,revenue,share_pct,status");
    for (const p of data.topPickupLocations) {
      lines.push(`Top pickups,${p.location},${p.ticketCount},${p.revenue},${p.sharePct},${p.status}`);
    }
  }

  if (sections.has("routes")) {
    lines.push("Routes,route,tickets,revenue");
    const routes = data.allRoutes?.length ? data.allRoutes : data.topRoutes;
    for (const r of routes) {
      lines.push(`Routes,${r.route},${r.tickets},${r.revenue}`);
    }
  }

  if (sections.has("attendants")) {
    lines.push("Bus attendants,name,tickets,revenue");
    for (const o of data.operatorsAllTime) {
      lines.push(`Bus attendants,${o.operator},${o.tickets},${o.revenue}`);
    }
  }

  if (sections.has("buses") && data.topBusesAll?.length) {
    lines.push("Buses,bus_label,tickets,revenue");
    for (const b of data.topBusesAll) {
      lines.push(`Buses,${b.busLabel},${b.tickets},${b.revenue}`);
    }
  }

  if (sections.has("refunds")) {
    lines.push("Refunds,id,passenger_id,route,amount,created_at");
    for (const r of data.refunds) {
      lines.push(`Refunds,${r.id},${r.passengerId},${r.route},${r.amount},${r.createdAt}`);
    }
  }

  return lines.join("\r\n");
}

export function downloadReportsCsv(data: ReportsAnalyticsDto, sections: Set<ReportExportSectionKey>, filename?: string): void {
  const blob = new Blob([buildReportsCsv(data, sections)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `BBC_reports_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
