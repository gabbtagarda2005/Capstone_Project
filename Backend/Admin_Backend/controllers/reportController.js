"use strict";

const { generateMasterReportData, filterMasterReportByAreas } = require("../services/reportMasterAggregations");
const { renderMasterPdf, renderMasterXlsx, renderMasterCsv } = require("../services/reportMasterExport");

const ALLOWED_AREAS = new Set([
  "passenger",
  "attendants",
  "bus",
  "route",
  "insights",
  "timeWindowPickups",
  "revenue",
]);

function normalizeYmd(s) {
  const t = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

/**
 * @param {import('express').Request} req
 * @returns {{ error?: number; message?: string; selectedAreas?: string[]; startYmd?: string; endYmd?: string; body?: Record<string, unknown> }}
 */
function areasFromExportBody(body) {
  if (Array.isArray(body.selectedAreas)) return body.selectedAreas;
  const ts = body.toggleStates;
  if (Array.isArray(ts)) return ts;
  if (ts && typeof ts === "object" && !Array.isArray(ts)) {
    return Object.entries(ts)
      .filter(([, on]) => Boolean(on))
      .map(([k]) => k);
  }
  return [];
}

function parseMasterExportRequest(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const rawAreas = areasFromExportBody(body);
  const selectedAreas = rawAreas.map((a) => String(a).trim().toLowerCase()).filter((a) => ALLOWED_AREAS.has(a));

  const dr = body.dateRange && typeof body.dateRange === "object" ? body.dateRange : {};
  const startYmd = normalizeYmd(dr.start);
  const endYmd = normalizeYmd(dr.end);
  if (!startYmd || !endYmd) {
    return {
      error: 400,
      message:
        "dateRange.start and dateRange.end are required (YYYY-MM-DD, inclusive Asia/Manila calendar days). You may send `selectedAreas` or `toggleStates`.",
    };
  }
  if (startYmd > endYmd) {
    return { error: 400, message: "dateRange.start must be on or before dateRange.end" };
  }

  return { selectedAreas, startYmd, endYmd, body };
}

async function loadFilteredReport(startYmd, endYmd, selectedAreas) {
  const full = await generateMasterReportData({ startYmd, endYmd });
  const filtered = filterMasterReportByAreas(full, selectedAreas.length ? selectedAreas : [...ALLOWED_AREAS]);
  return { filtered, full };
}

/**
 * POST /api/reports/master-export
 * Body: { selectedAreas | toggleStates, format: 'pdf'|'csv'|'xlsx', dateRange: { start, end } }
 */
async function postMasterExport(req, res) {
  const parsed = parseMasterExportRequest(req);
  if (parsed.error) {
    return res.status(parsed.error).json({ error: parsed.message });
  }

  const format = String(parsed.body?.format || "pdf").toLowerCase();

  try {
    const load = await loadFilteredReport(parsed.startYmd, parsed.endYmd, parsed.selectedAreas);
    if (load.error) {
      return res.status(load.error).json({ error: load.message });
    }
    const { filtered, full } = load;

    const adminEmail = req.admin?.email || "admin";
    const companyName = process.env.COMPANY_DISPLAY_NAME || "Bukidnon Bus Company";
    const reportFooter =
      process.env.REPORTS_PDF_FOOTER || "© 2026 Bukidnon Bus Company — Fleet Management Division";

    let buffer;
    let contentType;
    let ext;
    if (format === "pdf") {
      buffer = await renderMasterPdf(filtered, {
        adminEmail,
        companyName,
        reportFooter,
        full,
        startYmd: parsed.startYmd,
        endYmd: parsed.endYmd,
      });
      contentType = "application/pdf";
      ext = "pdf";
    } else if (format === "xlsx") {
      buffer = await renderMasterXlsx(filtered, { full });
      contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      ext = "xlsx";
    } else if (format === "csv") {
      buffer = Buffer.from(renderMasterCsv(filtered), "utf8");
      contentType = "text/csv; charset=utf-8";
      ext = "csv";
    } else {
      return res.status(400).json({ error: "format must be pdf, csv, or xlsx" });
    }

    const fname = `BBC_master_report_${parsed.startYmd}_${parsed.endYmd}.${ext}`;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    return res.send(buffer);
  } catch (e) {
    const msg = e && e.message ? e.message : "master-export failed";
    return res.status(500).json({ error: msg });
  }
}

/**
 * POST /api/reports/export-excel — same payload as master export (minus format); branded workbook for demos.
 * Body: { selectedAreas | toggleStates, dateRange: { start, end } }
 */
async function postExportExcel(req, res) {
  const parsed = parseMasterExportRequest(req);
  if (parsed.error) {
    return res.status(parsed.error).json({ error: parsed.message });
  }

  try {
    const load = await loadFilteredReport(parsed.startYmd, parsed.endYmd, parsed.selectedAreas);
    if (load.error) {
      return res.status(load.error).json({ error: load.message });
    }
    const buffer = await renderMasterXlsx(load.filtered, { full: load.full });
    const fname = `Bukidnon_Transit_Report_${parsed.startYmd}_${parsed.endYmd}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    return res.send(buffer);
  } catch (e) {
    const msg = e && e.message ? e.message : "export-excel failed";
    return res.status(500).json({ error: msg });
  }
}

module.exports = {
  postMasterExport,
  postExportExcel,
  ALLOWED_AREAS,
};
