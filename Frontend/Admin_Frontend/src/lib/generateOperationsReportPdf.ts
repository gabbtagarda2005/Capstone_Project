import type { ReportsAnalyticsDto } from "@/lib/types";

const ALL_SECTIONS = new Set([
  "executive",
  "insightsMeta",
  "operatorsToday",
  "peakPeriodPickups",
  "hourlyToday",
  "dailyTrend",
  "monthlyTrend",
  "yearlyTrend",
  "pickups",
  "routes",
  "attendants",
  "buses",
  "refunds",
]);

export async function downloadOperationsReportPdf(
  data: ReportsAnalyticsDto,
  adminEmail: string,
  options?: { companyName?: string; reportFooter?: string; sections?: Set<string> }
): Promise<void> {
  const sections = options?.sections && options.sections.size > 0 ? options.sections : ALL_SECTIONS;
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF();
  const ex = data.executive;
  const goal = data.constants.monthlyProfitGoalPesos;

  const company = options?.companyName?.trim() || "Bukidnon Bus Company";
  doc.setFontSize(18);
  doc.text(`${company} — Operations Report`, 14, 18);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date(data.generatedAt).toLocaleString()}`, 14, 26);
  doc.text(`Admin: ${adminEmail}`, 14, 32);

  const profitGoal = ex.monthlyProfitGoalPesos ?? goal;
  let cursorY = 38;
  if (sections.has("executive")) {
    autoTable(doc, {
      startY: cursorY,
      theme: "grid",
      head: [["Metric", "Value"]],
      body: [
        ["Total revenue (all tickets)", `PHP ${ex.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["Total tickets issued", ex.totalTickets.toLocaleString()],
        ["Revenue today", `PHP ${ex.todayRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["Tickets today", ex.todayTickets.toLocaleString()],
        ["Month-to-date revenue", `PHP ${ex.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["Monthly profit goal (pesos)", `PHP ${profitGoal.toLocaleString()}`],
        ["YTD revenue", `PHP ${(ex.ytdRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["YTD tickets", (ex.ytdTickets ?? 0).toLocaleString()],
        ["Monthly profit goal progress", `${ex.goalProgressPct.toFixed(1)}% of PHP ${profitGoal.toLocaleString()}`],
        ["Tomorrow projection", `PHP ${ex.tomorrowProjection.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["Avg daily revenue (last 7 days)", `PHP ${ex.avgDailyLast7Days.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        [
          "Today hourly revenue total",
          `PHP ${(ex.todayHourlyRevenueTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        ],
      ],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("insightsMeta")) {
    doc.setFontSize(11);
    doc.text("Insights & planning constants", 14, cursorY);
    const ins = data.insights;
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "grid",
      head: [["Field", "Value"]],
      body: [
        ["Peak boarding window", `${ins.peakBoardingWindow.startHour}:00–${ins.peakBoardingWindow.endHour}:00`],
        ["Peak corridor hint", ins.peakCorridorHint],
        ["Route delay sentiment", ins.routeDelaySentiment],
        ["Suggested extra buses", String(ins.suggestedExtraBuses)],
        ["Monthly profit goal (constants)", `PHP ${data.constants.monthlyProfitGoalPesos.toLocaleString()}`],
        ["Tomorrow growth rate", String(data.constants.tomorrowGrowthRate)],
        ["Report generated_at", new Date(data.generatedAt).toLocaleString()],
      ],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("operatorsToday")) {
    doc.setFontSize(11);
    doc.text("Operators today", 14, cursorY);
    const opBody = data.operatorsToday.slice(0, 30).map((o) => [
      o.operator,
      o.operatorId.toString(),
      o.tickets.toString(),
      `PHP ${o.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "striped",
      head: [["Attendant", "ID", "Tickets", "Revenue"]],
      body: opBody.length ? opBody : [["—", "—", "0", "PHP 0.00"]],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("peakPeriodPickups")) {
    doc.setFontSize(11);
    doc.text("Peak periods & pickup windows", 14, cursorY);
    cursorY += 4;
    const pushPickupTable = (subtitle: string, rows: typeof data.topPickupLocations) => {
      if (!rows?.length) return;
      doc.setFontSize(10);
      doc.text(subtitle, 14, cursorY);
      const body = rows.slice(0, 12).map((p) => [p.location, `${p.sharePct}%`, p.ticketCount.toString(), p.status]);
      autoTable(doc, {
        startY: cursorY + 2,
        theme: "grid",
        head: [["Location", "Share", "Tickets", "Status"]],
        body,
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    };
    pushPickupTable("Top pickups — today", data.topPickupsToday ?? []);
    pushPickupTable("Top pickups — last 30 days", data.topPickupsLast30 ?? []);
    pushPickupTable("Top pickups — month to date", data.topPickupsMtd ?? []);
    pushPickupTable("Top pickups — year to date", data.topPickupsYtd ?? []);
    const pk = data.peakPickups;
    if (pk) {
      doc.setFontSize(10);
      doc.text(`Peak hour (slot ${pk.hour.slot}, ${pk.hour.tickets} tickets)`, 14, cursorY);
      cursorY += 2;
      autoTable(doc, {
        startY: cursorY + 2,
        theme: "grid",
        head: [["Location", "Share", "Tickets", "Status"]],
        body: pk.hour.locations.slice(0, 10).map((p) => [p.location, `${p.sharePct}%`, p.ticketCount.toString(), p.status]),
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      doc.text(`Peak day (${pk.day.date}, ${pk.day.tickets} tickets)`, 14, cursorY);
      autoTable(doc, {
        startY: cursorY + 2,
        theme: "grid",
        head: [["Location", "Share", "Tickets", "Status"]],
        body: pk.day.locations.slice(0, 10).map((p) => [p.location, `${p.sharePct}%`, p.ticketCount.toString(), p.status]),
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      doc.text(`Peak month (${pk.month.label}, ${pk.month.tickets} tickets)`, 14, cursorY);
      autoTable(doc, {
        startY: cursorY + 2,
        theme: "grid",
        head: [["Location", "Share", "Tickets", "Status"]],
        body: pk.month.locations.slice(0, 10).map((p) => [p.location, `${p.sharePct}%`, p.ticketCount.toString(), p.status]),
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      doc.text(`Peak year (${pk.year.year}, ${pk.year.tickets} tickets)`, 14, cursorY);
      autoTable(doc, {
        startY: cursorY + 2,
        theme: "grid",
        head: [["Location", "Share", "Tickets", "Status"]],
        body: pk.year.locations.slice(0, 10).map((p) => [p.location, `${p.sharePct}%`, p.ticketCount.toString(), p.status]),
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
  }

  if (sections.has("hourlyToday")) {
    doc.setFontSize(11);
    doc.text("Hourly activity (today)", 14, cursorY);
    const hBody = data.hourlyToday.map((h) => [String(h.hour), String(h.tickets), `PHP ${h.revenue.toFixed(2)}`]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "grid",
      head: [["Hour", "Tickets", "Revenue"]],
      body: hBody.length ? hBody : [["—", "0", "PHP 0.00"]],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("dailyTrend") && data.dailyLast14?.length) {
    doc.setFontSize(11);
    doc.text("Daily trend (last 14 days)", 14, cursorY);
    const body = data.dailyLast14.map((d) => [
      d.date,
      String(d.tickets),
      `PHP ${d.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "grid",
      head: [["Date", "Tickets", "Revenue"]],
      body,
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("monthlyTrend") && data.monthlyThisYear?.length) {
    doc.setFontSize(11);
    doc.text("Monthly trend (this year)", 14, cursorY);
    const body = data.monthlyThisYear.map((m) => [
      m.label,
      String(m.tickets),
      `PHP ${m.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "grid",
      head: [["Month", "Tickets", "Revenue"]],
      body,
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("yearlyTrend") && data.yearlyAll?.length) {
    doc.setFontSize(11);
    doc.text("Yearly trend", 14, cursorY);
    const body = data.yearlyAll.map((y) => [
      String(y.year),
      String(y.tickets),
      `PHP ${y.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "grid",
      head: [["Year", "Tickets", "Revenue"]],
      body,
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("pickups")) {
    doc.setFontSize(11);
    doc.text("Top pickup locations (passenger start)", 14, cursorY);
    const pickupBody = data.topPickupLocations.map((p) => [
      p.location,
      `${p.sharePct}%`,
      p.ticketCount.toString(),
      p.status,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "grid",
      head: [["Location", "Share", "Tickets", "Status"]],
      body: pickupBody.length ? pickupBody : [["—", "—", "0", "No data"]],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("routes")) {
    doc.text("Revenue by route", 14, cursorY);
    const routeList = data.allRoutes?.length ? data.allRoutes : data.topRoutes;
    const routeBody = routeList.slice(0, 20).map((r) => [
      r.route,
      r.tickets.toString(),
      `PHP ${r.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "grid",
      head: [["Route", "Tickets", "Revenue"]],
      body: routeBody.length ? routeBody : [["—", "0", "PHP 0.00"]],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    if (data.routesForTopBuses?.length) {
      doc.setFontSize(11);
      doc.text("Routes (context: top buses)", 14, cursorY);
      const ctxBody = data.routesForTopBuses.slice(0, 15).map((r) => [
        r.route,
        r.tickets.toString(),
        `PHP ${r.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      ]);
      autoTable(doc, {
        startY: cursorY + 4,
        theme: "grid",
        head: [["Route", "Tickets", "Revenue"]],
        body: ctxBody,
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
  }

  if (sections.has("attendants")) {
    doc.text("Bus attendants", 14, cursorY);
    const opBody = data.operatorsAllTime.slice(0, 25).map((o) => [
      o.operator,
      o.tickets.toString(),
      `PHP ${o.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "striped",
      head: [["Attendant", "Tickets", "Revenue"]],
      body: opBody.length ? opBody : [["—", "0", "PHP 0.00"]],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("buses") && data.topBusesAll?.length) {
    doc.setFontSize(11);
    doc.text("Buses", 14, cursorY);
    const busBody = data.topBusesAll.slice(0, 30).map((b) => [
      b.busLabel,
      String(b.tickets),
      `PHP ${b.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "striped",
      head: [["Bus", "Tickets", "Revenue"]],
      body: busBody,
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (sections.has("refunds") && data.refunds.length > 0) {
    doc.text("Refund-flagged tickets", 14, cursorY);
    const refBody = data.refunds.slice(0, 20).map((r) => [
      String(r.id),
      r.passengerId,
      r.route,
      `PHP ${r.amount.toFixed(2)}`,
      new Date(r.createdAt).toLocaleString(),
    ]);
    autoTable(doc, {
      startY: cursorY + 4,
      theme: "striped",
      head: [["Ticket ID", "Passenger ID", "Route", "Amount", "Time"]],
      body: refBody,
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  const y4 = cursorY + 6;
  doc.setFontSize(9);
  doc.setTextColor(90);
  const footerLine =
    options?.reportFooter?.trim() ||
    "© 2026 Bukidnon Bus Company - Fleet Management Division";
  doc.text(
    `${footerLine}\nAudit stamp: PDF generated by ${adminEmail} · Route delay sentiment: ${data.insights.routeDelaySentiment} · Suggested spare capacity: ${data.insights.suggestedExtraBuses} bus(es).`,
    14,
    y4,
    { maxWidth: 180 }
  );

  const safeDate = new Date().toISOString().split("T")[0];
  doc.save(`BBC_Operations_Report_${safeDate}.pdf`);
}
