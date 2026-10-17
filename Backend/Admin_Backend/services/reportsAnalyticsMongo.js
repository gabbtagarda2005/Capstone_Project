/**
 * Build the same payload shape as GET /api/reports/analytics (MySQL path)
 * from Mongo `issued_ticket_records` when SQL pool is unavailable.
 */
const mongoose = require("mongoose");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const { manilaWallClockParts, addDaysYmd } = require("./manilaTime");

const MONTHLY_PROFIT_GOAL = 100_000;
const TOMORROW_GROWTH = 0.08;

function hubStatus(rank) {
  if (rank === 0) return "Primary Hub";
  if (rank === 1) return "Secondary Hub";
  return "Intermediate Stop";
}

/** Thin alias kept so every existing call site in this file (`manilaWallClock(...)`) is unchanged —
 *  the actual Asia/Manila wall-clock computation now lives once, in services/manilaTime.js, instead
 *  of being reimplemented here. */
const manilaWallClock = manilaWallClockParts;

/** Groups a normalized startLocation key to its two decimal places. */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Collapses formatting differences ("Malaybalay Terminal" / "malaybalay  terminal") into the same
 *  grouping key, without merging genuinely different stop names. */
function normalizeLocationKey(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Groups a (possibly pre-filtered) set of ticket docs by normalized pickup location, ranks by
 * ticket count, and returns the top `limit` with a sharePct relative to `totalForShare` (pass the
 * true all-time/period ticket total, not docsSubset.length, so the percentage means "share of all
 * passengers in that period" rather than "share of the 5 shown here").
 */
function computeTopPickups(docsSubset, totalForShare, limit = 5) {
  const counts = new Map(); // normalized key -> ticket count
  const labelVotes = new Map(); // normalized key -> Map(original label -> occurrences)
  for (const doc of docsSubset) {
    const raw = (doc.startLocation || "").trim() || "—";
    const key = normalizeLocationKey(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!labelVotes.has(key)) labelVotes.set(key, new Map());
    const votes = labelVotes.get(key);
    votes.set(raw, (votes.get(raw) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, ticketCount], idx) => {
      const votes = [...labelVotes.get(key).entries()].sort((a, b) => b[1] - a[1]);
      return {
        location: votes[0][0],
        ticketCount,
        revenue: 0,
        sharePct: Math.round((ticketCount / (totalForShare || 1)) * 1000) / 10,
        status: hubStatus(idx),
      };
    });
}

/** current vs. previous-period comparison, honest about missing/zero prior data instead of
 *  dividing by zero or implying a trend that isn't there. */
function computeTrend(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0 && cur === 0) return { current: cur, previous: prev, pctChangePct: null, direction: "flat" };
  if (prev === 0) return { current: cur, previous: prev, pctChangePct: null, direction: "no_prior_data" };
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  return { current: cur, previous: prev, pctChangePct: pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

/** Walks back `count` calendar months from (year, month) and returns their "YYYY-MM" keys —
 *  used to look up completed-month revenue for the forecast, correctly across a year boundary. */
function completedMonthKeysBefore(year, month, count) {
  const keys = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i++) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

/** Monthly revenue estimate: average of the last `lookback` completed calendar months that
 *  actually have data (strictly before the current month). Returns an honest "unavailable" result
 *  — never a fabricated number — when there isn't at least one completed month of history. */
function computeMonthlyForecast(monthlyByYearMap, year, month, lookback = 3) {
  const keys = completedMonthKeysBefore(year, month, lookback);
  const rows = keys.map((k) => monthlyByYearMap.get(k)).filter(Boolean);
  if (rows.length === 0) {
    return { available: false, estimatedRevenue: null, reason: "Insufficient historical data for a reliable forecast" };
  }
  return {
    available: true,
    estimatedRevenue: round2(rows.reduce((s, v) => s + v.revenue, 0) / rows.length),
    method: `Average of the last ${rows.length} completed month(s) of actual revenue`,
    basedOnMonths: rows.length,
  };
}

/** Yearly revenue estimate: average of completed prior years if any exist; otherwise, given at
 *  least 14 days of current-year data, a simple extrapolation from year-to-date revenue; otherwise
 *  an honest "unavailable" result. */
function computeYearlyForecast(yearlyMap, year, ytdRevenue, daysElapsedInYear) {
  const priorYears = [...yearlyMap.entries()].filter(([y]) => y < year);
  if (priorYears.length > 0) {
    const avg = priorYears.reduce((s, [, v]) => s + v.revenue, 0) / priorYears.length;
    return {
      available: true,
      estimatedRevenue: round2(avg),
      method: `Average of ${priorYears.length} completed prior year(s) of actual revenue`,
      basedOnYears: priorYears.length,
    };
  }
  if (daysElapsedInYear >= 14 && ytdRevenue > 0) {
    return {
      available: true,
      estimatedRevenue: round2((ytdRevenue / daysElapsedInYear) * 365),
      method: `Extrapolated from ${daysElapsedInYear} days of year-to-date revenue (no completed prior year yet)`,
      basedOnDays: daysElapsedInYear,
    };
  }
  return { available: false, estimatedRevenue: null, reason: "Insufficient historical data for a reliable forecast" };
}

/**
 * @param {{startDate?: string, endDate?: string, busNumber?: string, route?: string}} filters
 *   startDate/endDate are YYYY-MM-DD (Manila calendar days). busNumber is an exact match against
 *   IssuedTicketRecord.busNumber. route is the "A → B" label produced elsewhere in this file
 *   (topRoutes/allRoutes), split back into startLocation/destination for an exact match.
 */
async function buildReportsAnalyticsFromMongo(filters = {}) {
  if (mongoose.connection.readyState !== 1) return null;

  const query = {};
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(`${filters.startDate}T00:00:00+08:00`);
    if (filters.endDate) query.createdAt.$lte = new Date(`${filters.endDate}T23:59:59.999+08:00`);
  }
  if (filters.busNumber) query.busNumber = filters.busNumber;
  if (filters.route) {
    const parts = String(filters.route).split(/\s*→\s*/);
    if (parts.length === 2 && parts[0] && parts[1]) {
      query.startLocation = parts[0];
      query.destination = parts[1];
    }
  }

  const docs = await IssuedTicketRecord.find(query)
    .select({ startLocation: 1, destination: 1, fare: 1, createdAt: 1, busNumber: 1, issuedByName: 1, issuerSub: 1, passengerId: 1 })
    .lean();

  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const mNow = manilaWallClock(now);
  const todayYmd = mNow.ymd;
  const curMonth = mNow.month;
  const curYear = mNow.year;

  let totalRev = 0;
  let totalTickets = 0;
  const hourlyToday = Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: 0, revenue: 0 }));
  const dailyMap = new Map();
  const monthlyMap = new Map();
  const yearlyMap = new Map();
  /** Unlike monthlyMap (keyed by month-of-year 1-12, ambiguous across year boundaries), this is
   *  keyed "YYYY-MM" — needed for the revenue trend/forecast below, which must not conflate e.g.
   *  May of one year with May of another once the system has more than a year of history. */
  const monthlyByYearMap = new Map();
  const routeMap = new Map();
  const busMap = new Map();
  const opMap = new Map();
  const opTodayMap = new Map();
  /** Retains each doc's already-computed Manila wall-clock parts, so the pickup-location and
   *  peak-period breakdowns below can filter by period without recomputing manilaWallClock. */
  const docsWithMw = [];

  for (const doc of docs) {
    const fare = Number(doc.fare) || 0;
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
    if (!createdAt || !Number.isFinite(createdAt.getTime())) continue;

    totalRev += fare;
    totalTickets += 1;

    const m = manilaWallClock(createdAt);
    docsWithMw.push({ doc, mw: m });
    if (m.ymd === todayYmd) {
      hourlyToday[m.hour].tickets += 1;
      hourlyToday[m.hour].revenue += fare;
    }

    if (!dailyMap.has(m.ymd)) dailyMap.set(m.ymd, { tickets: 0, revenue: 0 });
    const dAgg = dailyMap.get(m.ymd);
    dAgg.tickets += 1;
    dAgg.revenue += fare;

    if (!monthlyMap.has(m.month)) monthlyMap.set(m.month, { tickets: 0, revenue: 0 });
    const moAgg = monthlyMap.get(m.month);
    moAgg.tickets += 1;
    moAgg.revenue += fare;

    if (!yearlyMap.has(m.year)) yearlyMap.set(m.year, { tickets: 0, revenue: 0 });
    const yAgg = yearlyMap.get(m.year);
    yAgg.tickets += 1;
    yAgg.revenue += fare;

    const ymKey = `${m.year}-${String(m.month).padStart(2, "0")}`;
    if (!monthlyByYearMap.has(ymKey)) monthlyByYearMap.set(ymKey, { tickets: 0, revenue: 0 });
    const ymAgg = monthlyByYearMap.get(ymKey);
    ymAgg.tickets += 1;
    ymAgg.revenue += fare;

    const rKey = `${(doc.startLocation || "").trim()}|||${(doc.destination || "").trim()}`;
    if (!routeMap.has(rKey)) routeMap.set(rKey, { start: doc.startLocation, dest: doc.destination, tickets: 0, revenue: 0 });
    const rAgg = routeMap.get(rKey);
    rAgg.tickets += 1;
    rAgg.revenue += fare;

    const busLabel = (doc.busNumber && String(doc.busNumber).trim()) || "Unassigned";
    if (!busMap.has(busLabel)) busMap.set(busLabel, { tickets: 0, revenue: 0 });
    const bAgg = busMap.get(busLabel);
    bAgg.tickets += 1;
    bAgg.revenue += fare;

    const sub = String(doc.issuerSub || "");
    if (!opMap.has(sub))
      opMap.set(sub, { tickets: 0, revenue: 0, name: (doc.issuedByName || "").trim() || `Attendant ${sub || "?"}` });
    const oAgg = opMap.get(sub);
    oAgg.tickets += 1;
    oAgg.revenue += fare;
    if ((doc.issuedByName || "").trim()) oAgg.name = doc.issuedByName.trim();

    if (m.ymd === todayYmd) {
      if (!opTodayMap.has(sub)) opTodayMap.set(sub, { tickets: 0, revenue: 0, name: oAgg.name });
      const ot = opTodayMap.get(sub);
      ot.tickets += 1;
      ot.revenue += fare;
    }
  }

  const dailyLast14 = Array.from({ length: 14 }, (_, i) => {
    const anchor = new Date(now.getTime() - (13 - i) * 86400000);
    const key = manilaWallClock(anchor).ymd;
    const row = dailyMap.get(key);
    return { date: key, tickets: row ? row.tickets : 0, revenue: row ? row.revenue : 0 };
  });

  const monthlyThisYear = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const row = monthlyMap.get(m);
    return { month: m, label: monthLabels[i], tickets: row ? row.tickets : 0, revenue: row ? row.revenue : 0 };
  });

  const yearlyAll = [...yearlyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({ year, tickets: v.tickets, revenue: v.revenue }));

  // --- Dashboard-specific additions: Day/Month/Year passenger & revenue series, a real
  // period-over-period trend, and an honest (possibly "insufficient data") revenue forecast. ---

  const daysInCurMonth = new Date(curYear, curMonth, 0).getDate();
  const peakPassengersMonth = Array.from({ length: daysInCurMonth }, (_, i) => {
    const day = i + 1;
    const ymd = `${curYear}-${String(curMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const row = dailyMap.get(ymd);
    return { day, count: row ? row.tickets : 0 };
  });
  const revenueSeriesMonth = Array.from({ length: daysInCurMonth }, (_, i) => {
    const day = i + 1;
    const ymd = `${curYear}-${String(curMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const row = dailyMap.get(ymd);
    return { day, revenue: row ? row.revenue : 0 };
  });

  const peakPassengers = {
    day: hourlyToday.map((h) => ({ hour: h.hour, count: h.tickets })),
    month: peakPassengersMonth,
    year: monthlyThisYear.map((x) => ({ month: x.month, label: x.label, count: x.tickets })),
  };
  const revenueSeries = {
    day: hourlyToday.map((h) => ({ hour: h.hour, revenue: h.revenue })),
    month: revenueSeriesMonth,
    year: monthlyThisYear.map((x) => ({ month: x.month, label: x.label, revenue: x.revenue })),
  };

  const curYmKey = `${curYear}-${String(curMonth).padStart(2, "0")}`;
  const prevMonthKeys = completedMonthKeysBefore(curYear, curMonth, 1);
  const revenueTrend = {
    day: computeTrend(
      hourlyToday.reduce((s, h) => s + h.revenue, 0),
      dailyMap.get(addDaysYmd(todayYmd, -1))?.revenue ?? 0
    ),
    month: computeTrend(
      monthlyByYearMap.get(curYmKey)?.revenue ?? 0,
      monthlyByYearMap.get(prevMonthKeys[0])?.revenue ?? 0
    ),
    year: computeTrend(yearlyMap.get(curYear)?.revenue ?? 0, yearlyMap.get(curYear - 1)?.revenue ?? 0),
  };

  const forecastMonthly = computeMonthlyForecast(monthlyByYearMap, curYear, curMonth);
  const startOfYear = new Date(`${curYear}-01-01T00:00:00+08:00`);
  const daysElapsedInYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const forecastYearly = computeYearlyForecast(yearlyMap, curYear, yearlyMap.get(curYear)?.revenue ?? 0, daysElapsedInYear);
  const forecast = { monthly: forecastMonthly, yearly: forecastYearly };

  const ytdTickets = yearlyMap.get(curYear)?.tickets ?? 0;
  const ytdRevenue = yearlyMap.get(curYear)?.revenue ?? 0;

  const mtdRow = monthlyMap.get(curMonth);
  const monthlyRevenue = mtdRow?.revenue ?? 0;

  let todayRev = 0;
  let todayTickets = 0;
  for (const h of hourlyToday) {
    todayRev += h.revenue;
    todayTickets += h.tickets;
  }

  let last7Rev = 0;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(now);
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const row = dailyMap.get(key);
    if (row) last7Rev += row.revenue;
  }
  const avgDaily7 = last7Rev / 7;

  const baseForTomorrow = todayRev > 0 ? todayRev : avgDaily7;
  const tomorrowProjection = Math.round(baseForTomorrow * (1 + TOMORROW_GROWTH) * 100) / 100;
  const goalProgressPct =
    MONTHLY_PROFIT_GOAL > 0 ? Math.min(999, Math.round((monthlyRevenue / MONTHLY_PROFIT_GOAL) * 1000) / 10) : 0;

  const topPickupLocations = computeTopPickups(docs, totalTickets);

  const topRoutes = [...routeMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((r) => ({
      route: `${r.start} → ${r.dest}`,
      tickets: r.tickets,
      revenue: r.revenue,
    }));

  /** docsWithMw filtering replaces the old pickupsForFilter()/ad-hoc Map-building blocks — each of
   *  those re-parsed doc.createdAt and recomputed manilaWallClock per call; this reuses the parts
   *  already computed once in the main loop above, and routes every pickup breakdown through the
   *  same computeTopPickups() (location-name normalization + a real sharePct) instead of five
   *  near-duplicate hand-rolled groupings. */
  const topPickupsToday = computeTopPickups(
    docsWithMw.filter((x) => x.mw.ymd === todayYmd).map((x) => x.doc),
    totalTickets
  );
  const ms30 = now.getTime() - 29 * 86400000;
  const topPickupsLast30 = computeTopPickups(
    docs.filter((d) => {
      const t = d.createdAt ? new Date(d.createdAt).getTime() : NaN;
      return Number.isFinite(t) && t >= ms30;
    }),
    totalTickets
  );
  const topPickupsMtd = computeTopPickups(
    docsWithMw.filter((x) => x.mw.month === curMonth && x.mw.year === curYear).map((x) => x.doc),
    totalTickets
  );
  const topPickupsYtd = computeTopPickups(
    docsWithMw.filter((x) => x.mw.year === curYear).map((x) => x.doc),
    totalTickets
  );

  const peakHr = hourlyToday.reduce((a, b) => (b.tickets > a.tickets ? b : a), hourlyToday[0]);
  const peakHourPickups = topPickupsToday;

  let peakDayLabel = "";
  let peakDayTickets = 0;
  for (const [dk, agg] of dailyMap.entries()) {
    if (agg.tickets > peakDayTickets) {
      peakDayTickets = agg.tickets;
      peakDayLabel = dk;
    }
  }
  /** sharePct here is now relative to that peak period's own ticket total (previously hardcoded to
   *  0 for day/month/year peaks — same fix applied to peakMonthPickups/peakYearPickups below). */
  const peakDayPickups = peakDayLabel
    ? computeTopPickups(docsWithMw.filter((x) => x.mw.ymd === peakDayLabel).map((x) => x.doc), peakDayTickets)
    : [];

  let peakMonthNum = 0;
  let peakMonthTickets = 0;
  for (const [mo, agg] of monthlyMap.entries()) {
    if (agg.tickets > peakMonthTickets) {
      peakMonthTickets = agg.tickets;
      peakMonthNum = mo;
    }
  }
  const peakMonthPickups = peakMonthNum
    ? computeTopPickups(
        docsWithMw.filter((x) => x.mw.month === peakMonthNum && x.mw.year === curYear).map((x) => x.doc),
        peakMonthTickets
      )
    : [];

  let peakYearNum = 0;
  let peakYearTickets = 0;
  for (const [yr, agg] of yearlyMap.entries()) {
    if (agg.tickets > peakYearTickets) {
      peakYearTickets = agg.tickets;
      peakYearNum = yr;
    }
  }
  const peakYearPickups = peakYearNum
    ? computeTopPickups(docsWithMw.filter((x) => x.mw.year === peakYearNum).map((x) => x.doc), peakYearTickets)
    : [];

  const topBusesAll = [...busMap.entries()]
    .map(([busLabel, v]) => ({ busLabel, tickets: v.tickets, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const top5BusLabels = topBusesAll.slice(0, 5).map((b) => b.busLabel);
  const routesForTopBuses = [...routeMap.values()]
    .filter(() => true)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((r) => ({
      route: `${r.start} → ${r.dest}`,
      tickets: r.tickets,
      revenue: r.revenue,
    }));

  const allRoutes = [...routeMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 50)
    .map((r) => ({
      route: `${r.start} → ${r.dest}`,
      tickets: r.tickets,
      revenue: r.revenue,
    }));

  const morningPeak = hourlyToday.slice(7, 10).reduce((s, x) => s + x.tickets, 0);
  const eveningPeak = hourlyToday.slice(16, 19).reduce((s, x) => s + x.tickets, 0);
  let peakStart = 7;
  let peakEnd = 9;
  let peakLabel = "Malaybalay corridor (morning)";
  if (eveningPeak > morningPeak) {
    peakStart = 16;
    peakEnd = 18;
    peakLabel = "Valencia / Maramag (evening)";
  }
  const maxHourTickets = Math.max(...hourlyToday.map((x) => x.tickets), 0);

  const operatorsAllTime = [...opMap.entries()]
    .map(([issuerSub, v]) => ({
      operatorId: issuerSub,
      operator: v.name,
      tickets: v.tickets,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 100);

  const operatorsToday = [...opTodayMap.entries()]
    .map(([issuerSub, v]) => ({
      operatorId: issuerSub,
      operator: v.name,
      tickets: v.tickets,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20);

  const refunds = docs
    .filter((d) => /refund/i.test(d.passengerId || ""))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 25)
    .map((d) => ({
      id: String(d._id),
      passengerId: d.passengerId,
      route: `${d.startLocation} → ${d.destination}`,
      amount: Number(d.fare) || 0,
      createdAt: d.createdAt,
    }));

  const todayHourlyRevenueTotal = hourlyToday.reduce((s, x) => s + x.revenue, 0);

  return {
    generatedAt: new Date().toISOString(),
    constants: {
      monthlyProfitGoalPesos: MONTHLY_PROFIT_GOAL,
      tomorrowGrowthRate: TOMORROW_GROWTH,
    },
    executive: {
      totalRevenue: Math.round(totalRev * 100) / 100,
      totalTickets,
      todayRevenue: Math.round(todayRev * 100) / 100,
      todayTickets,
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
      monthlyProfitGoalPesos: MONTHLY_PROFIT_GOAL,
      goalProgressPct,
      tomorrowProjection,
      avgDailyLast7Days: Math.round(avgDaily7 * 100) / 100,
      ytdRevenue: Math.round(ytdRevenue * 100) / 100,
      ytdTickets,
      todayHourlyRevenueTotal: Math.round(todayHourlyRevenueTotal * 100) / 100,
    },
    topPickupLocations,
    topRoutes,
    hourlyToday,
    dailyLast14,
    monthlyThisYear,
    yearlyAll,
    /** Day/Month/Year tab data for the Admin Dashboard's passenger/revenue cards and the real
     *  (non-hardcoded) trend and forecast figures — see services/reportsAnalyticsMongo.js's header
     *  comment block above buildReportsAnalyticsFromMongo for the forecast method. */
    peakPassengers,
    revenueSeries,
    revenueTrend,
    forecast,
    topPickupsToday,
    topPickupsLast30,
    topPickupsMtd,
    topPickupsYtd,
    peakPickups: {
      hour: { slot: peakHr.hour, tickets: peakHr.tickets, locations: peakHourPickups },
      day: { date: peakDayLabel, tickets: peakDayTickets, locations: peakDayPickups },
      month: {
        month: peakMonthNum,
        label: peakMonthNum ? monthLabels[peakMonthNum - 1] : "",
        tickets: peakMonthTickets,
        locations: peakMonthPickups,
      },
      year: { year: peakYearNum, tickets: peakYearTickets, locations: peakYearPickups },
    },
    topBusesAll,
    routesForTopBuses: top5BusLabels.length ? routesForTopBuses : [],
    allRoutes,
    operatorsAllTime,
    operatorsToday,
    refunds,
    insights: {
      peakBoardingWindow: { startHour: peakStart, endHour: peakEnd },
      peakCorridorHint: peakLabel,
      routeDelaySentiment: "Stable",
      suggestedExtraBuses: maxHourTickets >= 5 ? 2 : maxHourTickets >= 2 ? 1 : 0,
    },
    ticketingDisabled: false,
    ticketingNote: "Analytics from Mongo issued_ticket_records (Asia/Manila calendar day).",
  };
}

module.exports = {
  buildReportsAnalyticsFromMongo,
  // Exported for unit testing (see scripts/_verify-dashboard-analytics.js) — pure functions, no
  // database access, safe to exercise with synthetic in-memory data.
  computeTopPickups,
  computeTrend,
  completedMonthKeysBefore,
  computeMonthlyForecast,
  computeYearlyForecast,
  normalizeLocationKey,
  round2,
};
