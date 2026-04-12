import type { ReportPickupRow, ReportsAnalyticsDto } from "@/lib/types";

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
  | "refunds"
  /** Insights, constants, generatedAt — not in legacy four bundles until passenger extended */
  | "insightsMeta"
  /** Today-only attendant rows (vs all-time in Bus attendant bundle) */
  | "operatorsToday"
  /** Peak hour/day/month/year blocks + top pickups by window (today / 30d / MTD / YTD) */
  | "peakPeriodPickups";

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
    const goal = ex.monthlyProfitGoalPesos ?? data.constants.monthlyProfitGoalPesos;
    lines.push(row(["Executive", "Total revenue", ex.totalRevenue]));
    lines.push(row(["Executive", "Total tickets", ex.totalTickets]));
    lines.push(row(["Executive", "Today revenue", ex.todayRevenue]));
    lines.push(row(["Executive", "Today tickets", ex.todayTickets]));
    lines.push(row(["Executive", "Month-to-date revenue", ex.monthlyRevenue]));
    lines.push(row(["Executive", "Monthly profit goal (pesos)", goal]));
    lines.push(row(["Executive", "YTD revenue", ex.ytdRevenue ?? ""]));
    lines.push(row(["Executive", "YTD tickets", ex.ytdTickets ?? ""]));
    lines.push(row(["Executive", "Goal progress %", ex.goalProgressPct]));
    lines.push(row(["Executive", "Tomorrow projection", ex.tomorrowProjection]));
    lines.push(row(["Executive", "Avg daily revenue last 7 days", ex.avgDailyLast7Days]));
    lines.push(row(["Executive", "Today hourly revenue total", ex.todayHourlyRevenueTotal ?? ""]));
  }

  if (sections.has("insightsMeta")) {
    const ins = data.insights;
    lines.push(row(["Insights", "Peak boarding start hour", ins.peakBoardingWindow.startHour]));
    lines.push(row(["Insights", "Peak boarding end hour", ins.peakBoardingWindow.endHour]));
    lines.push(row(["Insights", "Peak corridor hint", ins.peakCorridorHint]));
    lines.push(row(["Insights", "Route delay sentiment", ins.routeDelaySentiment]));
    lines.push(row(["Insights", "Suggested extra buses", ins.suggestedExtraBuses]));
    lines.push(row(["Constants", "Monthly profit goal (pesos)", data.constants.monthlyProfitGoalPesos]));
    lines.push(row(["Constants", "Tomorrow growth rate", data.constants.tomorrowGrowthRate]));
    lines.push(row(["Meta", "Report generated_at", data.generatedAt]));
  }

  if (sections.has("operatorsToday")) {
    lines.push("Operators today,operator_id,operator,tickets,revenue");
    for (const o of data.operatorsToday) {
      lines.push(row(["Operators today", o.operatorId, o.operator, o.tickets, o.revenue]));
    }
  }

  if (sections.has("peakPeriodPickups")) {
    const pushWindow = (label: string, arr: ReportPickupRow[] | undefined) => {
      if (!arr?.length) return;
      lines.push(`${label},location,tickets,revenue,share_pct,status`);
      for (const p of arr) {
        lines.push(row([label, p.location, p.ticketCount, p.revenue, p.sharePct, p.status]));
      }
    };
    pushWindow("Top pickups today", data.topPickupsToday);
    pushWindow("Top pickups last 30d", data.topPickupsLast30);
    pushWindow("Top pickups MTD", data.topPickupsMtd);
    pushWindow("Top pickups YTD", data.topPickupsYtd);
    const pk = data.peakPickups;
    if (pk) {
      lines.push(row(["Peak hour", "slot", pk.hour.slot, "tickets", pk.hour.tickets]));
      lines.push("Peak hour locations,location,tickets,revenue,share_pct,status");
      for (const p of pk.hour.locations) {
        lines.push(row(["Peak hour locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]));
      }
      lines.push(row(["Peak day", "date", pk.day.date, "tickets", pk.day.tickets]));
      lines.push("Peak day locations,location,tickets,revenue,share_pct,status");
      for (const p of pk.day.locations) {
        lines.push(row(["Peak day locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]));
      }
      lines.push(row(["Peak month", "label", pk.month.label, "tickets", pk.month.tickets]));
      lines.push("Peak month locations,location,tickets,revenue,share_pct,status");
      for (const p of pk.month.locations) {
        lines.push(row(["Peak month locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]));
      }
      lines.push(row(["Peak year", "year", pk.year.year, "tickets", pk.year.tickets]));
      lines.push("Peak year locations,location,tickets,revenue,share_pct,status");
      for (const p of pk.year.locations) {
        lines.push(row(["Peak year locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]));
      }
    }
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
    if (data.routesForTopBuses?.length) {
      lines.push("Routes (top buses context),route,tickets,revenue");
      for (const r of data.routesForTopBuses) {
        lines.push(`Routes (top buses context),${r.route},${r.tickets},${r.revenue}`);
      }
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
