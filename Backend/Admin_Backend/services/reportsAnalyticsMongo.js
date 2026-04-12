/**
 * Build the same payload shape as GET /api/reports/analytics (MySQL path)
 * from Mongo `issued_ticket_records` when SQL pool is unavailable.
 */
const mongoose = require("mongoose");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");

const MONTHLY_PROFIT_GOAL = 100_000;
const TOMORROW_GROWTH = 0.08;

function hubStatus(rank) {
  if (rank === 0) return "Primary Hub";
  if (rank === 1) return "Secondary Hub";
  return "Intermediate Stop";
}

function manilaWallClock(d) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const o = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    ymd: `${o.year}-${o.month}-${o.day}`,
    hour: parseInt(o.hour, 10) || 0,
    minute: parseInt(o.minute, 10) || 0,
    month: parseInt(o.month, 10) || 1,
    year: parseInt(o.year, 10) || new Date().getFullYear(),
  };
}

async function buildReportsAnalyticsFromMongo() {
  if (mongoose.connection.readyState !== 1) return null;

  const docs = await IssuedTicketRecord.find({})
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
  const pickupCount = new Map();
  const routeMap = new Map();
  const busMap = new Map();
  const opMap = new Map();
  const opTodayMap = new Map();

  for (const doc of docs) {
    const fare = Number(doc.fare) || 0;
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
    if (!createdAt || !Number.isFinite(createdAt.getTime())) continue;

    totalRev += fare;
    totalTickets += 1;

    const m = manilaWallClock(createdAt);
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

    const loc = (doc.startLocation || "").trim() || "—";
    pickupCount.set(loc, (pickupCount.get(loc) || 0) + 1);

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

  const topPickupLocations = [...pickupCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([location, ticketCount], idx) => ({
      location,
      ticketCount,
      revenue: 0,
      sharePct: Math.round((ticketCount / (totalTickets || 1)) * 1000) / 10,
      status: hubStatus(idx),
    }));

  const topRoutes = [...routeMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((r) => ({
      route: `${r.start} → ${r.dest}`,
      tickets: r.tickets,
      revenue: r.revenue,
    }));

  function pickupsForFilter(pred) {
    const m = new Map();
    for (const doc of docs) {
      const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
      if (!createdAt || !Number.isFinite(createdAt.getTime())) continue;
      const mw = manilaWallClock(createdAt);
      if (!pred(mw)) continue;
      const loc = (doc.startLocation || "").trim() || "—";
      m.set(loc, (m.get(loc) || 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([location, ticketCount], idx) => ({
        location,
        ticketCount,
        revenue: 0,
        sharePct: Math.round((ticketCount / (totalTickets || 1)) * 1000) / 10,
        status: hubStatus(idx),
      }));
  }

  const topPickupsToday = pickupsForFilter((mw) => mw.ymd === todayYmd);
  const ms30 = now.getTime() - 29 * 86400000;
  const topPickupsLast30 = (() => {
    const m = new Map();
    for (const doc of docs) {
      const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
      if (!createdAt || createdAt.getTime() < ms30) continue;
      const loc = (doc.startLocation || "").trim() || "—";
      m.set(loc, (m.get(loc) || 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([location, ticketCount], idx) => ({
        location,
        ticketCount,
        revenue: 0,
        sharePct: Math.round((ticketCount / (totalTickets || 1)) * 1000) / 10,
        status: hubStatus(idx),
      }));
  })();
  const topPickupsMtd = pickupsForFilter((mw) => mw.month === curMonth && mw.year === curYear);
  const topPickupsYtd = pickupsForFilter((mw) => mw.year === curYear);

  const peakHr = hourlyToday.reduce((a, b) => (b.tickets > a.tickets ? b : a), hourlyToday[0]);
  const peakHourPickups = topPickupsToday;

  let peakDayLabel = "";
  let peakDayTickets = 0;
  let peakDayPickups = [];
  for (const [dk, agg] of dailyMap.entries()) {
    if (agg.tickets > peakDayTickets) {
      peakDayTickets = agg.tickets;
      peakDayLabel = dk;
    }
  }
  if (peakDayLabel) {
    const m = new Map();
    for (const doc of docs) {
      const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
      if (!createdAt) continue;
      const mw = manilaWallClock(createdAt);
      if (mw.ymd !== peakDayLabel) continue;
      const loc = (doc.startLocation || "").trim() || "—";
      m.set(loc, (m.get(loc) || 0) + 1);
    }
    peakDayPickups = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([location, ticketCount], idx) => ({
        location,
        ticketCount,
        revenue: 0,
        sharePct: 0,
        status: hubStatus(idx),
      }));
  }

  let peakMonthNum = 0;
  let peakMonthTickets = 0;
  for (const [mo, agg] of monthlyMap.entries()) {
    if (agg.tickets > peakMonthTickets) {
      peakMonthTickets = agg.tickets;
      peakMonthNum = mo;
    }
  }
  let peakMonthPickups = [];
  if (peakMonthNum) {
    const m = new Map();
    for (const doc of docs) {
      const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
      if (!createdAt) continue;
      const mw = manilaWallClock(createdAt);
      if (mw.month !== peakMonthNum || mw.year !== curYear) continue;
      const loc = (doc.startLocation || "").trim() || "—";
      m.set(loc, (m.get(loc) || 0) + 1);
    }
    peakMonthPickups = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([location, ticketCount], idx) => ({
        location,
        ticketCount,
        revenue: 0,
        sharePct: 0,
        status: hubStatus(idx),
      }));
  }

  let peakYearNum = 0;
  let peakYearTickets = 0;
  for (const [yr, agg] of yearlyMap.entries()) {
    if (agg.tickets > peakYearTickets) {
      peakYearTickets = agg.tickets;
      peakYearNum = yr;
    }
  }
  let peakYearPickups = [];
  if (peakYearNum) {
    const m = new Map();
    for (const doc of docs) {
      const createdAt = doc.createdAt ? new Date(doc.createdAt) : null;
      if (!createdAt) continue;
      const mw = manilaWallClock(createdAt);
      if (mw.year !== peakYearNum) continue;
      const loc = (doc.startLocation || "").trim() || "—";
      m.set(loc, (m.get(loc) || 0) + 1);
    }
    peakYearPickups = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([location, ticketCount], idx) => ({
        location,
        ticketCount,
        revenue: 0,
        sharePct: 0,
        status: hubStatus(idx),
      }));
  }

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

module.exports = { buildReportsAnalyticsFromMongo };
