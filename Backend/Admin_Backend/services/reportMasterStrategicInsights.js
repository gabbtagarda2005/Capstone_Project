"use strict";

/**
 * Strategic insights for master reports — data from Mongo `issued_ticket_records`.
 */

const IssuedTicketRecord = require("../models/IssuedTicketRecord");

const UNDERSERVED_TICKET_THRESHOLD = 100;
const MIN_TICKETS_FOR_PROFITABLE_ROUTE = 5;
const EVENING_START_HR = 16;
const EVENING_END_HR_EXCLUSIVE = 19;
const TERMINAL_PM_SHARE = 0.3;
const TERMINAL_MIN_TOTAL = 20;
const TERMINAL_MIN_EVENING = 15;

function manilaHourFromDate(d) {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    hour12: false,
  }).format(d);
  return parseInt(h, 10) || 0;
}

async function fetchDominantRouteForBusMongo(fromDate, toDate, busLabel) {
  const bn = String(busLabel || "").trim();
  if (!bn || bn === "Unassigned") return null;
  const docs = await IssuedTicketRecord.find({
    createdAt: { $gte: fromDate, $lte: toDate },
    busNumber: bn,
  })
    .select("startLocation destination")
    .lean();
  const map = new Map();
  for (const t of docs) {
    const o = String(t.startLocation || "").trim();
    const dest = String(t.destination || t.destinationLocation || "").trim();
    const k = `${o}|||${dest}`;
    map.set(k, (map.get(k) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [k, n] of map) {
    if (n > bestN) {
      bestN = n;
      const [origin, destination] = k.split("|||");
      best = { origin, destination, count: n };
    }
  }
  return best;
}

async function fetchLocationEveningSharesMongo(fromDate, toDate) {
  const docs = await IssuedTicketRecord.find({
    createdAt: { $gte: fromDate, $lte: toDate },
  })
    .select("startLocation createdAt")
    .lean();
  const byLoc = new Map();
  for (const t of docs) {
    const loc = String(t.startLocation || "").trim();
    if (!loc) continue;
    if (!byLoc.has(loc)) byLoc.set(loc, { totalTickets: 0, eveningTickets: 0 });
    const x = byLoc.get(loc);
    x.totalTickets += 1;
    const ca = t.createdAt ? new Date(t.createdAt) : null;
    if (ca && !Number.isNaN(ca.getTime())) {
      const hr = manilaHourFromDate(ca);
      if (hr >= EVENING_START_HR && hr < EVENING_END_HR_EXCLUSIVE) x.eveningTickets += 1;
    }
  }
  const out = [];
  for (const [loc, v] of byLoc) {
    if (v.totalTickets >= TERMINAL_MIN_TOTAL) {
      out.push({ loc, totalTickets: v.totalTickets, eveningTickets: v.eveningTickets });
    }
  }
  out.sort((a, b) => b.eveningTickets - a.eveningTickets);
  return out;
}

function formatPhp(n) {
  const x = Number(n) || 0;
  return `PHP ${x.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {Date} fromDate inclusive UTC
 * @param {Date} toDate inclusive UTC
 * @param {{
 *   busRows: { busLabel: string; tickets: number; revenue: number; operatingDays: number }[];
 *   routeAllRows: { origin: string; destination: string; tickets: number; revenue: number; avgFare: number; activeBuses: number }[];
 *   peakHr: { hour: number; tickets: number };
 *   totalTickets: number;
 *   topRoutes: { origin: string; destination: string; popularity: number; averageFare: number; revenue: number }[];
 * }} ctx
 */
async function buildStrategicInsightsAsync(fromDate, toDate, ctx) {
  const { busRows, routeAllRows, peakHr, totalTickets, topRoutes } = ctx;

  const busesNorm = busRows.map((b) => ({
    busLabel: b.busLabel,
    tickets: Number(b.tickets) || 0,
    revenue: Number(b.revenue) || 0,
    operatingDays: Math.max(1, Number(b.operatingDays) || 1),
  }));

  const withEff = busesNorm.map((b) => ({
    ...b,
    revenuePerOperatingDay: b.revenue / b.operatingDays,
  }));

  const assignedBuses = withEff.filter((b) => b.busLabel !== "Unassigned");
  const rankPool = assignedBuses.length ? assignedBuses : withEff;
  const sortedByEff = [...rankPool].sort((a, b) => b.revenuePerOperatingDay - a.revenuePerOperatingDay);
  const topBus = sortedByEff[0] || null;

  let topPerformer = null;
  if (topBus) {
    let dominant = null;
    if (topBus.busLabel !== "Unassigned") {
      dominant = await fetchDominantRouteForBusMongo(fromDate, toDate, topBus.busLabel.trim());
    }
    const routePhrase = dominant ? `${dominant.origin} → ${dominant.destination}` : "multiple corridors";
    const effRounded = Math.round(topBus.revenuePerOperatingDay * 100) / 100;
    topPerformer = {
      busLabel: topBus.busLabel,
      dominantRoute: dominant ? routePhrase : null,
      revenuePerOperatingDay: effRounded,
      operatingDays: topBus.operatingDays,
      totalRevenue: topBus.revenue,
      passengers: topBus.tickets,
      usedUnassignedFallback: assignedBuses.length === 0,
      headline: `Top performing vehicle: ${topBus.busLabel} — ${formatPhp(
        effRounded
      )} average revenue per operating day on ${routePhrase} (${topBus.operatingDays} day(s) with sales in range).`,
    };
  }

  const underservedRoutes = [];
  const missingBusPlates = [];

  for (const r of routeAllRows) {
    const t = Number(r.tickets) || 0;
    const ab = Number(r.activeBuses) || 0;
    const name = `${r.origin} → ${r.destination}`;
    if (t > UNDERSERVED_TICKET_THRESHOLD && ab === 1) {
      underservedRoutes.push({
        route: name,
        tickets: t,
        activeBuses: 1,
        headline: `High demand alert: Consider adding a bus to the ${name} corridor (${t} tickets, only 1 active plate).`,
      });
    } else if (t > UNDERSERVED_TICKET_THRESHOLD && ab === 0) {
      missingBusPlates.push({
        route: name,
        tickets: t,
        headline: `Data gap: ${name} shows ${t} tickets but no bus_number on records — link plates to tickets to measure per-bus efficiency.`,
      });
    }
  }

  const routeCandidates = topRoutes.filter((r) => r.popularity >= MIN_TICKETS_FOR_PROFITABLE_ROUTE);
  const byAvg = [...routeCandidates].sort((a, b) => b.averageFare - a.averageFare);
  const best = byAvg[0];
  let mostProfitableRoute = null;
  if (best) {
    mostProfitableRoute = {
      origin: best.origin,
      destination: best.destination,
      avgFare: best.averageFare,
      tickets: best.popularity,
      revenue: best.revenue,
      headline: `Most profitable corridor (by average fare): ${best.origin} → ${best.destination} — ${formatPhp(
        best.averageFare
      )} per seat on ${best.popularity} ticket(s).`,
    };
  }

  const avgHourly = totalTickets > 0 ? totalTickets / 24 : 0;
  const peakTickets = peakHr.tickets || 0;
  const vsAvg = avgHourly > 0 ? Math.round(((peakTickets - avgHourly) / avgHourly) * 100) : null;

  let peakFleet = {
    hour: peakHr.hour,
    tickets: peakTickets,
    headline: `Peak performance: Manila hour ${String(peakHr.hour).padStart(
      2,
      "0"
    )}:00 is the busiest one-hour slot fleet-wide (${peakTickets} ticket sales).`,
  };
  if (vsAvg != null && Number.isFinite(vsAvg)) {
    peakFleet.headline += ` That is about ${vsAvg}% ${vsAvg >= 0 ? "above" : "below"} the simple hourly average (${Math.round(
      avgHourly * 10
    ) / 10} tickets/hour) for this range.`;
  }

  let terminalVolume = null;
  try {
    const locShares = await fetchLocationEveningSharesMongo(fromDate, toDate);
    for (const row of locShares) {
      const share = row.totalTickets ? row.eveningTickets / row.totalTickets : 0;
      if (share >= TERMINAL_PM_SHARE && row.eveningTickets >= TERMINAL_MIN_EVENING) {
        const pct = Math.round(share * 100);
        terminalVolume = {
          location: row.loc,
          eveningTickets: row.eveningTickets,
          totalTickets: row.totalTickets,
          eveningShare: share,
          headline: `Resource note: ${row.loc} sends about ${pct}% of its volume during the 4 PM – 6 PM Manila window — watch capacity and staging at the terminal.`,
        };
        break;
      }
    }
  } catch (e) {
    console.warn("[reportMasterStrategicInsights] terminal volume skipped:", e.message);
  }

  const bullets = [];
  if (topPerformer?.usedUnassignedFallback) {
    bullets.push(
      "NOTE: Many tickets lack bus_number — rankings use 'Unassigned' groups. Capture plate/bus on each sale for per-vehicle efficiency."
    );
  }
  if (topPerformer) bullets.push(`TOP PERFORMER — ${topPerformer.headline}`);
  if (mostProfitableRoute) bullets.push(`MOST PROFITABLE ROUTE — ${mostProfitableRoute.headline}`);
  bullets.push(`PEAK HOUR — ${peakFleet.headline}`);
  if (terminalVolume) bullets.push(`CAPACITY — ${terminalVolume.headline}`);
  for (const u of underservedRoutes.slice(0, 5)) bullets.push(`HIGH DEMAND — ${u.headline}`);
  for (const m of missingBusPlates.slice(0, 3)) bullets.push(`DATA GAP — ${m.headline}`);

  return {
    topPerformer,
    mostProfitableRoute,
    peakFleet,
    terminalVolume,
    underservedRoutes,
    missingBusPlates,
    methodologyNote:
      "Efficiency uses revenue ÷ distinct Manila calendar days with ≥1 ticket per bus (proxy for trips when trip_id is not stored).",
    bullets,
  };
}

module.exports = {
  buildStrategicInsightsAsync,
  UNDERSERVED_TICKET_THRESHOLD,
};
