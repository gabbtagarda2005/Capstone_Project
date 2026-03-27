const express = require("express");
const { getMysqlPool } = require("../db/mysqlPool");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");

const MONTHLY_PROFIT_GOAL = 100_000;
const TOMORROW_GROWTH = 0.08;

function hubStatus(rank) {
  if (rank === 0) return "Primary Hub";
  if (rank === 1) return "Secondary Hub";
  return "Intermediate Stop";
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
   * Live financial & operational metrics from MySQL `tickets` (+ operator names).
   */
  router.get("/analytics", requireAdminJwt, async (_req, res) => {
    const pool = getMysqlPool();
    if (!pool) {
      return res.status(503).json({ error: "MySQL not configured — ticketing data unavailable" });
    }

    try {
      const [[totals]] = await pool.query(
        "SELECT COALESCE(SUM(fare), 0) AS revenue, COUNT(*) AS tickets FROM tickets"
      );

      const [[mtd]] = await pool.query(
        `SELECT COALESCE(SUM(fare), 0) AS revenue, COUNT(*) AS tickets
         FROM tickets
         WHERE YEAR(created_at) = YEAR(CURRENT_DATE()) AND MONTH(created_at) = MONTH(CURRENT_DATE())`
      );

      const [[today]] = await pool.query(
        `SELECT COALESCE(SUM(fare), 0) AS revenue, COUNT(*) AS tickets
         FROM tickets WHERE DATE(created_at) = CURDATE()`
      );

      const [[last7]] = await pool.query(
        `SELECT COALESCE(SUM(fare), 0) AS revenue, COUNT(*) AS tickets
         FROM tickets WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
      );

      const [[pickTotal]] = await pool.query("SELECT COUNT(*) AS c FROM tickets");
      const totalForShare = Number(pickTotal?.c) || 1;

      const [pickupRows] = await pool.query(
        `SELECT start_location AS location, COUNT(*) AS ticketCount, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets GROUP BY start_location ORDER BY ticketCount DESC LIMIT 5`
      );

      const topPickupLocations = pickupRows.map((row, idx) => ({
        location: row.location,
        ticketCount: row.ticketCount,
        revenue: Number(row.revenue),
        sharePct: Math.round((row.ticketCount / totalForShare) * 1000) / 10,
        status: hubStatus(idx),
      }));

      const [routeRows] = await pool.query(
        `SELECT start_location AS startLocation, destination,
                COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets
         GROUP BY start_location, destination
         ORDER BY revenue DESC
         LIMIT 10`
      );

      const topRoutes = routeRows.map((r) => ({
        route: `${r.startLocation} → ${r.destination}`,
        tickets: r.tickets,
        revenue: Number(r.revenue),
      }));

      const [hourlyRows] = await pool.query(
        `SELECT HOUR(created_at) AS hr, COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets WHERE DATE(created_at) = CURDATE()
         GROUP BY HOUR(created_at)`
      );
      const hourlyMap = new Map(hourlyRows.map((x) => [Number(x.hr), x]));
      const hourlyToday = Array.from({ length: 24 }, (_, h) => {
        const row = hourlyMap.get(h);
        return {
          hour: h,
          tickets: row ? Number(row.tickets) : 0,
          revenue: row ? Number(row.revenue) : 0,
        };
      });

      const [dailyRows] = await pool.query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
         GROUP BY DATE(created_at) ORDER BY d ASC`
      );
      const dailyMap = new Map(
        dailyRows.map((x) => {
          const dk =
            x.d instanceof Date ? x.d.toISOString().slice(0, 10) : String(x.d).slice(0, 10);
          return [dk, x];
        })
      );
      const dailyLast14 = Array.from({ length: 14 }, (_, i) => {
        const dt = new Date();
        dt.setDate(dt.getDate() - (13 - i));
        const key = dt.toISOString().slice(0, 10);
        const row = dailyMap.get(key);
        return {
          date: key,
          tickets: row ? Number(row.tickets) : 0,
          revenue: row ? Number(row.revenue) : 0,
        };
      });

      const [monthlyRows] = await pool.query(
        `SELECT MONTH(created_at) AS m, COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets WHERE YEAR(created_at) = YEAR(CURDATE()) GROUP BY MONTH(created_at)`
      );
      const moMap = new Map(monthlyRows.map((x) => [Number(x.m), x]));
      const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthlyThisYear = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const row = moMap.get(m);
        return {
          month: m,
          label: monthLabels[i],
          tickets: row ? Number(row.tickets) : 0,
          revenue: row ? Number(row.revenue) : 0,
        };
      });

      const [yearlyRows] = await pool.query(
        `SELECT YEAR(created_at) AS y, COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets GROUP BY YEAR(created_at) ORDER BY y ASC`
      );
      const yearlyAll = yearlyRows.map((x) => ({
        year: Number(x.y),
        tickets: Number(x.tickets),
        revenue: Number(x.revenue),
      }));

      const [[ytdRow]] = await pool.query(
        `SELECT COALESCE(SUM(fare), 0) AS revenue, COUNT(*) AS tickets FROM tickets
         WHERE YEAR(created_at) = YEAR(CURDATE())`
      );
      const ytdRevenue = Number(ytdRow?.revenue ?? 0);
      const ytdTickets = Number(ytdRow?.tickets ?? 0);

      async function topPickupsWhere(whereSql, params = []) {
        const [rows] = await pool.query(
          `SELECT start_location AS location, COUNT(*) AS ticketCount, COALESCE(SUM(fare), 0) AS revenue
           FROM tickets WHERE ${whereSql} GROUP BY start_location ORDER BY ticketCount DESC LIMIT 5`,
          params
        );
        return rows.map((row, idx) => ({
          location: row.location,
          ticketCount: row.ticketCount,
          revenue: Number(row.revenue),
          sharePct: Math.round((row.ticketCount / (Number(pickTotal?.c) || 1)) * 1000) / 10,
          status: hubStatus(idx),
        }));
      }

      const topPickupsToday = await topPickupsWhere("DATE(created_at) = CURDATE()");
      const topPickupsLast30 = await topPickupsWhere("created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)");
      const topPickupsMtd = await topPickupsWhere(
        "YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())"
      );
      const topPickupsYtd = await topPickupsWhere("YEAR(created_at) = YEAR(CURDATE())");

      const peakHr = hourlyToday.reduce((a, b) => (b.tickets > a.tickets ? b : a), hourlyToday[0]);
      const [peakHrLocRows] = await pool.query(
        `SELECT start_location AS location, COUNT(*) AS ticketCount FROM tickets
         WHERE DATE(created_at) = CURDATE() AND HOUR(created_at) = ?
         GROUP BY start_location ORDER BY ticketCount DESC LIMIT 5`,
        [peakHr.hour]
      );
      const peakHourPickups = peakHrLocRows.map((row, idx) => ({
        location: row.location,
        ticketCount: row.ticketCount,
        revenue: 0,
        sharePct: 0,
        status: hubStatus(idx),
      }));

      const [[maxDayRow]] = await pool.query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c FROM tickets
         WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
         GROUP BY DATE(created_at) ORDER BY c DESC LIMIT 1`
      );
      let peakDayPickups = [];
      let peakDayLabel = "";
      let peakDayTickets = 0;
      if (maxDayRow?.d) {
        peakDayTickets = Number(maxDayRow.c ?? 0);
        const dVal = maxDayRow.d instanceof Date ? maxDayRow.d.toISOString().slice(0, 10) : String(maxDayRow.d).slice(0, 10);
        peakDayLabel = dVal;
        const [pdr] = await pool.query(
          `SELECT start_location AS location, COUNT(*) AS ticketCount FROM tickets
           WHERE DATE(created_at) = ? GROUP BY start_location ORDER BY ticketCount DESC LIMIT 5`,
          [dVal]
        );
        peakDayPickups = pdr.map((row, idx) => ({
          location: row.location,
          ticketCount: row.ticketCount,
          revenue: 0,
          sharePct: 0,
          status: hubStatus(idx),
        }));
      }

      const [[maxMoRow]] = await pool.query(
        `SELECT MONTH(created_at) AS m, COUNT(*) AS c FROM tickets
         WHERE YEAR(created_at) = YEAR(CURDATE()) GROUP BY MONTH(created_at) ORDER BY c DESC LIMIT 1`
      );
      let peakMonthPickups = [];
      let peakMonthNum = 0;
      let peakMonthTickets = 0;
      if (maxMoRow?.m != null) {
        peakMonthNum = Number(maxMoRow.m);
        peakMonthTickets = Number(maxMoRow.c ?? 0);
        const [pmr] = await pool.query(
          `SELECT start_location AS location, COUNT(*) AS ticketCount FROM tickets
           WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = ?
           GROUP BY start_location ORDER BY ticketCount DESC LIMIT 5`,
          [peakMonthNum]
        );
        peakMonthPickups = pmr.map((row, idx) => ({
          location: row.location,
          ticketCount: row.ticketCount,
          revenue: 0,
          sharePct: 0,
          status: hubStatus(idx),
        }));
      }

      const [[maxYrRow]] = await pool.query(
        `SELECT YEAR(created_at) AS y, COUNT(*) AS c FROM tickets GROUP BY YEAR(created_at) ORDER BY c DESC LIMIT 1`
      );
      let peakYearPickups = [];
      let peakYearNum = 0;
      let peakYearTickets = 0;
      if (maxYrRow?.y != null) {
        peakYearNum = Number(maxYrRow.y);
        peakYearTickets = Number(maxYrRow.c ?? 0);
        const [pyr] = await pool.query(
          `SELECT start_location AS location, COUNT(*) AS ticketCount FROM tickets
           WHERE YEAR(created_at) = ? GROUP BY start_location ORDER BY ticketCount DESC LIMIT 5`,
          [peakYearNum]
        );
        peakYearPickups = pyr.map((row, idx) => ({
          location: row.location,
          ticketCount: row.ticketCount,
          revenue: 0,
          sharePct: 0,
          status: hubStatus(idx),
        }));
      }

      const [busRows] = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(bus_number), ''), 'Unassigned') AS busLabel,
                COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets GROUP BY busLabel ORDER BY revenue DESC`
      );
      const topBusesAll = busRows.map((r) => ({
        busLabel: r.busLabel,
        tickets: r.tickets,
        revenue: Number(r.revenue),
      }));

      const top5BusLabels = topBusesAll.slice(0, 5).map((b) => b.busLabel);
      let routesForTopBuses = [];
      if (top5BusLabels.length) {
        const ph = top5BusLabels.map(() => "?").join(",");
        const [rfb] = await pool.query(
          `SELECT CONCAT(start_location, ' → ', destination) AS route, COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
           FROM tickets WHERE COALESCE(NULLIF(TRIM(bus_number), ''), 'Unassigned') IN (${ph})
           GROUP BY start_location, destination ORDER BY revenue DESC LIMIT 10`,
          top5BusLabels
        );
        routesForTopBuses = rfb.map((r) => ({
          route: r.route,
          tickets: r.tickets,
          revenue: Number(r.revenue),
        }));
      }

      const [allRouteRows] = await pool.query(
        `SELECT start_location AS startLocation, destination,
                COUNT(*) AS tickets, COALESCE(SUM(fare), 0) AS revenue
         FROM tickets GROUP BY start_location, destination ORDER BY revenue DESC LIMIT 50`
      );
      const allRoutes = allRouteRows.map((r) => ({
        route: `${r.startLocation} → ${r.destination}`,
        tickets: r.tickets,
        revenue: Number(r.revenue),
      }));

      const sumRange = (a, b) => {
        let s = 0;
        for (let h = a; h <= b; h++) s += hourlyToday[h].tickets;
        return s;
      };
      const morningPeak = sumRange(7, 9);
      const eveningPeak = sumRange(16, 18);
      let peakStart = 7;
      let peakEnd = 9;
      let peakLabel = "Malaybalay corridor (morning)";
      if (eveningPeak > morningPeak) {
        peakStart = 16;
        peakEnd = 18;
        peakLabel = "Valencia / Maramag (evening)";
      }
      const maxHourTickets = Math.max(...hourlyToday.map((x) => x.tickets), 0);

      const [opsAll] = await pool.query(
        `SELECT t.issued_by_operator_id AS operatorId,
                COALESCE(
                  NULLIF(TRIM(MAX(t.issued_by_name)), ''),
                  TRIM(CONCAT_WS(' ', MAX(o.first_name), NULLIF(TRIM(MAX(o.middle_name)), ''), MAX(o.last_name)))
                ) AS operatorName,
                COUNT(*) AS tickets, COALESCE(SUM(t.fare), 0) AS revenue
         FROM tickets t
         LEFT JOIN bus_operators o ON o.operator_id = t.issued_by_operator_id
         GROUP BY t.issued_by_operator_id
         ORDER BY revenue DESC
         LIMIT 100`
      );

      const [opsToday] = await pool.query(
        `SELECT t.issued_by_operator_id AS operatorId,
                COALESCE(
                  NULLIF(TRIM(MAX(t.issued_by_name)), ''),
                  TRIM(CONCAT_WS(' ', MAX(o.first_name), NULLIF(TRIM(MAX(o.middle_name)), ''), MAX(o.last_name)))
                ) AS operatorName,
                COUNT(*) AS tickets, COALESCE(SUM(t.fare), 0) AS revenue
         FROM tickets t
         LEFT JOIN bus_operators o ON o.operator_id = t.issued_by_operator_id
         WHERE DATE(t.created_at) = CURDATE()
         GROUP BY t.issued_by_operator_id
         ORDER BY revenue DESC
         LIMIT 20`
      );

      const [refundRows] = await pool.query(
        `SELECT id, passenger_id AS passengerId, start_location AS startLocation, destination,
                fare, created_at AS createdAt
         FROM tickets
         WHERE UPPER(passenger_id) LIKE '%REFUND%'
         ORDER BY created_at DESC
         LIMIT 25`
      );

      const totalRev = Number(totals.revenue);
      const totalTickets = Number(totals.tickets);
      const monthlyRevenue = Number(mtd.revenue);
      const todayRev = Number(today.revenue);
      const todayTickets = Number(today.tickets);
      const last7Rev = Number(last7.revenue);
      const avgDaily7 = last7Rev / 7;

      const baseForTomorrow = todayRev > 0 ? todayRev : avgDaily7;
      const tomorrowProjection = Math.round(baseForTomorrow * (1 + TOMORROW_GROWTH) * 100) / 100;

      const goalProgressPct =
        MONTHLY_PROFIT_GOAL > 0
          ? Math.min(999, Math.round((monthlyRevenue / MONTHLY_PROFIT_GOAL) * 1000) / 10)
          : 0;

      const routeDelaysStable = true;

      const todayHourlyRevenueTotal = hourlyToday.reduce((s, x) => s + x.revenue, 0);

      res.json({
        generatedAt: new Date().toISOString(),
        constants: {
          monthlyProfitGoalPesos: MONTHLY_PROFIT_GOAL,
          tomorrowGrowthRate: TOMORROW_GROWTH,
        },
        executive: {
          totalRevenue: totalRev,
          totalTickets,
          todayRevenue: todayRev,
          todayTickets,
          monthlyRevenue,
          monthlyProfitGoalPesos: MONTHLY_PROFIT_GOAL,
          goalProgressPct,
          tomorrowProjection,
          avgDailyLast7Days: Math.round(avgDaily7 * 100) / 100,
          ytdRevenue,
          ytdTickets,
          todayHourlyRevenueTotal: Math.round(todayHourlyRevenueTotal * 100) / 100,
        },
        topPickupLocations,
        topRoutes,
        hourlyToday,
        dailyLast14,
        monthlyThisYear,
        yearlyAll,
        topPickupsToday,
        topPickupsLast30,
        topPickupsMtd,
        topPickupsYtd,
        peakPickups: {
          hour: {
            slot: peakHr.hour,
            tickets: peakHr.tickets,
            locations: peakHourPickups,
          },
          day: {
            date: peakDayLabel,
            tickets: peakDayTickets,
            locations: peakDayPickups,
          },
          month: {
            month: peakMonthNum,
            label: peakMonthNum ? monthLabels[peakMonthNum - 1] : "",
            tickets: peakMonthTickets,
            locations: peakMonthPickups,
          },
          year: {
            year: peakYearNum,
            tickets: peakYearTickets,
            locations: peakYearPickups,
          },
        },
        topBusesAll,
        routesForTopBuses,
        allRoutes,
        operatorsAllTime: opsAll.map((r) => ({
          operatorId: r.operatorId,
          operator: r.operatorName || `Attendant ${r.operatorId}`,
          tickets: r.tickets,
          revenue: Number(r.revenue),
        })),
        operatorsToday: opsToday.map((r) => ({
          operatorId: r.operatorId,
          operator: r.operatorName || `Attendant ${r.operatorId}`,
          tickets: r.tickets,
          revenue: Number(r.revenue),
        })),
        refunds: refundRows.map((r) => ({
          id: r.id,
          passengerId: r.passengerId,
          route: `${r.startLocation} → ${r.destination}`,
          amount: Number(r.fare),
          createdAt: r.createdAt,
        })),
        insights: {
          peakBoardingWindow: { startHour: peakStart, endHour: peakEnd },
          peakCorridorHint: peakLabel,
          routeDelaySentiment: routeDelaysStable ? "Stable" : "Elevated",
          suggestedExtraBuses: maxHourTickets >= 5 ? 2 : maxHourTickets >= 2 ? 1 : 0,
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createReportsRouter };
