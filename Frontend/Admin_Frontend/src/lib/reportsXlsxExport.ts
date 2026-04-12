import * as XLSX from "xlsx";

import type { ReportPickupRow, ReportsAnalyticsDto } from "@/lib/types";
import type { ReportExportSectionKey } from "@/lib/reportsCsvExport";

function sheetName(base: string): string {
  return base.replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet";
}

export function downloadReportsXlsx(
  data: ReportsAnalyticsDto,
  sections: Set<ReportExportSectionKey>,
  filename?: string
): void {
  const wb = XLSX.utils.book_new();

  if (sections.has("executive")) {
    const ex = data.executive;
    const goal = ex.monthlyProfitGoalPesos ?? data.constants.monthlyProfitGoalPesos;
    const aoa: (string | number)[][] = [
      ["Executive", "Metric", "Value"],
      ["Executive", "Total revenue", ex.totalRevenue],
      ["Executive", "Total tickets", ex.totalTickets],
      ["Executive", "Today revenue", ex.todayRevenue],
      ["Executive", "Today tickets", ex.todayTickets],
      ["Executive", "Month-to-date revenue", ex.monthlyRevenue],
      ["Executive", "Monthly profit goal (pesos)", goal],
      ["Executive", "YTD revenue", ex.ytdRevenue ?? ""],
      ["Executive", "YTD tickets", ex.ytdTickets ?? ""],
      ["Executive", "Goal progress %", ex.goalProgressPct],
      ["Executive", "Tomorrow projection", ex.tomorrowProjection],
      ["Executive", "Avg daily revenue last 7 days", ex.avgDailyLast7Days],
      ["Executive", "Today hourly revenue total", ex.todayHourlyRevenueTotal ?? ""],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Executive"));
  }

  if (sections.has("insightsMeta")) {
    const ins = data.insights;
    const aoa: (string | number)[][] = [
      ["Insights & meta", "Field", "Value"],
      ["Insights", "Peak boarding start hour", ins.peakBoardingWindow.startHour],
      ["Insights", "Peak boarding end hour", ins.peakBoardingWindow.endHour],
      ["Insights", "Peak corridor hint", ins.peakCorridorHint],
      ["Insights", "Route delay sentiment", ins.routeDelaySentiment],
      ["Insights", "Suggested extra buses", ins.suggestedExtraBuses],
      ["Constants", "Monthly profit goal (pesos)", data.constants.monthlyProfitGoalPesos],
      ["Constants", "Tomorrow growth rate", data.constants.tomorrowGrowthRate],
      ["Meta", "Report generated_at", data.generatedAt],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Insights meta"));
  }

  if (sections.has("operatorsToday")) {
    const aoa: (string | number)[][] = [["Operators today", "Operator ID", "Operator", "Tickets", "Revenue"]];
    for (const o of data.operatorsToday) {
      aoa.push(["Operators today", o.operatorId, o.operator, o.tickets, o.revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Operators today"));
  }

  if (sections.has("peakPeriodPickups")) {
    const aoa: (string | number)[][] = [];
    const pushWindow = (title: string, arr: ReportPickupRow[] | undefined) => {
      if (!arr?.length) return;
      aoa.push([title, "Location", "Tickets", "Revenue", "Share %", "Status"]);
      for (const p of arr) {
        aoa.push([title, p.location, p.ticketCount, p.revenue, p.sharePct, p.status]);
      }
      aoa.push([]);
    };
    pushWindow("Top pickups today", data.topPickupsToday);
    pushWindow("Top pickups last 30d", data.topPickupsLast30);
    pushWindow("Top pickups MTD", data.topPickupsMtd);
    pushWindow("Top pickups YTD", data.topPickupsYtd);
    const pk = data.peakPickups;
    if (pk) {
      aoa.push(["Peak hour", "Slot", pk.hour.slot, "Tickets", pk.hour.tickets]);
      aoa.push(["Peak hour locations", "Location", "Tickets", "Revenue", "Share %", "Status"]);
      for (const p of pk.hour.locations) {
        aoa.push(["Peak hour locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]);
      }
      aoa.push([]);
      aoa.push(["Peak day", "Date", pk.day.date, "Tickets", pk.day.tickets]);
      aoa.push(["Peak day locations", "Location", "Tickets", "Revenue", "Share %", "Status"]);
      for (const p of pk.day.locations) {
        aoa.push(["Peak day locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]);
      }
      aoa.push([]);
      aoa.push(["Peak month", "Label", pk.month.label, "Tickets", pk.month.tickets]);
      aoa.push(["Peak month locations", "Location", "Tickets", "Revenue", "Share %", "Status"]);
      for (const p of pk.month.locations) {
        aoa.push(["Peak month locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]);
      }
      aoa.push([]);
      aoa.push(["Peak year", "Year", pk.year.year, "Tickets", pk.year.tickets]);
      aoa.push(["Peak year locations", "Location", "Tickets", "Revenue", "Share %", "Status"]);
      for (const p of pk.year.locations) {
        aoa.push(["Peak year locations", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]);
      }
    }
    if (!aoa.length) {
      aoa.push(["Peak periods & windows", "No peak-window data in this report"]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Peak pickups"));
  }

  if (sections.has("hourlyToday")) {
    const aoa: (string | number)[][] = [["Hourly today", "Hour", "Tickets", "Revenue"]];
    for (const h of data.hourlyToday) {
      aoa.push(["Hourly today", h.hour, h.tickets, h.revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Hourly today"));
  }

  if (sections.has("dailyTrend") && data.dailyLast14?.length) {
    const aoa: (string | number)[][] = [["Daily trend", "Date", "Tickets", "Revenue"]];
    for (const d of data.dailyLast14) {
      aoa.push(["Daily trend", d.date, d.tickets, d.revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Daily trend"));
  }

  if (sections.has("monthlyTrend") && data.monthlyThisYear?.length) {
    const aoa: (string | number)[][] = [["Monthly trend", "Month", "Label", "Tickets", "Revenue"]];
    for (const m of data.monthlyThisYear) {
      aoa.push(["Monthly trend", m.month, m.label, m.tickets, m.revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Monthly trend"));
  }

  if (sections.has("yearlyTrend") && data.yearlyAll?.length) {
    const aoa: (string | number)[][] = [["Yearly trend", "Year", "Tickets", "Revenue"]];
    for (const y of data.yearlyAll) {
      aoa.push(["Yearly trend", y.year, y.tickets, y.revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Yearly trend"));
  }

  if (sections.has("pickups")) {
    const aoa: (string | number)[][] = [["Top pickups", "Location", "Tickets", "Revenue", "Share %", "Status"]];
    for (const p of data.topPickupLocations) {
      aoa.push(["Top pickups", p.location, p.ticketCount, p.revenue, p.sharePct, p.status]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Top pickups"));
  }

  if (sections.has("routes")) {
    const routes = data.allRoutes?.length ? data.allRoutes : data.topRoutes;
    const aoa: (string | number)[][] = [["Routes", "Route", "Tickets", "Revenue"]];
    for (const r of routes) {
      aoa.push(["Routes", r.route, r.tickets, r.revenue]);
    }
    if (data.routesForTopBuses?.length) {
      aoa.push([]);
      aoa.push(["Routes (top buses context)", "Route", "Tickets", "Revenue"]);
      for (const r of data.routesForTopBuses) {
        aoa.push(["Routes (top buses context)", r.route, r.tickets, r.revenue]);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Routes"));
  }

  if (sections.has("attendants")) {
    const aoa: (string | number)[][] = [["Bus attendants", "Name", "Tickets", "Revenue"]];
    for (const o of data.operatorsAllTime) {
      aoa.push(["Bus attendants", o.operator, o.tickets, o.revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Attendants"));
  }

  if (sections.has("buses") && data.topBusesAll?.length) {
    const aoa: (string | number)[][] = [["Buses", "Bus label", "Tickets", "Revenue"]];
    for (const b of data.topBusesAll) {
      aoa.push(["Buses", b.busLabel, b.tickets, b.revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Buses"));
  }

  if (sections.has("refunds")) {
    const aoa: (string | number)[][] = [["Refunds", "ID", "Passenger ID", "Route", "Amount", "Created"]];
    for (const r of data.refunds) {
      aoa.push(["Refunds", r.id, r.passengerId, r.route, r.amount, r.createdAt]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName("Refunds"));
  }

  if (!wb.SheetNames.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["No sections", "Select at least one report area"],
      ]),
      sheetName("Empty")
    );
  }

  const name = filename ?? `BBC_reports_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}
