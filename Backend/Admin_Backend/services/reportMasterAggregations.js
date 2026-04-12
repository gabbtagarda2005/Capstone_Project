"use strict";

const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const { buildStrategicInsightsAsync } = require("./reportMasterStrategicInsights");

/**
 * Master report aggregations from Mongo `issued_ticket_records`.
 * Hour-of-day buckets use Asia/Manila local time.
 */

function manilaYmdRangeToUtcBounds(startYmd, endYmd) {
  const start = new Date(`${startYmd}T00:00:00+08:00`);
  const end = new Date(`${endYmd}T23:59:59.999+08:00`);
  return [start, end];
}

/** @deprecated alias — kept for callers importing the old SQL helper name */
function manilaYmdRangeToUtcSqlBounds(startYmd, endYmd) {
  const [a, b] = manilaYmdRangeToUtcBounds(startYmd, endYmd);
  const fmt = (dt) => {
    const iso = dt.toISOString();
    return iso.slice(0, 19).replace("T", " ");
  };
  return [fmt(a), fmt(b)];
}

function manilaHour(d) {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    hour12: false,
  }).format(d);
  return parseInt(h, 10) || 0;
}

function manilaDateKey(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * @param {{ startYmd: string; endYmd: string }} range
 */
async function generateMasterReportData({ startYmd, endYmd }) {
  const [from, to] = manilaYmdRangeToUtcBounds(startYmd, endYmd);
  const docs = await IssuedTicketRecord.find({ createdAt: { $gte: from, $lte: to } }).lean();

  const uniqPass = new Set(docs.map((d) => String(d.passengerId || ""))).size;
  let totalRev = 0;
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: 0, revenue: 0 }));
  const routeTopMap = new Map();
  const routeAllMap = new Map();
  const attendantMap = new Map();
  const busMap = new Map();

  for (const t of docs) {
    const fare = Number(t.fare) || 0;
    totalRev += fare;
    const ca = t.createdAt ? new Date(t.createdAt) : null;
    if (!ca || Number.isNaN(ca.getTime())) continue;
    const hr = manilaHour(ca);
    if (hr >= 0 && hr < 24) {
      hourly[hr].tickets += 1;
      hourly[hr].revenue += fare;
    }
    const o = String(t.startLocation || "").trim();
    const d = String(t.destination || t.destinationLocation || "").trim();
    const rk = `${o}|||${d}`;
    if (!routeTopMap.has(rk)) {
      routeTopMap.set(rk, { origin: o, destination: d, popularity: 0, revenue: 0, fareSum: 0 });
    }
    const rt = routeTopMap.get(rk);
    rt.popularity += 1;
    rt.revenue += fare;
    rt.fareSum += fare;
    if (!routeAllMap.has(rk)) {
      routeAllMap.set(rk, { origin: o, destination: d, tickets: 0, revenue: 0, fareSum: 0, buses: new Set() });
    }
    const ra = routeAllMap.get(rk);
    ra.tickets += 1;
    ra.revenue += fare;
    ra.fareSum += fare;
    const bn = (t.busNumber && String(t.busNumber).trim()) || "";
    if (bn) ra.buses.add(bn.trim());

    const sub = String(t.issuerSub || "");
    const opName = (t.issuedByName && String(t.issuedByName).trim()) || `Attendant ${sub || "?"}`;
    if (!attendantMap.has(sub)) attendantMap.set(sub, { operatorId: sub, operatorName: opName, tickets: 0, revenue: 0 });
    const am = attendantMap.get(sub);
    am.tickets += 1;
    am.revenue += fare;
    if (t.issuedByName && String(t.issuedByName).trim()) am.operatorName = String(t.issuedByName).trim();

    const bl = bn || "Unassigned";
    if (!busMap.has(bl)) busMap.set(bl, { busLabel: bl, tickets: 0, revenue: 0, days: new Set() });
    const bm = busMap.get(bl);
    bm.tickets += 1;
    bm.revenue += fare;
    bm.days.add(manilaDateKey(ca));
  }

  const revRow = { totalRevenue: totalRev, totalTickets: docs.length };
  const passRow = { uniquePassengers: uniqPass, totalTickets: docs.length };
  const hourlyFilled = hourly;
  const peakHr = hourlyFilled.reduce((a, b) => (b.tickets > a.tickets ? b : a), hourlyFilled[0]);

  const totalTicketRows = Number(revRow.totalTickets ?? 0);

  const topRoutes = [...routeTopMap.values()]
    .map((r) => ({
      origin: r.origin,
      destination: r.destination,
      popularity: r.popularity,
      averageFare: r.popularity ? Math.round((r.fareSum / r.popularity) * 100) / 100 : 0,
      revenue: r.revenue,
    }))
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 12);

  let corridorCongestion =
    "Route load is relatively balanced across the sampled window for the top corridors.";
  if (topRoutes.length >= 2) {
    const top = topRoutes[0];
    const bot = topRoutes[topRoutes.length - 1];
    if (bot.popularity > 0 && top.popularity / bot.popularity >= 3) {
      corridorCongestion =
        `Corridor congestion: ${top.origin} → ${top.destination} (${top.popularity} tickets) vs ` +
        `${bot.origin} → ${bot.destination} (${bot.popularity}). Consider reassigning spare capacity from the lighter corridor.`;
    }
  }

  const attRows = [...attendantMap.values()]
    .map((a) => ({
      operatorId: a.operatorId,
      operatorName: a.operatorName,
      tickets: a.tickets,
      revenue: a.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 100);

  const busRows = [...busMap.values()]
    .map((b) => ({
      busLabel: b.busLabel,
      tickets: b.tickets,
      revenue: b.revenue,
      operatingDays: b.days.size || 1,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 100);

  const routeAllRows = [...routeAllMap.values()]
    .map((r) => ({
      origin: r.origin,
      destination: r.destination,
      tickets: r.tickets,
      revenue: r.revenue,
      avgFare: r.tickets ? r.fareSum / r.tickets : 0,
      activeBuses: r.buses.size,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 80);

  let strategic = null;
  try {
    strategic = await buildStrategicInsightsAsync(from, to, {
      busRows: busRows.map((r) => ({
        busLabel: r.busLabel,
        tickets: Number(r.tickets) || 0,
        revenue: Number(r.revenue) || 0,
        operatingDays: Number(r.operatingDays) || 1,
      })),
      routeAllRows: routeAllRows.map((r) => ({
        origin: r.origin,
        destination: r.destination,
        tickets: Number(r.tickets) || 0,
        revenue: Number(r.revenue) || 0,
        avgFare: Number(r.avgFare) || 0,
        activeBuses: Number(r.activeBuses) || 0,
      })),
      peakHr,
      totalTickets: totalTicketRows,
      topRoutes,
    });
  } catch (e) {
    console.warn("[reportMasterAggregations] strategic insights skipped:", e.message);
    strategic = null;
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      dateRange: { start: startYmd, end: endYmd },
      timezone: "Asia/Manila",
      mongoBoundsUtc: { from: from.toISOString(), to: to.toISOString() },
      note: "Aggregated from MongoDB collection issued_ticket_records (Asia/Manila hour buckets).",
    },
    revenue: {
      totalRevenue: Number(revRow.totalRevenue ?? 0),
      totalTickets: Number(revRow.totalTickets ?? 0),
    },
    passenger: {
      uniquePassengerIds: Number(passRow.uniquePassengers ?? 0),
      totalTicketRows: Number(passRow.totalTickets ?? 0),
    },
    timeWindow: {
      hourly: hourlyFilled,
      peakHour: peakHr.hour,
      peakHourTickets: peakHr.tickets,
    },
    insights: {
      topRoutes: topRoutes.slice(0, 5),
      corridorCongestion,
      peakHoursNote: `Busiest clock hour (Manila): ${String(peakHr.hour).padStart(2, "0")}:00 — ${peakHr.tickets} ticket(s).`,
      strategic,
    },
    attendants: attRows.map((r) => ({
      operatorId: r.operatorId,
      operator: r.operatorName || `Attendant ${r.operatorId}`,
      tickets: r.tickets,
      revenue: Number(r.revenue),
    })),
    buses: busRows.map((r) => ({
      busLabel: r.busLabel,
      tickets: r.tickets,
      revenue: Number(r.revenue),
      operatingDays: Number(r.operatingDays) || 1,
      revenuePerOperatingDay:
        Math.round(
          ((Number(r.revenue) || 0) / Math.max(1, Number(r.operatingDays) || 1)) * 100
        ) / 100,
    })),
    routes: routeAllRows.map((r) => ({
      origin: r.origin,
      destination: r.destination,
      route: `${r.origin} → ${r.destination}`,
      tickets: r.tickets,
      revenue: Number(r.revenue),
      avgFare: Math.round(Number(r.avgFare) * 100) / 100,
      activeBuses: Number(r.activeBuses) || 0,
    })),
  };
}

function filterMasterReportByAreas(data, selectedAreas) {
  const keys = ["revenue", "passenger", "insights", "timeWindowPickups", "attendants", "bus", "route"];
  const areas = new Set(selectedAreas.map((s) => String(s).toLowerCase()));
  const active = areas.size === 0 ? new Set(keys) : areas;
  const out = {
    meta: data.meta,
    includedSections: [...active],
  };
  if (active.has("revenue")) out.revenue = data.revenue;
  if (active.has("passenger")) out.passenger = data.passenger;
  if (active.has("insights")) out.insights = data.insights;
  if (active.has("timeWindowPickups")) out.timeWindow = data.timeWindow;
  if (active.has("attendants")) out.attendants = data.attendants;
  if (active.has("bus")) out.buses = data.buses;
  if (active.has("route")) out.routes = data.routes;
  return out;
}

function eachYmdInRange(startYmd, endYmd) {
  const out = [];
  const cur = new Date(`${startYmd}T12:00:00+08:00`);
  const end = new Date(`${endYmd}T12:00:00+08:00`);
  while (cur <= end) {
    out.push(manilaDateKey(cur));
    cur.setTime(cur.getTime() + 86400000);
  }
  return out;
}

/**
 * Daily buckets on Asia/Manila calendar dates (for revenue trend charts / PDF).
 * @param {string} startYmd
 * @param {string} endYmd
 */
async function fetchDailyRevenueSeries(startYmd, endYmd) {
  const [from, to] = manilaYmdRangeToUtcBounds(startYmd, endYmd);
  const docs = await IssuedTicketRecord.find({ createdAt: { $gte: from, $lte: to } }).select("fare createdAt").lean();
  const byDay = new Map();
  for (const t of docs) {
    const ca = t.createdAt ? new Date(t.createdAt) : null;
    if (!ca || Number.isNaN(ca.getTime())) continue;
    const dk = manilaDateKey(ca);
    if (!byDay.has(dk)) byDay.set(dk, { tickets: 0, revenue: 0 });
    const x = byDay.get(dk);
    x.tickets += 1;
    x.revenue += Number(t.fare) || 0;
  }
  return eachYmdInRange(startYmd, endYmd).map((date) => {
    const row = byDay.get(date);
    return {
      date,
      tickets: row ? row.tickets : 0,
      revenue: row ? row.revenue : 0,
    };
  });
}

module.exports = {
  generateMasterReportData,
  filterMasterReportByAreas,
  manilaYmdRangeToUtcSqlBounds,
  fetchDailyRevenueSeries,
};
