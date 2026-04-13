const GpsLog = require("../models/GpsLog");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const RouteCoverage = require("../models/RouteCoverage");
const FareGlobalSettings = require("../models/FareGlobalSettings");

const GPS_FRESH_MS = 10 * 60 * 1000;
const DEFAULT_SPEED_KPH = 40;
/** Cooldown between automatic origin/destination swaps while GPS remains inside a terminal geofence. */
const ROUTE_FLIP_COOLDOWN_MS = 15 * 60 * 1000;

const DEFAULT_MAIN_LINE_HUB_KEYWORDS = [
  ["don carlos"],
  ["maramag"],
  ["valencia"],
  ["malaybalay"],
];

function normalizeLocationLabel(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function manilaTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Start of “today” in Asia/Manila as a Date (UTC instant). */
function manilaTodayStart() {
  const ymd = manilaTodayYmd();
  return new Date(`${ymd}T00:00:00+08:00`);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function coverageMatchesMainLineKeywords(cov, keywordNorms) {
  const blobs = [
    normalizeLocationLabel(cov.locationName || ""),
    normalizeLocationLabel(cov.terminal?.name || ""),
  ].filter(Boolean);
  for (const kn of keywordNorms) {
    if (!kn) continue;
    for (const b of blobs) {
      if (b === kn || b.includes(kn) || (kn.length >= 4 && kn.includes(b))) return true;
    }
  }
  return false;
}

function inferDefaultMainLineHubChainIds(coverages) {
  if (!Array.isArray(coverages) || coverages.length === 0) return [];
  const pool = coverages.filter((c) => String(c.pointType || "terminal").toLowerCase() === "terminal");
  const list = pool.length ? pool : coverages;
  const out = [];
  const used = new Set();
  for (const keywords of DEFAULT_MAIN_LINE_HUB_KEYWORDS) {
    const norms = keywords.map((k) => normalizeLocationLabel(k)).filter(Boolean);
    const hit = list.find((c) => {
      const id = String(c._id);
      if (used.has(id)) return false;
      return coverageMatchesMainLineKeywords(c, norms);
    });
    if (hit) {
      out.push(String(hit._id));
      used.add(String(hit._id));
    }
  }
  return out.length >= 2 ? out : [];
}

function resolveHubChainCoverageIds(settings) {
  const db = Array.isArray(settings?.hubChainCoverageIds)
    ? settings.hubChainCoverageIds.map((id) => String(id)).filter(Boolean)
    : [];
  return db.length >= 2 ? db : [];
}

function buildHubKeywordsForCoverage(cov) {
  const set = new Set();
  const ln = normalizeLocationLabel(cov.locationName || "");
  const tn = normalizeLocationLabel(cov.terminal?.name || "");
  const tnShort = normalizeLocationLabel(String(cov.terminal?.name || "").split(",")[0] || "");
  [ln, tn, tnShort].forEach((x) => {
    if (x) set.add(x);
  });
  for (const group of DEFAULT_MAIN_LINE_HUB_KEYWORDS) {
    for (const k of group) {
      const kn = normalizeLocationLabel(k);
      if (!kn) continue;
      if (ln && (ln === kn || ln.includes(kn) || kn.includes(ln))) set.add(kn);
      if (tn && (tn === kn || tn.includes(kn) || kn.includes(tn))) set.add(kn);
    }
  }
  return [...set].filter(Boolean);
}

function hubLabelMatchesString(hub, n) {
  if (!n) return false;
  for (const k of hub.keywords) {
    if (!k) continue;
    if (n === k || n.includes(k) || (k.length >= 5 && k.includes(n))) return true;
  }
  return false;
}

/** First hub along the chain that matches the passenger / stop label. */
function matchViewerHubIndex(str, hubs) {
  const n = normalizeLocationLabel(str);
  if (!n || !hubs.length) return -1;
  for (let i = 0; i < hubs.length; i++) {
    if (hubLabelMatchesString(hubs[i], n)) return i;
  }
  return -1;
}

/** Furthest hub along the chain that matches the ticket destination (final stop intent). */
function matchDestinationHubIndex(str, hubs) {
  const n = normalizeLocationLabel(str);
  if (!n || !hubs.length) return -1;
  let best = -1;
  for (let i = 0; i < hubs.length; i++) {
    if (hubLabelMatchesString(hubs[i], n)) best = i;
  }
  return best;
}

function computeSeatIntel({ capacity, tickets, viewerHubLabel, hubs }) {
  const cap =
    typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 50;
  const occupied = tickets.length;
  const vacant = Math.max(0, cap - occupied);
  const viewerIdx = viewerHubLabel && hubs.length ? matchViewerHubIndex(viewerHubLabel, hubs) : -1;

  const seatLine = `${occupied}/${cap}`;

  if (vacant > 0) {
    return {
      occupiedSeats: occupied,
      vacantSeats: vacant,
      seatLine,
      seatNotice:
        vacant <= 5 ? `${vacant} seat${vacant === 1 ? "" : "s"} left on this bus.` : null,
    };
  }

  if (viewerIdx < 0 || !hubs.length) {
    return {
      occupiedSeats: occupied,
      vacantSeats: 0,
      seatLine,
      seatNotice: "Bus is full. Some passengers may leave at upcoming stops — check again shortly.",
    };
  }

  const alightingHere = tickets.filter((t) => {
    const dest = String(t.destination || t.destinationLocation || "").trim();
    return matchDestinationHubIndex(dest, hubs) === viewerIdx;
  }).length;

  if (alightingHere > 0) {
    const hubName = hubs[viewerIdx]?.label || "this stop";
    return {
      occupiedSeats: occupied,
      vacantSeats: 0,
      seatLine,
      seatNotice: `Full (${occupied}/${cap}) — ${alightingHere} seat${alightingHere > 1 ? "s" : ""} available when the bus reaches ${hubName}.`,
    };
  }

  const destIndices = tickets
    .map((t) => matchDestinationHubIndex(String(t.destination || t.destinationLocation || "").trim(), hubs))
    .filter((x) => x >= 0);
  const downstream = destIndices.filter((idx) => idx > viewerIdx);
  if (downstream.length === 0) {
    return {
      occupiedSeats: occupied,
      vacantSeats: 0,
      seatLine,
      seatNotice: `Full (${occupied}/${cap}) — no vacant seats at ${hubs[viewerIdx]?.label || "your stop"}; everyone continues past this point.`,
    };
  }
  const nextIdx = Math.min(...downstream);
  const nextLabel = hubs[nextIdx]?.label || "a downstream terminal";
  return {
    occupiedSeats: occupied,
    vacantSeats: 0,
    seatLine,
    seatNotice: `Full until ${nextLabel} — all ${occupied} passengers are riding past your stop.`,
  };
}

let hubCache = { hubs: null, at: 0 };
const HUB_TTL_MS = 60 * 1000;

async function getOrderedHubs() {
  const now = Date.now();
  if (hubCache.hubs && now - hubCache.at < HUB_TTL_MS) return hubCache.hubs;

  const [coverages, settings] = await Promise.all([
    RouteCoverage.find().lean(),
    FareGlobalSettings.findOne({ singletonKey: "global" }).lean(),
  ]);

  let chainIds = resolveHubChainCoverageIds(settings || {});
  if (chainIds.length < 2) {
    chainIds = inferDefaultMainLineHubChainIds(coverages);
  }

  const byId = new Map(coverages.map((c) => [String(c._id), c]));
  const hubs = [];
  for (const id of chainIds) {
    const c = byId.get(String(id));
    if (!c) continue;
    const label =
      String(c.locationName || "").trim() ||
      String(c.terminal?.name || "").split(",")[0].trim() ||
      "Hub";
    hubs.push({
      id: String(id),
      label,
      keywords: buildHubKeywordsForCoverage(c),
    });
  }

  hubCache = { hubs, at: now };
  return hubs;
}

function hubsForBusRow(row, globalHubs) {
  const labels = Array.isArray(row.hubOrderLabels)
    ? row.hubOrderLabels.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (!labels.length) return globalHubs;
  return labels.map((lab) => {
    const n = normalizeLocationLabel(lab);
    const hit = globalHubs.find((h) => normalizeLocationLabel(h.label) === n);
    if (hit) return hit;
    return { id: lab, label: lab, keywords: [n].filter(Boolean) };
  });
}

function normalizeBusKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "");
}

