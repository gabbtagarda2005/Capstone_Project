const express = require("express");
const mongoose = require("mongoose");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");
const { buildReportsAnalyticsFromMongo } = require("../services/reportsAnalyticsMongo");
const { postMasterExport, postExportExcel } = require("../controllers/reportController");
const { buildDailyOperationsReport } = require("../services/dailyOperationsReport");
const {
  listDailyOpsSnapshots,
  downloadDailyOpsSnapshot,
} = require("./dailyOpsSnapshotsHandlers");

const MONTHLY_PROFIT_GOAL = 100_000;
const TOMORROW_GROWTH = 0.08;

function emptyAnalyticsPayload() {
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    generatedAt: new Date().toISOString(),
    constants: {
      monthlyProfitGoalPesos: MONTHLY_PROFIT_GOAL,
      tomorrowGrowthRate: TOMORROW_GROWTH,
    },
    executive: {
      totalRevenue: 0,
      totalTickets: 0,
      todayRevenue: 0,
      todayTickets: 0,
      monthlyRevenue: 0,
      monthlyProfitGoalPesos: MONTHLY_PROFIT_GOAL,
      goalProgressPct: 0,
      tomorrowProjection: 0,
      avgDailyLast7Days: 0,
      ytdRevenue: 0,
      ytdTickets: 0,
      todayHourlyRevenueTotal: 0,
    },
    topPickupLocations: [],
    topRoutes: [],
    hourlyToday: Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: 0, revenue: 0 })),
    dailyLast14: [],
    monthlyThisYear: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: monthLabels[i], tickets: 0, revenue: 0 })),
    yearlyAll: [],
    topPickupsToday: [],
    topPickupsLast30: [],
    topPickupsMtd: [],
    topPickupsYtd: [],
    peakPickups: {
      hour: { slot: 0, tickets: 0, locations: [] },
      day: { date: "", tickets: 0, locations: [] },
      month: { month: 0, label: "", tickets: 0, locations: [] },
      year: { year: 0, tickets: 0, locations: [] },
    },
    topBusesAll: [],
    routesForTopBuses: [],
    allRoutes: [],
    operatorsAllTime: [],
    operatorsToday: [],
    refunds: [],
    insights: {
      peakBoardingWindow: { startHour: 7, endHour: 9 },
      peakCorridorHint: "No ticketing data yet",
      routeDelaySentiment: "Stable",
      suggestedExtraBuses: 0,
    },
    ticketingDisabled: true,
    ticketingNote: "MongoDB is not connected or has no ticketing data yet.",
  };
}

function createReportsRouter() {
  const router = express.Router();

  router.get("/summary", (_req, res) => {
    res.json({
      message: "Use GET /api/reports/analytics for live dashboard data.",
      generatedAt: new Date().toISOString(),
    });
  });

  /**
   * Server-side master export (MySQL aggregates, Manila date range, PDF/CSV/Excel).
   * Body: { selectedAreas, format, dateRange: { start, end } }
   */
  router.post("/master-export", requireAdminJwt, postMasterExport);
  /** Branded Excel workbook (alias of master xlsx with Bukidnon_Transit_Report filename convention). */
  router.post("/export-excel", requireAdminJwt, postExportExcel);

  /**
   * Live financial & operational metrics from MongoDB ticketing (`issued_ticket_records`).
   */
  router.get("/analytics", requireAdminJwt, async (_req, res) => {
    try {
      if (mongoose.connection.readyState === 1) {
        const mongoPayload = await buildReportsAnalyticsFromMongo();
        if (mongoPayload) {
          return res.json(mongoPayload);
        }
      }
      return res.json(emptyAnalyticsPayload());
    } catch (e) {
      console.error("[reports/analytics] failed:", e.message || e);
      return res.status(500).json({ error: e.message || "analytics failed" });
    }
  });

  /**
   * Automated daily ops debrief: arrival precision (dispatch vs geofence), speed violations, crew activity, hub health.
   * Query: ?date=YYYY-MM-DD (defaults to today UTC)
   */
  router.get("/daily-operations", requireAdminJwt, async (req, res) => {
    try {
      const q = String(req.query.date || "").trim();
      const dateStr = q || new Date().toISOString().slice(0, 10);
      const rep = await buildDailyOperationsReport({ dateStr });
      if (!rep.ok) {
        return res.status(400).json({ error: rep.error || "Report failed" });
      }
      res.json(rep);
    } catch (e) {
      res.status(500).json({ error: e.message || "daily-operations failed" });
    }
  });

  router.get("/daily-ops-snapshots", requireAdminJwt, listDailyOpsSnapshots);
  router.get("/daily-ops-snapshots/download", requireAdminJwt, downloadDailyOpsSnapshot);

  return router;
}

module.exports = { createReportsRouter };
