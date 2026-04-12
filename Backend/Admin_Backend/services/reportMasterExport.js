"use strict";

const ExcelJS = require("exceljs");
const { Parser } = require("json2csv");
const { buildMasterPdfBuffer } = require("./reportMasterPdfmake");

function formatPhp(n) {
  const x = Number(n) || 0;
  return `PHP ${x.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function manilaFooterDate(iso) {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "long",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Sum ticket counts for Manila clock hours [from, to] inclusive. */
function sumHourTickets(hourly, from, to) {
  if (!hourly?.length) return 0;
  let s = 0;
  for (const h of hourly) {
    if (h.hour >= from && h.hour <= to) s += Number(h.tickets) || 0;
  }
  return s;
}

/**
 * Narrative recommendations for the branded summary sheet (data-driven rules on ticketing aggregates).
 * @param {Record<string, unknown>} filtered — toggled sections only
 * @param {Record<string, unknown>} [full] — full server aggregate; used so REVENUE/PASSENGER rows still get hourly & corridor hints when those tabs are off
 * @returns {{ area: string; value: string; insight: string; status: string }[]}
 */
function buildExecutiveSummaryRows(filtered, full) {
  const rows = [];
  const ctx = full && typeof full === "object" ? full : filtered;
  const tw = ctx.timeWindow;
  const ins = ctx.insights;
  const hourly = tw?.hourly;

  function eveningRushLine() {
    if (!hourly?.length) {
      return { insight: "No hourly ticket distribution for this range.", status: "NO DATA" };
    }
    const total = hourly.reduce((s, h) => s + (Number(h.tickets) || 0), 0);
    if (total === 0) {
      return { insight: "No tickets in hourly breakdown for the selected dates.", status: "NO DATA" };
    }
    const avg = total / 24;
    const h17 = hourly.find((h) => h.hour === 17);
    const t17 = h17 ? Number(h17.tickets) || 0 : 0;
    const pct = avg > 0.05 ? Math.round(((t17 - avg) / avg) * 100) : 0;
    let terminal = "the busiest corridor terminal";
    const tr = ins?.topRoutes?.[0];
    if (tr) {
      const label = `${tr.origin} / ${tr.destination}`;
      if (/valencia/i.test(label)) terminal = "Valencia terminal catchment";
      else if (/malaybalay/i.test(label)) terminal = "Malaybalay terminal catchment";
      else terminal = `${tr.origin} ↔ ${tr.destination} corridor`;
    }
    if (pct >= 20) {
      return {
        insight: `Time-window pickups show ~${pct}% above the daily average at 17:00 (Manila). Recommendation: Deploy 1 additional bus to ${terminal} for the evening rush.`,
        status: "ACTION",
      };
    }
    if (pct <= -10) {
      return {
        insight: `17:00 volume is below the daily average (${pct}%). Evening capacity may be redeployed to other corridors if needed.`,
        status: "REVIEW",
      };
    }
    return {
      insight: `Peak Manila hour ${String(tw.peakHour).padStart(2, "0")}:00 (${tw.peakHourTickets} tickets). 17:00 is within a normal band vs the daily average.`,
      status: "STABLE",
    };
  }

  if (filtered.revenue) {
    let insight =
      "Totals computed from all `fare` values in the ticketing database for the selected range (server aggregate).";
    let status = "STABLE";
    if (hourly?.length) {
      const morn = sumHourTickets(hourly, 7, 9);
      const eve = sumHourTickets(hourly, 16, 18);
      if (morn > eve * 1.25 && morn > 0) {
        insight = "Higher ticket volume in the 07:00–09:00 window vs 16:00–18:00 — prioritize AM standby and corridor checks.";
        status = "REVIEW";
      } else if (eve > morn * 1.25 && eve > 0) {
        insight = "Afternoon peak exceeds morning — align spare units for the return / PM window.";
        status = "REVIEW";
      }
    }
    rows.push({
      area: "REVENUE",
      value: `${formatPhp(filtered.revenue.totalRevenue)} · ${filtered.revenue.totalTickets} ticket rows`,
      insight,
      status,
    });
  }

  if (filtered.passenger) {
    const top = ins?.topRoutes?.[0];
    const corridorHint = top
      ? `Peak O–D by volume: ${top.origin} → ${top.destination} (${top.popularity} tickets).`
      : "Connect more ticket history to sharpen corridor-level passenger insights.";
    const u = Number(filtered.passenger.uniquePassengerIds) || 0;
    rows.push({
      area: "PASSENGER VOLUME",
      value: `${u.toLocaleString("en-PH")} unique passenger IDs · ${filtered.passenger.totalTicketRows} ticket rows`,
      insight: corridorHint,
      status: u > 0 ? "ACTIVE" : "NO DATA",
    });
  }

  if (filtered.timeWindow) {
    const ev = eveningRushLine();
    rows.push({
      area: "TIME-WINDOW PICKUPS",
      value: `Peak Manila hour ${String(filtered.timeWindow.peakHour).padStart(2, "0")}:00 · ${filtered.timeWindow.peakHourTickets} tickets`,
      insight: ev.insight,
      status: ev.status,
    });
  }

  if (filtered.insights) {
    const congest = filtered.insights.corridorCongestion || "";
    rows.push({
      area: "CORRIDOR INSIGHTS",
      value: (filtered.insights.topRoutes || [])
        .slice(0, 3)
        .map((r) => `${r.origin}→${r.destination}`)
        .join(" · ") || "—",
      insight: congest || filtered.insights.peakHoursNote || "—",
      status: /consider|reassign|deploy/i.test(congest) ? "ACTION" : "STABLE",
    });
  }

  if (filtered.attendants?.length) {
    const top = filtered.attendants[0];
    rows.push({
      area: "BUS ATTENDANTS",
      value: `${filtered.attendants.length} attendant(s) with sales in range`,
      insight: top
        ? `Top performer: ${top.operator} (${top.tickets} tickets, ${formatPhp(top.revenue)}). Use for coaching / shift pairing.`
        : "—",
      status: "REVIEW",
    });
  }

  if (filtered.buses?.length) {
    const top = filtered.buses[0];
    rows.push({
      area: "BUS ACTIVITY",
      value: `${filtered.buses.length} bus label(s) in range`,
      insight: top
        ? `Highest load: ${top.busLabel} (${top.tickets} tickets, ${formatPhp(top.revenue)}). Schedule maintenance around low windows if possible.`
        : "—",
      status: "STABLE",
    });
  }

  if (filtered.routes?.length) {
    const top = filtered.routes[0];
    rows.push({
      area: "ROUTE REPORT",
      value: `${filtered.routes.length} origin–destination pair(s)`,
      insight: top
        ? `Leading route: ${top.route} (${top.tickets} tickets, ${formatPhp(top.revenue)}).`
        : "—",
      status: "STABLE",
    });
  }

  if (!rows.length) {
    rows.push({
      area: "—",
      value: "No report sections included",
      insight: "Select at least one area in the export toggles.",
      status: "NO DATA",
    });
  }

  return rows;
}

const BUKIDNON_HEADER_GREEN = "FF5EE396";
const BUKIDNON_HEADER_TEXT = "FF0f172a";

/**
 * @param {import("exceljs").Workbook} wb
 * @param {Record<string, unknown>} filtered
 * @param {Record<string, unknown>} [full]
 */
function addBrandedSummaryWorksheet(wb, filtered, full) {
  const ws = wb.addWorksheet("Bukidnon Transit Report", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  ws.mergeCells("A1:E1");
  const title = ws.getCell("A1");
  title.value = "BUKIDNON BUS COMPANY — OFFICIAL REPORT";
  title.font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 32;

  ws.mergeCells("A2:E2");
  const sub = ws.getCell("A2");
  sub.value =
    `Period: ${filtered.meta?.dateRange?.start ?? "—"} → ${filtered.meta?.dateRange?.end ?? "—"} (Asia/Manila) · ` +
    `Generated: ${manilaFooterDate(filtered.meta?.generatedAt)} · ` +
    `Sections: ${(filtered.includedSections || []).join(", ") || "all"}`;
  sub.font = { size: 9, color: { argb: "FF475569" } };
  sub.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(2).height = 38;

  const headerRow = ws.addRow([
    "Metric area",
    "Details / value",
    "Growth / insight (AI-style)",
    "Status",
    "Engine",
  ]);
  headerRow.font = { bold: true, color: { argb: BUKIDNON_HEADER_TEXT } };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BUKIDNON_HEADER_GREEN },
    };
    cell.border = {
      top: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
      bottom: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
      left: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
      right: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  headerRow.height = 24;

  const dataRows = buildExecutiveSummaryRows(filtered, full);
  const engineLabel = "Rule-based (MySQL fares & counts)";
  for (const r of dataRows) {
    const row = ws.addRow([r.area, r.value, r.insight, r.status, engineLabel]);
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        left: { style: "hair", color: { argb: "FFcbd5e1" } },
        right: { style: "hair", color: { argb: "FFcbd5e1" } },
        bottom: { style: "hair", color: { argb: "FFcbd5e1" } },
      };
    });
  }

  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 36;
  ws.getColumn(3).width = 62;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 28;

  const footRow = ws.addRow([]);
  const n = ws.rowCount;
  ws.mergeCells(`A${n}:E${n}`);
  const foot = ws.getCell(`A${n}`);
  foot.value =
    "Operational insights are generated by server-side rules on ticketing aggregates (accurate fare sums from MySQL) — not from an external LLM.";
  foot.font = { italic: true, size: 8, color: { argb: "FF94a3b8" } };
  foot.alignment = { horizontal: "left", wrapText: true };
  ws.getRow(n).height = 30;
}

/**
 * Professional multi-page PDF (pdfmake): headers, footers, watermark, charts, zebra tables.
 * @param {Record<string, unknown>} filtered
 * @param {{
 *   adminEmail?: string;
 *   companyName?: string;
 *   reportFooter?: string;
 *   full?: Record<string, unknown>;
 *   startYmd?: string;
 *   endYmd?: string;
 * }} opts
 */
async function renderMasterPdf(filtered, opts) {
  return buildMasterPdfBuffer(filtered, opts);
}

/**
 * @param {Record<string, unknown>} filtered
 * @param {{ full?: Record<string, unknown> }} [options]
 * @returns {Promise<Buffer>}
 */
async function renderMasterXlsx(filtered, options = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BBC Admin API";
  wb.created = new Date();

  addBrandedSummaryWorksheet(wb, filtered, options.full);

  function styleDetailHeader(row) {
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BUKIDNON_HEADER_GREEN },
      };
      cell.font = { bold: true, color: { argb: BUKIDNON_HEADER_TEXT } };
      cell.border = {
        top: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
        bottom: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
        left: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
        right: { style: "thin", color: { argb: BUKIDNON_HEADER_TEXT } },
      };
    });
  }

  if (filtered.revenue) {
    const ws = wb.addWorksheet("Revenue", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Metric", "Value"]);
    styleDetailHeader(ws.getRow(1));
    ws.addRow(["Total revenue (PHP)", filtered.revenue.totalRevenue]);
    ws.addRow(["Tickets sold", filtered.revenue.totalTickets]);
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 18;
  }

  if (filtered.passenger) {
    const ws = wb.addWorksheet("Passengers", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Metric", "Value"]);
    styleDetailHeader(ws.getRow(1));
    ws.addRow(["Unique passenger IDs", filtered.passenger.uniquePassengerIds]);
    ws.addRow(["Total ticket rows", filtered.passenger.totalTicketRows]);
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 18;
  }

  if (filtered.timeWindow) {
    const ws = wb.addWorksheet("Time window", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Hour (Manila)", "Tickets", "Revenue"]);
    styleDetailHeader(ws.getRow(1));
    for (const h of filtered.timeWindow.hourly) {
      ws.addRow([h.hour, h.tickets, h.revenue]);
    }
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 16;
  }

  if (filtered.insights) {
    const ws = wb.addWorksheet("Insights", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Note", "Text"]);
    styleDetailHeader(ws.getRow(1));
    ws.addRow(["Peak hours", filtered.insights.peakHoursNote || ""]);
    ws.addRow(["Corridor / capacity", filtered.insights.corridorCongestion || ""]);
    ws.addRow([]);
    ws.addRow(["Origin", "Destination", "Tickets", "Avg fare", "Revenue"]);
    styleDetailHeader(ws.getRow(ws.rowCount));
    for (const r of filtered.insights.topRoutes || []) {
      ws.addRow([r.origin, r.destination, r.popularity, r.averageFare, r.revenue]);
    }
    ws.getColumn(1).width = 22;
    ws.getColumn(2).width = 22;
  }

  if (filtered.attendants?.length) {
    const ws = wb.addWorksheet("Attendants", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Operator ID", "Name", "Tickets", "Revenue"]);
    styleDetailHeader(ws.getRow(1));
    for (const a of filtered.attendants) {
      ws.addRow([a.operatorId, a.operator, a.tickets, a.revenue]);
    }
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 28;
  }

  if (filtered.buses?.length) {
    const ws = wb.addWorksheet("Buses", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Bus / plate", "Tickets", "Revenue", "Operating days", "Revenue / day"]);
    styleDetailHeader(ws.getRow(1));
    for (const b of filtered.buses) {
      ws.addRow([
        b.busLabel,
        b.tickets,
        b.revenue,
        b.operatingDays ?? "",
        b.revenuePerOperatingDay ?? "",
      ]);
    }
    ws.getColumn(1).width = 22;
  }

  if (filtered.routes?.length) {
    const ws = wb.addWorksheet("Routes", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(["Origin", "Destination", "Tickets", "Revenue", "Active buses", "Avg fare"]);
    styleDetailHeader(ws.getRow(1));
    for (const r of filtered.routes) {
      ws.addRow([r.origin, r.destination, r.tickets, r.revenue, r.activeBuses ?? "", r.avgFare ?? ""]);
    }
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 24;
  }

  if (!wb.worksheets.length) {
    const ws = wb.addWorksheet("Empty");
    ws.addRow(["No sections selected"]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * @param {Record<string, unknown>} filtered
 * @returns {string}
 */
function renderMasterCsv(filtered) {
  const rows = [];

  rows.push({
    section: "meta",
    key: "generatedAt",
    value: filtered.meta?.generatedAt,
    extra: "",
  });
  rows.push({
    section: "meta",
    key: "dateRangeStart",
    value: filtered.meta?.dateRange?.start,
    extra: "",
  });
  rows.push({
    section: "meta",
    key: "dateRangeEnd",
    value: filtered.meta?.dateRange?.end,
    extra: "",
  });
  rows.push({
    section: "meta",
    key: "timezone",
    value: filtered.meta?.timezone,
    extra: (filtered.includedSections || []).join("|"),
  });

  if (filtered.revenue) {
    rows.push({ section: "revenue", key: "totalRevenue", value: filtered.revenue.totalRevenue, extra: "" });
    rows.push({ section: "revenue", key: "totalTickets", value: filtered.revenue.totalTickets, extra: "" });
  }
  if (filtered.passenger) {
    rows.push({
      section: "passenger",
      key: "uniquePassengerIds",
      value: filtered.passenger.uniquePassengerIds,
      extra: "",
    });
    rows.push({
      section: "passenger",
      key: "totalTicketRows",
      value: filtered.passenger.totalTicketRows,
      extra: "",
    });
  }
  if (filtered.timeWindow) {
    for (const h of filtered.timeWindow.hourly) {
      rows.push({
        section: "timeWindow",
        key: `hour_${h.hour}`,
        value: h.tickets,
        extra: h.revenue,
      });
    }
  }
  if (filtered.insights) {
    rows.push({
      section: "insights",
      key: "peakHoursNote",
      value: filtered.insights.peakHoursNote,
      extra: "",
    });
    rows.push({
      section: "insights",
      key: "corridorCongestion",
      value: filtered.insights.corridorCongestion,
      extra: "",
    });
    for (const r of filtered.insights.topRoutes || []) {
      rows.push({
        section: "insights_route",
        key: `${r.origin}→${r.destination}`,
        value: r.popularity,
        extra: r.revenue,
      });
    }
    for (const line of filtered.insights.strategic?.bullets || []) {
      rows.push({ section: "insights_strategic", key: "recommendation", value: line, extra: "" });
    }
  }
  if (filtered.attendants) {
    for (const a of filtered.attendants) {
      rows.push({
        section: "attendant",
        key: String(a.operatorId),
        value: a.operator,
        extra: `${a.tickets}|${a.revenue}`,
      });
    }
  }
  if (filtered.buses) {
    for (const b of filtered.buses) {
      rows.push({
        section: "bus",
        key: b.busLabel,
        value: b.tickets,
        extra: b.revenue,
      });
    }
  }
  if (filtered.routes) {
    for (const r of filtered.routes) {
      rows.push({
        section: "route",
        key: r.route,
        value: r.tickets,
        extra: r.revenue,
      });
    }
  }

  const parser = new Parser({ fields: ["section", "key", "value", "extra"] });
  return "\ufeff" + parser.parse(rows);
}

module.exports = {
  renderMasterPdf,
  renderMasterXlsx,
  renderMasterCsv,
  manilaFooterDate,
};
