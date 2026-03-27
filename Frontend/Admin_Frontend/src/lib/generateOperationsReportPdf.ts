import type { ReportsAnalyticsDto } from "@/lib/types";

const ALL_SECTIONS = new Set([
  "executive",
  "hourlyToday",
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
        ["Month-to-date revenue", `PHP ${ex.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["YTD revenue", `PHP ${(ex.ytdRevenue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["Monthly profit goal progress", `${ex.goalProgressPct.toFixed(1)}% of PHP ${goal.toLocaleString()}`],
        ["Tomorrow projection", `PHP ${ex.tomorrowProjection.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
        ["Avg daily revenue (last 7 days)", `PHP ${ex.avgDailyLast7Days.toLocaleString(undefined, { minimumFractionDigits: 2 })}`],
      ],
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
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