/**
 * @param {Array<object>} fleetItems - rows from public fleet-buses (before enrich)
 * @param {{ viewerHub?: string, userLat?: number, userLng?: number }} opts
 */
async function enrichPublicFleetBuses(fleetItems, opts = {}) {
  const viewerHub = String(opts.viewerHub || "").trim();
  const userLat = Number(opts.userLat);
  const userLng = Number(opts.userLng);
  const hasUser = Number.isFinite(userLat) && Number.isFinite(userLng);

  if (!Array.isArray(fleetItems) || fleetItems.length === 0) return fleetItems;

  const hubsGlobal = await getOrderedHubs();
  const startDay = manilaTodayStart();
  const busIds = fleetItems.map((b) => String(b.busId || "").trim()).filter(Boolean);

  const [gpsLogs, ticketDocs] = await Promise.all([
    busIds.length ? GpsLog.find({ busId: { $in: busIds } }).lean() : Promise.resolve([]),
    IssuedTicketRecord.find({
      createdAt: { $gte: startDay },
      boardingStatus: { $nin: ["completed", "cancelled"] },
    })
      .select({ destination: 1, destinationLocation: 1, busNumber: 1, boardingStatus: 1 })
      .lean(),
  ]);

  const gpsByBusId = new Map(gpsLogs.map((g) => [String(g.busId), g]));

  const ticketsByBus = new Map();
  for (const t of ticketDocs) {
    const k = normalizeBusKey(t.busNumber);
    if (!k) continue;
    if (!ticketsByBus.has(k)) ticketsByBus.set(k, []);
    ticketsByBus.get(k).push(t);
  }

  return fleetItems.map((row) => {
    const bid = String(row.busId || "").trim();
    const bKey = normalizeBusKey(row.busNumber || row.busId);
    const tickets = bKey ? ticketsByBus.get(bKey) || [] : [];
    const segmentStart = row.tripSegmentStartedAt ? new Date(row.tripSegmentStartedAt) : null;
    const effectiveStart =
      segmentStart && !Number.isNaN(segmentStart.getTime()) && segmentStart > startDay ? segmentStart : startDay;
    const ticketsScoped = tickets.filter((t) => new Date(t.createdAt) >= effectiveStart);
    const hubs = hubsForBusRow(row, hubsGlobal);
    const intel = computeSeatIntel({
      capacity: row.seatCapacity,
      tickets: ticketsScoped,
      viewerHubLabel: viewerHub,
      hubs,
    });

    const gps = bid ? gpsByBusId.get(bid) : null;
    let distanceToUserKm = null;
    let etaMinutesFromUser = null;
    if (gps && hasUser && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      const age = Date.now() - new Date(gps.recordedAt || 0).getTime();
      if (age >= 0 && age < GPS_FRESH_MS) {
        distanceToUserKm = Math.round(haversineKm(userLat, userLng, gps.latitude, gps.longitude) * 100) / 100;
        const hours = distanceToUserKm / DEFAULT_SPEED_KPH;
        etaMinutesFromUser = Math.max(1, Math.round(hours * 60));
      }
    }

    return {
      ...row,
      lastLatitude: gps && Number.isFinite(gps.latitude) ? gps.latitude : null,
      lastLongitude: gps && Number.isFinite(gps.longitude) ? gps.longitude : null,
      gpsRecordedAt: gps?.recordedAt ? new Date(gps.recordedAt).toISOString() : null,
      distanceToUserKm,
      etaMinutesFromUser,
      occupiedSeats: intel.occupiedSeats,
      vacantSeats: intel.vacantSeats,
      seatLine: intel.seatLine,
      seatNotice: intel.seatNotice,
    };
  });
}

/** Ordered hub display names between corridor endpoints (admin Fare Global hub chain). */
async function buildHubOrderLabelsForRoute(fromText, toText) {
  const hubs = await getOrderedHubs();
  if (!hubs.length) return [];
  const iFrom = matchViewerHubIndex(fromText, hubs);
  const iTo = matchDestinationHubIndex(toText, hubs);
  if (iFrom < 0 || iTo < 0) return hubs.map((h) => h.label);
  const lo = Math.min(iFrom, iTo);
  const hi = Math.max(iFrom, iTo);
  const slice = hubs.slice(lo, hi + 1).map((h) => h.label);
  return iFrom <= iTo ? slice : [...slice].reverse();
}

module.exports = {
  enrichPublicFleetBuses,
  haversineKm,
  DEFAULT_SPEED_KPH,
  buildHubOrderLabelsForRoute,
  ROUTE_FLIP_COOLDOWN_MS,
};
