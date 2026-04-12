"use strict";

const path = require("path");
const fs = require("fs");
const pdfMake = require("pdfmake");
const { fetchDailyRevenueSeries } = require("./reportMasterAggregations");
const { renderRevenueLineChart, renderHourlyBarChart, renderRoutePieChart } = require("./reportPdfCharts");

const fontDir = path.join(__dirname, "..", "node_modules", "pdfmake", "fonts", "Roboto");
if (fs.existsSync(path.join(fontDir, "Roboto-Regular.ttf"))) {
  pdfMake.setFonts({
    Roboto: {
      normal: path.join(fontDir, "Roboto-Regular.ttf"),
      bold: path.join(fontDir, "Roboto-Medium.ttf"),
      italics: path.join(fontDir, "Roboto-Italic.ttf"),
      bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
    },
  });
}
pdfMake.setUrlAccessPolicy(() => false);

function formatPhp(n) {
  const x = Number(n) || 0;
  return `PHP ${x.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function manilaLongDate(iso) {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "long",
    });
  } catch {
    return iso;
  }
}

function bufToPdfImage(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return null;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const zebraLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#d1d5db",
  vLineColor: () => "#d1d5db",
  fillColor: (rowIndex) => {
    if (rowIndex === 0) return "#5EE396";
    return rowIndex % 2 === 0 ? "#f3f4f6" : "#ffffff";
  },
};

function th(cells) {
  return cells.map((t) => ({ text: t, style: "thCell" }));
}

/**
 * @param {Record<string, unknown>} filtered
 * @param {{
 *   adminEmail?: string;
 *   companyName?: string;
 *   reportFooter?: string;
 *   full?: Record<string, unknown>;
 *   startYmd?: string;
 *   endYmd?: string;
 * }} opts
 * @returns {Promise<Buffer>}
 */
async function buildMasterPdfBuffer(filtered, opts = {}) {
  const full = opts.full && typeof opts.full === "object" ? opts.full : filtered;
  const company = (opts.companyName || "BUKIDNON BUS COMPANY").toUpperCase();
  const reportFooter = (opts.reportFooter || "").trim();
  const adminEmail = opts.adminEmail || "admin";
  const startYmd = opts.startYmd || filtered.meta?.dateRange?.start || "";
  const endYmd = opts.endYmd || filtered.meta?.dateRange?.end || "";

  let dailySeries = [];
  if (startYmd && endYmd) {
    try {
      dailySeries = await fetchDailyRevenueSeries(startYmd, endYmd);
    } catch (e) {
      console.warn("[reportMasterPdfmake] daily series skipped:", e.message);
    }
  }

  const wantRevenueChart = Boolean(filtered.revenue) && dailySeries.length > 0;
  const wantHourlyChart = Boolean(filtered.timeWindow) && full.timeWindow?.hourly?.length;
  const wantPieChart = Boolean(filtered.routes?.length) && full.routes?.length;

  const [revenueBuf, hourlyBuf, pieBuf] = await Promise.all([
    wantRevenueChart ? renderRevenueLineChart(dailySeries) : Promise.resolve(null),
    wantHourlyChart ? renderHourlyBarChart(full.timeWindow.hourly) : Promise.resolve(null),
    wantPieChart ? renderRoutePieChart(full.routes) : Promise.resolve(null),
  ]);

  const metaLine = `Period ${startYmd} → ${endYmd} (Asia/Manila) · Generated ${manilaLongDate(filtered.meta?.generatedAt)} · Admin: ${adminEmail}`;
  const sections = (filtered.includedSections || []).join(", ") || "all selected";

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [42, 108, 42, 88],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#111827" },
    styles: {
      headerLeft: { fontSize: 13, bold: true, color: "#1f2937" },
      headerRightTitle: { fontSize: 10, bold: true, color: "#374151", alignment: "right" },
      headerRightSub: { fontSize: 8, color: "#6b7280", alignment: "right" },
      footerMuted: { fontSize: 8, italics: true, color: "#9ca3af" },
      footerPage: { fontSize: 9, bold: true, color: "#4b5563" },
      footerGen: { fontSize: 7, color: "#9ca3af" },
      footerLegal: { fontSize: 7, italics: true, color: "#9ca3af" },
      sectionHeader: { fontSize: 14, bold: true, color: "#111827", margin: [0, 16, 0, 8] },
      figCaption: { fontSize: 8, italics: true, color: "#6b7280" },
      thCell: { bold: true, color: "#ffffff", fontSize: 9 },
      tableCell: { fontSize: 8 },
      watermark: { fontSize: 40, bold: true, color: "#d1d5db", opacity: 0.18 },
    },

    background: () => ({
      stack: [
        { text: "", margin: [0, 260, 0, 0] },
        {
          text: "OFFICIAL BUKIDNON TRANSIT",
          style: "watermark",
          alignment: "center",
        },
      ],
    }),

    header(currentPage, pageCount, pageSize) {
      return {
        stack: [
          {
            columns: [
              { text: company, style: "headerLeft", width: "*" },
              {
                width: 220,
                stack: [
                  { text: "Official Operations Report", style: "headerRightTitle" },
                  { text: manilaLongDate(new Date().toISOString()), style: "headerRightSub" },
                  { text: `Sections: ${sections}`, style: "headerRightSub" },
                ],
                alignment: "right",
              },
            ],
            margin: [42, 28, 42, 8],
          },
          {
            canvas: [
              {
                type: "line",
                x1: 42,
                y1: 0,
                x2: pageSize.width - 42,
                y2: 0,
                lineWidth: 0.75,
                lineColor: "#9ca3af",
              },
            ],
            margin: [0, 0, 0, 4],
          },
        ],
      };
    },

    footer(currentPage, pageCount) {
      return {
        stack: [
          {
            columns: [
              { text: "Confidential — internal use only", style: "footerMuted", width: "*" },
              {
                text: `Page ${currentPage} of ${pageCount}`,
                style: "footerPage",
                alignment: "right",
                width: "auto",
              },
            ],
          },
          { text: "Generated by Bukidnon Transit System", style: "footerGen", margin: [0, 4, 0, 0] },
          ...(reportFooter
            ? [{ text: reportFooter, style: "footerGen", margin: [0, 2, 0, 0] }]
            : []),
          {
            text: "This document is electronically generated. Any unauthorized alteration is strictly prohibited.",
            style: "footerLegal",
            margin: [0, 3, 0, 0],
          },
        ],
        margin: [42, 10, 42, 24],
      };
    },

    content: [],
  };

  const content = docDefinition.content;

  if (filtered.insights && full.insights) {
    content.push({ text: "EXECUTIVE SUMMARY", style: "sectionHeader" });
    content.push({
      table: {
        widths: ["*"],
        body: [
          [
            {
              stack: [
                { text: full.insights.peakHoursNote || "—", margin: [0, 0, 0, 6] },
                { text: full.insights.corridorCongestion || "—", fontSize: 9 },
              ],
              fillColor: "#e0f2fe",
              margin: [10, 10, 10, 10],
            },
          ],
        ],
      },
      layout: "noBorders",
    });
  }

  const strat = full.insights?.strategic;
  if (filtered.insights && strat) {
    content.push({
      text: "STRATEGIC RECOMMENDATIONS",
      style: "sectionHeader",
      pageBreak: "before",
    });
    content.push({
      text: "Management summary — automated analysis",
      fontSize: 10,
      bold: true,
      color: "#166534",
      margin: [0, 0, 0, 6],
    });
    if (strat.methodologyNote) {
      content.push({
        text: strat.methodologyNote,
        fontSize: 7,
        italics: true,
        color: "#6b7280",
        margin: [0, 0, 0, 10],
      });
    }
    const lines =
      strat.bullets?.length > 0
        ? strat.bullets
        : ["Not enough differentiated data in this range for route or bus comparisons."];
    for (const line of lines) {
      content.push({
        table: {
          widths: ["*"],
          body: [
            [
              {
                text: line,
                margin: [12, 10, 12, 10],
                fontSize: 9,
                color: "#14532d",
                fillColor: "#E8F5E9",
              },
            ],
          ],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 8],
      });
    }
  }

  const anyChart = revenueBuf || hourlyBuf || pieBuf;
  if (anyChart) {
    content.push({
      text: "VISUAL ANALYTICS",
      style: "sectionHeader",
      pageBreak: content.length ? "before" : undefined,
    });
    if (revenueBuf) {
      const img = bufToPdfImage(revenueBuf);
      if (img) {
        content.push({ image: img, width: 480, alignment: "center", margin: [0, 4, 0, 2] });
        content.push({
          text: `Figure 1: Daily revenue trend (${startYmd} – ${endYmd})`,
          style: "figCaption",
          alignment: "center",
        });
      }
    }
    if (hourlyBuf) {
      const img = bufToPdfImage(hourlyBuf);
      if (img) {
        content.push({ text: "", margin: [0, 14, 0, 0] });
        content.push({ image: img, width: 480, alignment: "center", margin: [0, 4, 0, 2] });
        content.push({
          text: "Figure 2: Passenger volume by hour (time-window pickups, Manila)",
          style: "figCaption",
          alignment: "center",
        });
      }
    }
    if (pieBuf) {
      const img = bufToPdfImage(pieBuf);
      if (img) {
        content.push({ text: "", margin: [0, 14, 0, 0], pageBreak: "before" });
        content.push({ image: img, width: 480, alignment: "center", margin: [0, 4, 0, 2] });
        content.push({
          text: "Figure 3: Route popularity (share of tickets)",
          style: "figCaption",
          alignment: "center",
        });
      }
    }
  }

  if (filtered.revenue && filtered.passenger) {
    content.push({
      text: "FINANCIAL VS. VOLUME",
      style: "sectionHeader",
      pageBreak: content.length > 6 ? "before" : undefined,
    });
    content.push({
      table: {
        widths: ["*", "*", "*"],
        body: [
          th(["Metric", "Revenue / volume", "Notes"]),
          [
            { text: "Ticket revenue (range)", style: "tableCell" },
            { text: formatPhp(filtered.revenue.totalRevenue), style: "tableCell" },
            { text: `${filtered.revenue.totalTickets} ticket rows`, style: "tableCell" },
          ],
          [
            { text: "Unique passengers", style: "tableCell" },
            { text: String(filtered.passenger.uniquePassengerIds), style: "tableCell" },
            { text: `${filtered.passenger.totalTicketRows} rows in range`, style: "tableCell" },
          ],
        ],
      },
      layout: zebraLayout,
    });
  }

  content.push({
    text: "DETAILED TABLES",
    style: "sectionHeader",
    pageBreak: content.length > 4 ? "before" : undefined,
  });

  if (filtered.revenue) {
    content.push({ text: "Revenue (totals)", fontSize: 10, bold: true, margin: [0, 0, 0, 4] });
    content.push({
      table: {
        widths: ["*", "auto"],
        body: [
          th(["Metric", "Value"]),
          [
            { text: "Total revenue", style: "tableCell" },
            { text: formatPhp(filtered.revenue.totalRevenue), style: "tableCell" },
          ],
          [
            { text: "Tickets sold", style: "tableCell" },
            { text: String(filtered.revenue.totalTickets), style: "tableCell" },
          ],
        ],
      },
      layout: zebraLayout,
      margin: [0, 0, 0, 12],
    });
  }

  if (filtered.passenger) {
    content.push({ text: "Passenger reports", fontSize: 10, bold: true, margin: [0, 0, 0, 4] });
    content.push({
      table: {
        widths: ["*", "auto"],
        body: [
          th(["Metric", "Value"]),
          [
            { text: "Unique passenger IDs", style: "tableCell" },
            { text: String(filtered.passenger.uniquePassengerIds), style: "tableCell" },
          ],
          [
            { text: "Ticket rows", style: "tableCell" },
            { text: String(filtered.passenger.totalTicketRows), style: "tableCell" },
          ],
        ],
      },
      layout: zebraLayout,
      margin: [0, 0, 0, 12],
    });
  }

  if (filtered.timeWindow) {
    content.push({ text: "Time-window (hourly, Manila)", fontSize: 10, bold: true, margin: [0, 0, 0, 4] });
    const body = [th(["Hour", "Tickets", "Revenue"])];
    for (const h of filtered.timeWindow.hourly) {
      if (h.tickets === 0 && h.revenue === 0) continue;
      body.push([
        { text: `${String(h.hour).padStart(2, "0")}:00`, style: "tableCell" },
        { text: String(h.tickets), style: "tableCell" },
        { text: formatPhp(h.revenue), style: "tableCell" },
      ]);
    }
    if (body.length < 2) body.push([{ text: "No hourly activity", colSpan: 3 }, {}, {}]);
    content.push({ table: { widths: [60, 70, "*"], body }, layout: zebraLayout, margin: [0, 0, 0, 12] });
  }

  if (filtered.insights?.topRoutes?.length) {
    content.push({ text: "Top routes", fontSize: 10, bold: true, margin: [0, 0, 0, 4] });
    const body = [th(["Origin", "Destination", "Tickets", "Revenue"])];
    for (const r of filtered.insights.topRoutes) {
      body.push([
        { text: r.origin, style: "tableCell" },
        { text: r.destination, style: "tableCell" },
        { text: String(r.popularity), style: "tableCell" },
        { text: formatPhp(r.revenue), style: "tableCell" },
      ]);
    }
    content.push({ table: { widths: ["*", "*", 55, 70], body }, layout: zebraLayout, margin: [0, 0, 0, 12] });
  }

  if (filtered.attendants?.length) {
    content.push({ text: "Bus attendants", fontSize: 10, bold: true, margin: [0, 0, 0, 4] });
    const body = [th(["Name", "ID", "Tickets", "Revenue"])];
    for (const a of filtered.attendants.slice(0, 28)) {
      body.push([
        { text: a.operator, style: "tableCell" },
        { text: String(a.operatorId), style: "tableCell" },
        { text: String(a.tickets), style: "tableCell" },
        { text: formatPhp(a.revenue), style: "tableCell" },
      ]);
    }
    content.push({ table: { widths: ["*", 45, 45, 65], body }, layout: zebraLayout, margin: [0, 0, 0, 12] });
  }

  if (filtered.buses?.length) {
    content.push({ text: "Bus activity", fontSize: 10, bold: true, margin: [0, 0, 0, 4] });
    const body = [th(["Bus / plate", "Tickets", "Revenue"])];
    for (const b of filtered.buses.slice(0, 25)) {
      body.push([
        { text: b.busLabel, style: "tableCell" },
        { text: String(b.tickets), style: "tableCell" },
        { text: formatPhp(b.revenue), style: "tableCell" },
      ]);
    }
    content.push({ table: { widths: ["*", 55, 70], body }, layout: zebraLayout, margin: [0, 0, 0, 12] });
  }

  if (filtered.routes?.length) {
    content.push({ text: "Route report (origin → destination)", fontSize: 10, bold: true, margin: [0, 0, 0, 4] });
    const body = [th(["Route", "Tickets", "Revenue"])];
    for (const r of filtered.routes.slice(0, 30)) {
      body.push([
        { text: r.route, style: "tableCell" },
        { text: String(r.tickets), style: "tableCell" },
        { text: formatPhp(r.revenue), style: "tableCell" },
      ]);
    }
    content.push({ table: { widths: ["*", 50, 70], body }, layout: zebraLayout, margin: [0, 0, 0, 12] });
  }

  if (content.length === 0) {
    content.push({ text: "No sections selected for this export.", margin: [0, 20, 0, 0] });
  }

  content.push({ text: metaLine, fontSize: 7, color: "#6b7280", margin: [0, 20, 0, 10] });

  content.push({
    text: "Certified by",
    bold: true,
    margin: [0, 28, 0, 6],
  });
  content.push({
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.75, lineColor: "#374151" }],
    margin: [0, 0, 0, 4],
  });
  content.push({
    text: "Authorized signatory — Operations (Bukidnon Bus Company)",
    fontSize: 8,
    color: "#6b7280",
  });

  const pdfDoc = pdfMake.createPdf(docDefinition);
  return pdfDoc.getBuffer();
}

module.exports = { buildMasterPdfBuffer };
