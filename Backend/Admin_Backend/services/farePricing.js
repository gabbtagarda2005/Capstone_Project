const mongoose = require("mongoose");
const FareGlobalSettings = require("../models/FareGlobalSettings");
const FareMatrixEntry = require("../models/FareMatrixEntry");
const RouteCoverage = require("../models/RouteCoverage");
const CorridorRoute = require("../models/CorridorRoute");
const FareRoute = require("../models/FareRoute");

/** Stable ObjectId for fare rows keyed from ticketing DB / manual labels (no RouteCoverage doc required). */
const TICKETING_FARE_SENTINEL = new mongoose.Types.ObjectId("657000000000000000000001");

function hashStopSequence(prefix, norm) {
  const s = `${prefix}:${norm}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h % 900000) + 1;
}

function normalizeLocationLabel(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function shortPlaceLabel(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  const first = v.split(",")[0]?.trim() || v;
  return first;
}

function terminalPointLabel(cov) {
  const hub = String(cov.locationName || "").trim();
  const tname = shortPlaceLabel(cov.terminal?.name);
  const hubNorm = normalizeLocationLabel(hub);
  const tNorm = normalizeLocationLabel(tname);
  if (tname && hub && tNorm !== hubNorm && !tNorm.includes(hubNorm)) return `${tname} (${hub})`;
  return tname || hub || "Terminal";
}

function stopPointLabel(cov, stop) {
  const hub = String(cov.locationName || cov.terminal?.name || "").trim() || "Hub";
  const sname = shortPlaceLabel(stop.name);
  const hubNorm = normalizeLocationLabel(hub);
  const sNorm = normalizeLocationLabel(sname);
  if (sNorm && sNorm.includes(hubNorm)) return sname;
  return `${sname || "Stop"} (${hub})`;
}

function isOid(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Terminal: `t:<coverageId>`
 * Stop: `s:<coverageId>:<sequence>`
 */
async function resolveEndpointToken(token) {
  const raw = String(token || "").trim();
  if (raw.startsWith("tick:S:")) {
    let loc = "";
    try {
      loc = decodeURIComponent(raw.slice(7));
    } catch {
      return { error: "Invalid start location token" };
    }
    loc = String(loc).trim();
    if (!loc) return { error: "Start location is empty" };
    const norm = normalizeLocationLabel(loc);
    return {
      coverageId: TICKETING_FARE_SENTINEL,
      kind: "stop",
      stopSequence: hashStopSequence("S", norm),
      label: loc,
      norm,
    };
  }
  if (raw.startsWith("tick:E:")) {
    let loc = "";
    try {
      loc = decodeURIComponent(raw.slice(7));
    } catch {
      return { error: "Invalid destination token" };
    }
    loc = String(loc).trim();
    if (!loc) return { error: "Destination is empty" };
    const norm = normalizeLocationLabel(loc);
    return {
      coverageId: TICKETING_FARE_SENTINEL,
      kind: "stop",
      stopSequence: hashStopSequence("E", norm),
      label: loc,
      norm,
    };
  }
  if (raw.startsWith("t:")) {
    const id = raw.slice(2);
    if (!isOid(id)) return { error: "Invalid terminal token" };
    const cov = await RouteCoverage.findById(id).lean();
    if (!cov) return { error: "Coverage hub not found" };
    const label = terminalPointLabel(cov);
    return {
      coverageId: id,
      kind: "terminal",
      stopSequence: 0,
      label,
      norm: normalizeLocationLabel(label),
    };
  }
  if (raw.startsWith("s:")) {
    const rest = raw.slice(2);
    const colon = rest.indexOf(":");
    if (colon < 1) return { error: "Invalid stop token" };
    const id = rest.slice(0, colon);
    const seq = Number(rest.slice(colon + 1));
    if (!isOid(id) || !Number.isFinite(seq) || seq < 1) return { error: "Invalid stop token" };
    const cov = await RouteCoverage.findById(id).lean();
    if (!cov) return { error: "Coverage hub not found" };
    const hit = (cov.stops || []).find((s) => Number(s.sequence) === seq);
    if (!hit) return { error: "Stop not found on hub" };
    const label = stopPointLabel(cov, hit);
    return {
      coverageId: id,
      kind: "stop",
      stopSequence: seq,
      label,
      norm: normalizeLocationLabel(label),
    };
  }
  return { error: "Invalid location token" };
}

/**
 * Terminals and bus stops from Location Management (RouteCoverage) — single source for
 * fare dropdowns and ticket-issuer location options (avoids duplicating MySQL ticket strings).
 */
async function listRouteCoverageFareEndpoints() {
  const docs = await RouteCoverage.find().sort({ locationName: 1 }).lean();
  const options = [];
  for (const cov of docs) {
    const id = String(cov._id);
    options.push({ token: `t:${id}`, label: terminalPointLabel(cov) });
    for (const s of cov.stops || []) {
      if (!Number.isFinite(s.sequence)) continue;
      options.push({ token: `s:${id}:${s.sequence}`, label: stopPointLabel(cov, s) });
    }
  }
  return options;
}

async function listFareLocationOptions() {
  return listRouteCoverageFareEndpoints();
}

/**
 * Fare Management dropdowns: same RouteCoverage-backed list for start and destination.
 */
async function listFareLocationEndpointPairs() {
  const options = await listRouteCoverageFareEndpoints();
  return { startOptions: options, endOptions: options };
}

async function getGlobalSettingsLean() {
  let doc = await FareGlobalSettings.findOne({ singletonKey: "global" }).lean();
  if (!doc) {
    doc = await FareGlobalSettings.create({
      singletonKey: "global",
      studentDiscountPct: 20,
      pwdDiscountPct: 20,
      seniorDiscountPct: 20,
      farePerKmPesos: 0,
      hubChainCoverageIds: [],
    }).then((d) => d.toObject());
  }
  return doc;
}

/** Ordered hub coverage ids for linear segment sums (DB + optional env fallback). */
function resolveHubChainCoverageIds(settings) {
  const db = Array.isArray(settings?.hubChainCoverageIds)
    ? settings.hubChainCoverageIds.map((id) => String(id)).filter(Boolean)
    : [];
  if (db.length >= 2) return db;
  const env = String(process.env.FARE_HUB_CHAIN_COVERAGE_IDS || "").trim();
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Keyword groups in **travel order** along the main Bukidnon line. Matched against each hub’s
 * `locationName` and `terminal.name` (normalized). First unused terminal per group wins.
 * Used when no `hubChainCoverageIds` / `FARE_HUB_CHAIN_COVERAGE_IDS` is set so e.g.
 * Don Carlos → Malaybalay sums DC→Maramag + Maramag→Valencia + Valencia→Malaybalay matrix rows.
 */
const DEFAULT_MAIN_LINE_HUB_KEYWORDS = [
  ["don carlos"],
  ["maramag"],
  ["valencia"],
  ["malaybalay"],
  ["aglayan"],
];

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

/** Configured chain first; else inferred main line from deployed terminal locations. */
function resolveEffectiveHubChainIds(settings, coverages) {
  const configured = resolveHubChainCoverageIds(settings);
  if (configured.length >= 2) return configured;
  return inferDefaultMainLineHubChainIds(coverages);
}

/**
 * Sum matrix base fares along the configured hub line (e.g. Don Carlos → Maramag → Valencia → Malaybalay).
 * @returns {{ segments: Array, totalBase: number } | null}
 */
function findLinearHubChainPath(lookup, startHubId, endHubId, coverages, chainIds) {
  const chain = (chainIds || []).map(String);
  if (chain.length < 2) return null;
  const covById = new Map(coverages.map((c) => [String(c._id), c]));
  const from = String(startHubId || "");
  const to = String(endHubId || "");
  const fi = chain.indexOf(from);
  const ti = chain.indexOf(to);
  if (fi < 0 || ti < 0 || fi === ti) return null;

  const segments = [];
  if (fi < ti) {
    for (let i = fi; i < ti; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const ca = covById.get(a);
      const cb = covById.get(b);
      if (!ca || !cb) return null;
      const base = hubTerminalBaseFromLookup(lookup, ca, cb);
      if (base == null || !Number.isFinite(base) || base < 0) return null;
      segments.push({
        fromId: a,
        toId: b,
        fromLabel: terminalPointLabel(ca),
        toLabel: terminalPointLabel(cb),
        basePesos: base,
      });
    }
  } else {
    for (let i = fi; i > ti; i--) {
      const a = chain[i];
      const b = chain[i - 1];
      const ca = covById.get(a);
      const cb = covById.get(b);
      if (!ca || !cb) return null;
      const base = hubTerminalBaseFromLookup(lookup, ca, cb);
      if (base == null || !Number.isFinite(base) || base < 0) return null;
      segments.push({
        fromId: a,
        toId: b,
        fromLabel: terminalPointLabel(ca),
        toLabel: terminalPointLabel(cb),
        basePesos: base,
      });
    }
  }

  const totalBase = segments.reduce((s, seg) => s + Number(seg.basePesos), 0);
  return { segments, totalBase, pathSource: "hub_chain" };
}

/**
 * True if corridor-graph path backtracks (same hub visited twice). Dijkstra minimizes fare sum;
 * asymmetric matrix rows can make M→V→M→… cheaper than the real main-line sequence — reject those.
 */
function interHubSegmentsRevisitAnyHub(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  const nodes = [String(segments[0].fromId)];
  for (const seg of segments) {
    if (String(seg.fromId) !== nodes[nodes.length - 1]) return true;
    nodes.push(String(seg.toId));
  }
  return new Set(nodes).size !== nodes.length;
}

/**
 * Prefer the configured / inferred **linear hub chain** (real bus line, both directions).
 * Fall back to corridor graph only when a hub is off-chain; drop graph paths that revisit a hub.
 */
async function resolveInterHubMatrixPath(lookup, startHubId, endHubId, coverages, settings) {
  const a = String(startHubId || "");
  const b = String(endHubId || "");
  if (!a || !b || a === b) return null;
  const chainIds = resolveEffectiveHubChainIds(settings, coverages);
  let multi = findLinearHubChainPath(lookup, a, b, coverages, chainIds);
  if (multi?.segments?.length) return multi;

  multi = await findMultiSegmentHubPath(lookup, a, b, coverages);
  if (multi?.segments?.length && interHubSegmentsRevisitAnyHub(multi.segments)) {
    return null;
  }
  return multi;
}

/** Show km with enough decimals that “km × ₱/km” matches the billed distance pesos in the same line. */
function formatGeoKmForPerKmLine(geoKm, distanceChargePesos, perKm) {
  const pk = Number(perKm) || 0;
  const dc = Number(distanceChargePesos) || 0;
  const g = Number(geoKm) || 0;
  if (pk <= 0 || dc <= 0) return g.toFixed(3);
  const implied = dc / pk;
  if (Math.abs(implied - g) < 0.0005) return g.toFixed(3);
  return implied.toFixed(3);
}

function discountPctForCategory(settings, category) {
  const c = String(category || "adult").toLowerCase();
  if (c === "student") return Number(settings.studentDiscountPct) || 0;
  if (c === "pwd") return Number(settings.pwdDiscountPct) || 0;
  if (c === "senior") return Number(settings.seniorDiscountPct) || 0;
  return 0;
}

function applyDiscount(baseFare, discountPct) {
  const b = Number(baseFare);
  const p = Math.min(100, Math.max(0, Number(discountPct) || 0));
  if (!Number.isFinite(b) || b < 0) return 0;
  const out = b * (1 - p / 100);
  return Math.round(out * 100) / 100;
}

/** Cash-friendly rounding to the nearest ₱0.50 (passenger-facing final fare). */
function roundFareToNearestHalfPeso(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 2) / 2;
}

/**
 * Passenger-facing line for inter-hub matrix + spurs. Uses actual peso distance charge so the line
 * matches half-peso rounding (avoids "₱19.99 + 4.6×10 ≠ shown total").
 */
function formatHubMatrixPricingSummary({
  matrixBase,
  originKm,
  destKm,
  perKm,
  distanceChargePesos,
  pct,
  fare,
  subtotalRoundedHalf,
}) {
  const o = Number(originKm) || 0;
  const d = Number(destKm) || 0;
  const dist = o + d;
  const pk = Number(perKm) || 0;
  const base = Number(matrixBase) || 0;
  const distP = Number(distanceChargePesos) || 0;
  let line = `Hub-to-hub ₱${base.toFixed(2)}`;
  if (dist > 0 && pk > 0) {
    const kmShown = formatGeoKmForPerKmLine(dist, distP, pk);
    line += ` + ₱${distP.toFixed(2)} distance (${kmShown} km × ₱${pk.toFixed(2)}/km)`;
  }
  if (Number(pct) > 0) {
    line += ` → ₱${Number(subtotalRoundedHalf).toFixed(2)} → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
  } else {
    line += ` → ₱${Number(subtotalRoundedHalf).toFixed(2)} rounded → total ₱${Number(fare).toFixed(2)}`;
  }
  return line;
}

function formatPreTerminalPricingSummary({ fullKm, perKm, distCharge, pct, fare, subtotalRoundedHalf }) {
  const km = Number(fullKm) || 0;
  const pk = Number(perKm) || 0;
  const dc = Number(distCharge) || 0;
  const kmShown = formatGeoKmForPerKmLine(km, dc, pk);
  let line = `Before destination hub: ${kmShown} km × ₱${pk.toFixed(2)}/km (₱${dc.toFixed(2)})`;
  if (Number(pct) > 0) {
    line += ` → ₱${Number(subtotalRoundedHalf).toFixed(2)} → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
  } else {
    line += ` → ₱${Number(fare).toFixed(2)} total (no hub-to-hub matrix)`;
  }
  return line;
}

/**
 * Hub-chain + spur line: matrix legs up to the hub before the destination corridor, then km from that hub to the stop.
 */
function formatPreTerminalChainSpurSummary({
  segmentLines,
  anchorLabel,
  spurKm,
  perKm,
  distCharge,
  pct,
  fare,
  subtotalRoundedHalf,
}) {
  const pk = Number(perKm) || 0;
  const km = Number(spurKm) || 0;
  const dc = Number(distCharge) || 0;
  const parts = Array.isArray(segmentLines) ? segmentLines.join(" + ") : "";
  const spurPart =
    km > 0 && pk > 0
      ? `₱${dc.toFixed(2)} (${anchorLabel} → stop: ${formatGeoKmForPerKmLine(km, dc, pk)} km × ₱${pk.toFixed(2)}/km)`
      : "";
  let line = parts ? `${parts}${spurPart ? ` + ${spurPart}` : ""}` : spurPart;
  if (Number(pct) > 0) {
    line += ` → ₱${Number(subtotalRoundedHalf).toFixed(2)} → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
  } else {
    line += ` → ₱${Number(fare).toFixed(2)} total`;
  }
  return line;
}

/**
 * Inter-hub trip alighting before the destination hub terminal (distance_only): use published matrix for each leg
 * **except the last hub→destination-hub segment**, then add straight-line km from the **previous hub’s terminal** to the stop.
 * Example: Don Carlos → stop in Valencia before Valencia terminal = (DC→Maramag matrix) + (Maramag terminal → stop × ₱/km).
 */
async function tryPreTerminalChainPlusSpur({
  startRes,
  endRes,
  settings,
  coverages,
  perKm,
  pct,
  cat,
  clientFare,
}) {
  if (!startRes?.cov?._id || !endRes?.cov?._id || !endRes.stop || !startRes.cov.terminal) return null;
  if (!Number.isFinite(Number(perKm)) || Number(perKm) <= 0) {
    const n = clientFare != null ? Number(clientFare) : NaN;
    return {
      matched: false,
      fare: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN,
      baseFarePesos: null,
      discountPct: null,
      categoryUsed: cat,
      pricingMode: "pre_terminal_chain_needs_per_km",
      message: "Set Fare per km in Admin to price the segment from the previous major hub to this stop.",
      preTerminalDestination: true,
    };
  }

  const lookup = await loadHubTerminalFareMatrixLookup();
  const multi = await resolveInterHubMatrixPath(
    lookup,
    String(startRes.cov._id),
    String(endRes.cov._id),
    coverages,
    settings
  );
  if (!multi || multi.segments.length < 2) return null;

  const withoutLast = multi.segments.slice(0, -1);
  const matrixBase = withoutLast.reduce((s, seg) => s + Number(seg.basePesos), 0);
  if (!Number.isFinite(matrixBase) || matrixBase < 0) return null;

  const lastSeg = multi.segments[multi.segments.length - 1];
  const anchorHubId = String(lastSeg.fromId || "");
  const anchorCov = coverages.find((c) => String(c._id) === anchorHubId);
  const anchorTerm = anchorCov?.terminal;
  const dStop = endRes.stop;
  if (!anchorTerm || !Number.isFinite(anchorTerm.latitude) || !Number.isFinite(anchorTerm.longitude)) return null;
  if (!Number.isFinite(dStop.latitude) || !Number.isFinite(dStop.longitude)) return null;

  const spurKm = haversineKm(anchorTerm.latitude, anchorTerm.longitude, dStop.latitude, dStop.longitude);
  if (!Number.isFinite(spurKm) || spurKm < 0) return null;

  const distanceCharge = perKm * spurKm;
  const distanceChargePesos = Math.round(distanceCharge * 100) / 100;
  const subtotalRaw = matrixBase + distanceCharge;
  const subtotalRoundedHalf = roundFareToNearestHalfPeso(subtotalRaw);
  const fareAfterDiscount = applyDiscount(subtotalRoundedHalf, pct);
  const fare = roundFareToNearestHalfPeso(fareAfterDiscount);

  const segmentLines = withoutLast.map((s) => {
    const tag = segmentPairAbbrev(s.fromLabel, s.toLabel);
    return `₱${Number(s.basePesos).toFixed(2)} (${tag})`;
  });
  const anchorLabel = terminalPointLabel(anchorCov);

  const pricingSummary = formatPreTerminalChainSpurSummary({
    segmentLines,
    anchorLabel,
    spurKm,
    perKm,
    distCharge: distanceChargePesos,
    pct,
    fare,
    subtotalRoundedHalf,
  });

  const kmSpurShown = formatGeoKmForPerKmLine(spurKm, distanceChargePesos, perKm);
  let fareBreakdownDisplay = segmentLines.length
    ? `${segmentLines.join(" + ")} + ₱${distanceChargePesos.toFixed(2)} (${kmSpurShown} km × ₱${Number(perKm).toFixed(2)}/km from ${anchorLabel})`
    : `₱${distanceChargePesos.toFixed(2)} (${kmSpurShown} km × ₱${Number(perKm).toFixed(2)}/km)`;
  if (Number(pct) > 0) {
    fareBreakdownDisplay += ` → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
  } else {
    fareBreakdownDisplay += ` → ₱${Number(fare).toFixed(2)} total`;
  }

  return {
    matched: true,
    fare,
    baseFarePesos: matrixBase,
    discountPct: pct,
    categoryUsed: cat,
    pricingMode: "pre_terminal_hub_chain_plus_spur",
    extraDistanceKm: spurKm,
    distanceChargePesos,
    farePerKmPesos: perKm,
    hubStartLabel: withoutLast[0]?.fromLabel || startRes.hubMatrixLabel,
    hubEndLabel: endRes.hubMatrixLabel,
    subtotalRoundedHalfPeso: subtotalRoundedHalf,
    preTerminalDestination: true,
    originSpurKm: 0,
    destinationSpurKm: spurKm,
    segmentFares: withoutLast,
    fareBreakdownDisplay,
    pricingSummary,
  };
}

function formatIntraHubPricingSummary({ travelKm, perKm, pct, fare, subtotalRoundedHalf }) {
  const km = Number(travelKm) || 0;
  const pk = Number(perKm) || 0;
  let line = `Same hub: ${km.toFixed(1)} km × ₱${pk.toFixed(2)}/km`;
  if (Number(pct) > 0) {
    line += ` = ₱${Number(subtotalRoundedHalf).toFixed(2)} → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
  } else {
    line += ` = ₱${Number(fare).toFixed(2)}`;
  }
  return line;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const a1 = Number(lat1);
  const o1 = Number(lon1);
  const a2 = Number(lat2);
  const o2 = Number(lon2);
  if (![a1, o1, a2, o2].every((x) => Number.isFinite(x))) return 0;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

function extraKmTerminalToStop(cov, stop) {
  const term = cov.terminal;
  if (!term || !Number.isFinite(term.latitude) || !Number.isFinite(term.longitude)) return 0;
  if (!stop || !Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return 0;
  return haversineKm(term.latitude, term.longitude, stop.latitude, stop.longitude);
}

function readChainageKm(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Distance used for fare add-on on a hub: |km(stop) − km(terminal)| when both chainages exist,
 * else straight-line terminal↔stop (km).
 */
function corridorKmDeltaStopFromTerminal(cov, stop) {
  const term = cov?.terminal;
  if (!term || !stop) return 0;
  const tk = readChainageKm(term.kilometersFromStart);
  const sk = readChainageKm(stop.kilometersFromStart);
  if (tk != null && sk != null) return Math.abs(sk - tk);
  return extraKmTerminalToStop(cov, stop);
}

/**
 * Travel distance (km) for two points on the **same** RouteCoverage (no inter-hub matrix).
 * Terminal↔stop: |chainage Δ| or haversine to terminal; stop↔stop: |k1−k2| or haversine between stops.
 */
function intraHubTravelKm(cov, startRes, endRes) {
  if (!cov || !startRes || !endRes) return NaN;
  if (startRes.kind === "terminal" && endRes.kind === "stop" && endRes.stop) {
    return corridorKmDeltaStopFromTerminal(cov, endRes.stop);
  }
  if (startRes.kind === "stop" && endRes.kind === "terminal" && startRes.stop) {
    return corridorKmDeltaStopFromTerminal(cov, startRes.stop);
  }
  if (startRes.kind === "stop" && endRes.kind === "stop" && startRes.stop && endRes.stop) {
    const k1 = readChainageKm(startRes.stop.kilometersFromStart);
    const k2 = readChainageKm(endRes.stop.kilometersFromStart);
    if (k1 != null && k2 != null) return Math.abs(k1 - k2);
    const la1 = Number(startRes.stop.latitude);
    const lo1 = Number(startRes.stop.longitude);
    const la2 = Number(endRes.stop.latitude);
    const lo2 = Number(endRes.stop.longitude);
    if ([la1, lo1, la2, lo2].every((x) => Number.isFinite(x))) {
      return haversineKm(la1, lo1, la2, lo2);
    }
    return NaN;
  }
  if (startRes.kind === "terminal" && endRes.kind === "terminal") {
    return 0;
  }
  return NaN;
}

/**
 * Stop lies before the destination hub terminal (early corridor drop). Used for inter-hub + distance_only pricing.
 * 1) sequence &lt; terminalInboundSequence when admin set the threshold.
 * 2) Else chainage: stop km from corridor start &lt; terminal km (both set).
 * 3) Else geometric: stop is closer to the **origin** hub terminal than the **destination** hub terminal is
 *    (typical when the passenger boards at Don Carlos and alights before reaching Maramag terminal).
 */
function stopIsBeforeHubTerminal(destCov, stop, originCov) {
  const ts = Number(destCov?.terminalInboundSequence);
  const seq = Number(stop?.sequence);
  if (Number.isFinite(ts) && ts > 1 && Number.isFinite(seq)) {
    return seq < ts;
  }
  const term = destCov?.terminal;
  const tk = readChainageKm(term?.kilometersFromStart);
  const sk = readChainageKm(stop?.kilometersFromStart);
  if (tk != null && sk != null && sk < tk) return true;

  const oTerm = originCov?.terminal;
  if (!term || !oTerm || !stop) return false;
  const oLat = Number(oTerm.latitude);
  const oLon = Number(oTerm.longitude);
  const dLat = Number(term.latitude);
  const dLon = Number(term.longitude);
  const sLat = Number(stop.latitude);
  const sLon = Number(stop.longitude);
  if (![oLat, oLon, dLat, dLon, sLat, sLon].every((x) => Number.isFinite(x))) return false;
  const distOriginToStop = haversineKm(oLat, oLon, sLat, sLon);
  const distOriginToDestHubTerminal = haversineKm(oLat, oLon, dLat, dLon);
  if (!(distOriginToStop > 0 && distOriginToDestHubTerminal > 0)) return false;
  // Small epsilon avoids mis-ties when coords are almost coincident.
  return distOriginToStop < distOriginToDestHubTerminal - 0.25;
}

/** Default distance_only: pre-terminal stops = origin→stop × fare/km only (e.g. 5 km × ₱10 = ₱50). */
function preTerminalUsesDistanceOnlyPolicy(cov) {
  const p = String(cov?.preTerminalStopFarePolicy || "distance_only").trim();
  return p !== "matrix_plus_corridor_delta";
}

function parseParenLocationLabel(label) {
  const t = String(label || "").trim();
  const m = t.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return null;
  return { innerName: m[1].trim(), areaHint: m[2].trim() };
}

function locationsRoughMatch(fragment, locationOrName) {
  const f = normalizeLocationLabel(fragment);
  const L = normalizeLocationLabel(locationOrName || "");
  if (!f || !L) return false;
  if (L === f) return true;
  if (L.startsWith(`${f} `) || L.startsWith(`${f},`)) return true;
  const idx = L.indexOf(f);
  if (idx === 0) return true;
  if (idx > 0 && !/[a-z0-9]/i.test(L.charAt(idx - 1))) return true;
  return false;
}

function resolveLocationAgainstCoverage(cov, labelNorm) {
  const hubLabel = terminalPointLabel(cov);
  const hubNorm = normalizeLocationLabel(hubLabel);
  if (labelNorm === hubNorm) {
    return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
  }
  // Passenger UI often lists coverage.locationName only (e.g. "Maramag") — match before full terminal labels.
  const rawLoc = String(cov.locationName || "").trim();
  const locNorm = rawLoc ? normalizeLocationLabel(rawLoc) : "";
  if (rawLoc && locNorm === labelNorm) {
    return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
  }
  // e.g. user "Don Carlos" vs admin hub name "Don Carlos, Bukidnon"
  if (
    rawLoc &&
    labelNorm.length >= 5 &&
    (locNorm.startsWith(`${labelNorm},`) || locNorm.startsWith(`${labelNorm} `))
  ) {
    return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
  }
  const term = cov.terminal;
  if (term && term.name) {
    const tnShortNorm = normalizeLocationLabel(shortPlaceLabel(term.name));
    if (tnShortNorm === labelNorm) {
      return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
    }
    // Passenger / map UIs often expose the raw terminal.name, including address after a comma
    // (e.g. "Maramag Integrated Bus Terminal, Purok 5") while matrix keys use terminalPointLabel(cov).
    const termFullNorm = normalizeLocationLabel(String(term.name).trim());
    if (termFullNorm && labelNorm === termFullNorm) {
      return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
    }
    if (tnShortNorm && labelNorm.startsWith(`${tnShortNorm},`)) {
      return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
    }
    const tn = shortPlaceLabel(term.name);
    const loc = String(cov.locationName || "").trim();
    const variants = [
      normalizeLocationLabel(`${tn} (${shortPlaceLabel(loc)})`),
      normalizeLocationLabel(`${tn} (${loc})`),
      normalizeLocationLabel(`${term.name} (${loc})`),
    ];
    if (variants.includes(labelNorm)) {
      return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
    }
  }
  for (const s of cov.stops || []) {
    if (!Number.isFinite(s.sequence)) continue;
    const full = normalizeLocationLabel(stopPointLabel(cov, s));
    if (full === labelNorm) {
      return {
        kind: "stop",
        stop: s,
        hubMatrixLabel: hubLabel,
        extraKm: corridorKmDeltaStopFromTerminal(cov, s),
        cov,
      };
    }
    const sRaw = String(s.name || "").trim();
    const sShortNorm = normalizeLocationLabel(shortPlaceLabel(sRaw));
    const sFullNorm = normalizeLocationLabel(sRaw);
    if (sShortNorm === labelNorm || sFullNorm === labelNorm) {
      return {
        kind: "stop",
        stop: s,
        hubMatrixLabel: hubLabel,
        extraKm: corridorKmDeltaStopFromTerminal(cov, s),
        cov,
      };
    }
    if (sShortNorm && labelNorm.startsWith(`${sShortNorm},`)) {
      return {
        kind: "stop",
        stop: s,
        hubMatrixLabel: hubLabel,
        extraKm: corridorKmDeltaStopFromTerminal(cov, s),
        cov,
      };
    }
  }
  return null;
}

function fuzzyResolveLocationAgainstCoverage(cov, labelRaw) {
  const parsed = parseParenLocationLabel(labelRaw);
  if (!parsed) return null;
  const nameN = normalizeLocationLabel(parsed.innerName);
  const areaOk =
    locationsRoughMatch(parsed.areaHint, cov.locationName) ||
    locationsRoughMatch(parsed.areaHint, cov.terminal?.name || "");
  if (!areaOk) return null;

  const hubLabel = terminalPointLabel(cov);
  if (cov.terminal && cov.terminal.name) {
    const termShort = normalizeLocationLabel(shortPlaceLabel(cov.terminal.name));
    const termFull = normalizeLocationLabel(cov.terminal.name);
    if (nameN === termShort || nameN === termFull) {
      return { kind: "terminal", stop: null, hubMatrixLabel: hubLabel, extraKm: 0, cov };
    }
  }
  for (const s of cov.stops || []) {
    if (!Number.isFinite(s.sequence)) continue;
    if (normalizeLocationLabel(s.name) === nameN) {
      return {
        kind: "stop",
        stop: s,
        hubMatrixLabel: hubLabel,
        extraKm: corridorKmDeltaStopFromTerminal(cov, s),
        cov,
      };
    }
  }
  return null;
}

function resolveTicketLocationString(label, coverages) {
  const normIn = normalizeLocationLabel(label);
  for (const cov of coverages) {
    const hit = resolveLocationAgainstCoverage(cov, normIn);
    if (hit) return hit;
  }
  for (const cov of coverages) {
    const hit = fuzzyResolveLocationAgainstCoverage(cov, label);
    if (hit) return hit;
  }
  return null;
}

async function findMatrixEntryByLabels(startLocation, destination) {
  const sn = normalizeLocationLabel(startLocation);
  const en = normalizeLocationLabel(destination);
  if (!sn || !en) return null;
  const forward = await FareMatrixEntry.findOne({ startNorm: sn, endNorm: en }).lean();
  if (forward) return forward;
  return FareMatrixEntry.findOne({ startNorm: en, endNorm: sn }).lean();
}

/** Matrix rows are keyed by RouteCoverage + terminal/stop — match that first (labels can differ from short UI text). */
async function findMatrixEntryByResolvedEndpoints(startRes, endRes) {
  if (!startRes?.cov?._id || !endRes?.cov?._id) return null;
  const sSeq =
    startRes.kind === "stop" && startRes.stop && Number.isFinite(Number(startRes.stop.sequence))
      ? Number(startRes.stop.sequence)
      : 0;
  const eSeq =
    endRes.kind === "stop" && endRes.stop && Number.isFinite(Number(endRes.stop.sequence))
      ? Number(endRes.stop.sequence)
      : 0;
  return FareMatrixEntry.findOne({
    startCoverageId: startRes.cov._id,
    startKind: startRes.kind,
    startStopSequence: sSeq,
    endCoverageId: endRes.cov._id,
    endKind: endRes.kind,
    endStopSequence: eSeq,
  }).lean();
}

/**
 * Inter-hub trips must use the **hub-terminal → hub-terminal** matrix row only.
 * Base fare = published end-to-end between major terminals; sub-stops add |Δkm|×fare/km separately.
 * (Stop-specific matrix rows, if any, must not override that base.)
 */
async function findMatrixEntryHubTerminalToHubTerminal(startCov, endCov) {
  if (!startCov?._id || !endCov?._id) return null;
  const forward = await FareMatrixEntry.findOne({
    startCoverageId: startCov._id,
    startKind: "terminal",
    startStopSequence: 0,
    endCoverageId: endCov._id,
    endKind: "terminal",
    endStopSequence: 0,
  }).lean();
  if (forward) return forward;
  return FareMatrixEntry.findOne({
    startCoverageId: endCov._id,
    startKind: "terminal",
    startStopSequence: 0,
    endCoverageId: startCov._id,
    endKind: "terminal",
    endStopSequence: 0,
  }).lean();
}

/**
 * One DB read: all hub-terminal matrix rows for multi-segment pathfinding (replaces per-edge queries).
 * @returns {{ byPair: Map<string, number>, byLabel: Map<string, number> }}
 */
async function loadHubTerminalFareMatrixLookup() {
  const rows = await FareMatrixEntry.find({
    startKind: "terminal",
    startStopSequence: 0,
    endKind: "terminal",
    endStopSequence: 0,
  }).lean();

  const byPair = new Map();
  const byLabel = new Map();
  for (const r of rows) {
    const v = Number(r.baseFarePesos);
    if (!Number.isFinite(v) || v < 0) continue;
    byPair.set(`${String(r.startCoverageId)}|${String(r.endCoverageId)}`, v);
    const lk = `${normalizeLocationLabel(r.startLabel)}|${normalizeLocationLabel(r.endLabel)}`;
    byLabel.set(lk, v);
  }
  return { byPair, byLabel };
}

function hubTerminalBaseFromLookup(lookup, fromCov, toCov) {
  if (!fromCov?._id || !toCov?._id) return null;
  const idKey = `${String(fromCov._id)}|${String(toCov._id)}`;
  if (lookup.byPair.has(idKey)) return lookup.byPair.get(idKey);
  const lk = `${normalizeLocationLabel(terminalPointLabel(fromCov))}|${normalizeLocationLabel(
    terminalPointLabel(toCov)
  )}`;
  if (lookup.byLabel.has(lk)) return lookup.byLabel.get(lk);
  /** Same corridor leg, opposite direction — one matrix row is enough (symmetric base fare). */
  const revId = `${String(toCov._id)}|${String(fromCov._id)}`;
  if (lookup.byPair.has(revId)) return lookup.byPair.get(revId);
  const revLk = `${normalizeLocationLabel(terminalPointLabel(toCov))}|${normalizeLocationLabel(
    terminalPointLabel(fromCov)
  )}`;
  if (lookup.byLabel.has(revLk)) return lookup.byLabel.get(revLk);
  return null;
}

/**
 * Build directed edges from deployed routes (`corridor_routes` + Atlas `FareRoutes`): each leg is
 * origin → via… → destination with a fare_matrix_entries hub-terminal row per consecutive pair.
 * Dijkstra minimizes total base fare (cheapest multi-hop composition).
 */
async function findMultiSegmentHubPath(lookup, startHubId, endHubId, coverages) {
  const from = String(startHubId || "");
  const to = String(endHubId || "");
  if (!from || !to || from === to) return null;

  const covById = new Map(coverages.map((c) => [String(c._id), c]));
  const [corridorDocs, fareRouteDocs] = await Promise.all([
    CorridorRoute.find({ suspended: { $ne: true } }).lean(),
    FareRoute.find({ suspended: { $ne: true } }).lean(),
  ]);
  const routeById = new Map();
  for (const r of corridorDocs) routeById.set(String(r._id), r);
  for (const r of fareRouteDocs) {
    if (!routeById.has(String(r._id))) routeById.set(String(r._id), r);
  }
  const corridors = [...routeById.values()];
  const adj = new Map();

  for (const r of corridors) {
    const chain = [
      String(r.originCoverageId),
      ...(Array.isArray(r.viaCoverageIds) ? r.viaCoverageIds.map(String) : []),
      String(r.destinationCoverageId),
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const ca = covById.get(a);
      const cb = covById.get(b);
      if (!ca || !cb) continue;

      const forward = hubTerminalBaseFromLookup(lookup, ca, cb);
      if (forward != null && forward >= 0) {
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push({
          to: b,
          w: forward,
          fromLabel: terminalPointLabel(ca),
          toLabel: terminalPointLabel(cb),
        });
      }
      const backward = hubTerminalBaseFromLookup(lookup, cb, ca);
      if (backward != null && backward >= 0) {
        if (!adj.has(b)) adj.set(b, []);
        adj.get(b).push({
          to: a,
          w: backward,
          fromLabel: terminalPointLabel(cb),
          toLabel: terminalPointLabel(ca),
        });
      }
    }
  }

  const nodes = new Set([from, to]);
  for (const k of adj.keys()) nodes.add(k);
  for (const edges of adj.values()) {
    for (const e of edges) nodes.add(e.to);
  }

  const dist = new Map();
  const prev = new Map();
  for (const n of nodes) dist.set(n, Infinity);
  dist.set(from, 0);
  const visited = new Set();

  while (visited.size < nodes.size) {
    let u = null;
    let best = Infinity;
    for (const n of nodes) {
      if (visited.has(n)) continue;
      const d = dist.get(n);
      if (d < best) {
        best = d;
        u = n;
      }
    }
    if (u == null || best === Infinity) break;
    visited.add(u);
    if (u === to) break;
    for (const e of adj.get(u) || []) {
      const nd = best + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: u, edge: e });
      }
    }
  }

  if ((dist.get(to) ?? Infinity) === Infinity) return null;

  const segments = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur);
    if (!p) return null;
    segments.unshift({
      fromId: p.from,
      toId: cur,
      fromLabel: p.edge.fromLabel,
      toLabel: p.edge.toLabel,
      basePesos: p.edge.w,
    });
    cur = p.from;
  }

  return {
    segments,
    totalBase: dist.get(to),
    pathSource: "corridor_graph",
  };
}

function abbrevHubToken(label) {
  const raw = String(label || "").trim();
  if (!raw) return "?";
  const beforeParen = (() => {
    const idx = raw.indexOf("(");
    return idx >= 0 ? raw.slice(0, idx).trim() : raw;
  })();
  const core = shortPlaceLabel(beforeParen);
  const parts = core.split(/[\s,.-]+/).filter((p) => p.length > 0 && /^[A-Za-z0-9]/.test(p));
  if (parts.length >= 2) {
    return parts
      .map((p) => String(p[0] || "").toUpperCase())
      .join("")
      .slice(0, 6);
  }
  const w = (parts[0] || core).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (w.length <= 4) return w || "?";
  return w.slice(0, 3);
}

function segmentPairAbbrev(fromLabel, toLabel) {
  return `${abbrevHubToken(fromLabel)}-${abbrevHubToken(toLabel)}`;
}

/**
 * Passenger-facing line: ₱20.00 (DC-MAR) + ₱50.00 (MAR-VAL) + ₱63.00 (Distance) = ₱133.00
 */
function formatFareBreakdownEquation({
  segmentLines,
  distanceChargePesos,
  originKm,
  destKm,
  subtotalRoundedHalf,
}) {
  const parts = Array.isArray(segmentLines) ? [...segmentLines] : [];
  const o = Number(originKm) || 0;
  const d = Number(destKm) || 0;
  const distP = Number(distanceChargePesos) || 0;
  if (o + d > 0 && distP > 0) {
    parts.push(`₱${distP.toFixed(2)} (Distance)`);
  }
  if (!parts.length) return null;
  return `${parts.join(" + ")} = ₱${Number(subtotalRoundedHalf).toFixed(2)}`;
}

function formatMultiSegmentPricingSummary({
  segments,
  originKm,
  destKm,
  perKm,
  distanceChargePesos,
  pct,
  fare,
  subtotalRoundedHalf,
}) {
  const segmentLines = (segments || []).map((s) => {
    const tag = segmentPairAbbrev(s.fromLabel, s.toLabel);
    return `₱${Number(s.basePesos).toFixed(2)} (${tag})`;
  });
  const o = Number(originKm) || 0;
  const d = Number(destKm) || 0;
  const totalKm = o + d;
  const pk = Number(perKm) || 0;
  const distP = Number(distanceChargePesos) || 0;
  const kmDetail =
    totalKm > 0 && pk > 0
      ? ` [${formatGeoKmForPerKmLine(totalKm, distP, pk)} km × ₱${pk.toFixed(2)}/km]`
      : "";
  const equation = formatFareBreakdownEquation({
    segmentLines,
    distanceChargePesos: distP,
    originKm: o,
    destKm: d,
    subtotalRoundedHalf,
  });
  let tail = "";
  if (Number(pct) > 0) {
    tail = ` → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
  } else if (Number(subtotalRoundedHalf) !== Number(fare)) {
    tail = ` → ₱${Number(fare).toFixed(2)} total`;
  } else {
    tail = " total";
  }
  if (equation) {
    return `${equation}${kmDetail}${tail}`;
  }
  return `₱${Number(fare).toFixed(2)}${tail}`;
}

/**
 * @param {string} category - adult | regular | student | pwd | senior
 */
async function computeTicketFare({ startLocation, destination, category, clientFare }) {
  const settings = await getGlobalSettingsLean();
  const farePerKmSetting = Number(settings.farePerKmPesos);
  const perKm = Number.isFinite(farePerKmSetting) && farePerKmSetting >= 0 ? farePerKmSetting : 0;

  const catRaw = String(category || "adult").toLowerCase();
  const cat =
    catRaw === "regular" ? "adult" : ["student", "pwd", "senior"].includes(catRaw) ? catRaw : "adult";
  const pct = discountPctForCategory(settings, cat);

  const coverages = await RouteCoverage.find().lean();
  const startRes = resolveTicketLocationString(startLocation, coverages);
  const endRes = resolveTicketLocationString(destination, coverages);

  let matrixEntry = null;
  let pricingMode = "none";
  let originKm = 0;
  let destKm = 0;
  let hubStartLabel = null;
  let hubEndLabel = null;

  const interHub =
    startRes &&
    endRes &&
    startRes.cov &&
    endRes.cov &&
    String(startRes.cov._id) !== String(endRes.cov._id);

  const preTerminalDest =
    Boolean(interHub) &&
    endRes.kind === "stop" &&
    endRes.stop &&
    stopIsBeforeHubTerminal(endRes.cov, endRes.stop, startRes.cov) &&
    preTerminalUsesDistanceOnlyPolicy(endRes.cov);

  if (preTerminalDest && startRes.cov?.terminal && endRes.stop) {
    const chainSpur = await tryPreTerminalChainPlusSpur({
      startRes,
      endRes,
      settings,
      coverages,
      perKm,
      pct,
      cat,
      clientFare,
    });
    if (chainSpur) return chainSpur;

    /**
     * Single hub hop to destination corridor (e.g. Don Carlos → Camp I before Maramag IBT): do **not** add the
     * DC→MIBT matrix row — fare is only origin terminal → alighting stop × fare/km. Multi-hop pre-terminal trips
     * are priced above via `tryPreTerminalChainPlusSpur` (matrix legs except last + spur from previous hub).
     */
    const oTerm = startRes.cov.terminal;
    const dStop = endRes.stop;
    const fullKm = haversineKm(oTerm.latitude, oTerm.longitude, dStop.latitude, dStop.longitude);
    const subtotalRaw = perKm > 0 ? fullKm * perKm : 0;

    if (subtotalRaw > 0) {
      hubStartLabel = startRes.hubMatrixLabel;
      hubEndLabel = endRes.hubMatrixLabel;
      const originLabel = terminalPointLabel(startRes.cov);
      const subtotalRoundedHalf = roundFareToNearestHalfPeso(subtotalRaw);
      const fareAfterDiscount = applyDiscount(subtotalRoundedHalf, pct);
      const fare = roundFareToNearestHalfPeso(fareAfterDiscount);
      const distCharge = perKm > 0 ? Math.round(fullKm * perKm * 100) / 100 : 0;
      const kmLine = formatGeoKmForPerKmLine(fullKm, distCharge, perKm);
      let fareBreakdownDisplay = `₱${distCharge.toFixed(2)} (${kmLine} km × ₱${Number(perKm).toFixed(2)}/km from ${originLabel})`;
      if (Number(pct) > 0) {
        fareBreakdownDisplay += ` → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
      } else {
        fareBreakdownDisplay += ` → ₱${Number(fare).toFixed(2)} total`;
      }
      return {
        matched: true,
        fare,
        baseFarePesos: 0,
        discountPct: pct,
        categoryUsed: cat,
        pricingMode: "pre_terminal_distance_only",
        extraDistanceKm: fullKm,
        distanceChargePesos: distCharge,
        farePerKmPesos: perKm,
        hubStartLabel,
        hubEndLabel,
        subtotalRoundedHalfPeso: subtotalRoundedHalf,
        preTerminalDestination: true,
        originSpurKm: fullKm,
        destinationSpurKm: 0,
        fareBreakdownDisplay,
        pricingSummary: formatPreTerminalPricingSummary({
          fullKm,
          perKm,
          distCharge,
          pct,
          fare,
          subtotalRoundedHalf,
        }),
      };
    }
    const n = clientFare != null ? Number(clientFare) : NaN;
    return {
      matched: false,
      fare: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN,
      baseFarePesos: null,
      discountPct: null,
      categoryUsed: cat,
      pricingMode: "pre_terminal_unpriced",
      extraDistanceKm: fullKm,
      distanceChargePesos: null,
      farePerKmPesos: perKm,
      hubStartLabel: startRes.hubMatrixLabel,
      hubEndLabel: endRes.hubMatrixLabel,
      subtotalRoundedHalfPeso: null,
      preTerminalDestination: true,
    };
  }

  const sameHub =
    Boolean(startRes && endRes && startRes.cov && endRes.cov && String(startRes.cov._id) === String(endRes.cov._id));

  /** Same location / corridor only: no hub-to-hub matrix — distance × fare/km (chainage when set). */
  if (sameHub) {
    if (startRes.kind === "terminal" && endRes.kind === "terminal") {
      const n = clientFare != null ? Number(clientFare) : NaN;
      return {
        matched: false,
        fare: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN,
        baseFarePesos: null,
        discountPct: null,
        categoryUsed: cat,
        pricingMode: "intra_hub_same_terminal",
        extraDistanceKm: null,
        distanceChargePesos: null,
        farePerKmPesos: perKm,
        hubStartLabel: startRes.hubMatrixLabel,
        hubEndLabel: endRes.hubMatrixLabel,
        subtotalRoundedHalfPeso: null,
        preTerminalDestination: false,
        message: "Pick a bus stop or a different destination — both ends are the same terminal.",
      };
    }

    const travelKm = intraHubTravelKm(startRes.cov, startRes, endRes);
    if (!Number.isFinite(travelKm) || travelKm < 0) {
      const n = clientFare != null ? Number(clientFare) : NaN;
      return {
        matched: false,
        fare: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN,
        baseFarePesos: null,
        discountPct: null,
        categoryUsed: cat,
        pricingMode: "intra_hub_unresolved",
        extraDistanceKm: null,
        distanceChargePesos: null,
        farePerKmPesos: perKm,
        hubStartLabel: startRes.hubMatrixLabel,
        hubEndLabel: endRes.hubMatrixLabel,
        subtotalRoundedHalfPeso: null,
        preTerminalDestination: false,
        message: "Could not measure distance for this same-hub trip — check stop coordinates in Admin.",
      };
    }

    if (perKm <= 0) {
      const n = clientFare != null ? Number(clientFare) : NaN;
      return {
        matched: false,
        fare: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN,
        baseFarePesos: null,
        discountPct: null,
        categoryUsed: cat,
        pricingMode: "intra_hub_needs_per_km",
        extraDistanceKm: travelKm,
        distanceChargePesos: null,
        farePerKmPesos: perKm,
        hubStartLabel: startRes.hubMatrixLabel,
        hubEndLabel: endRes.hubMatrixLabel,
        subtotalRoundedHalfPeso: null,
        preTerminalDestination: false,
        message: "Set Fare per km in Admin (Fare Management) to price trips within the same hub (terminal ↔ stops).",
      };
    }

    const subtotalRaw = travelKm * perKm;
    const subtotalRoundedHalf = roundFareToNearestHalfPeso(subtotalRaw);
    const fareAfterDiscount = applyDiscount(subtotalRoundedHalf, pct);
    const fare = roundFareToNearestHalfPeso(fareAfterDiscount);
    return {
      matched: true,
      fare,
      baseFarePesos: 0,
      discountPct: pct,
      categoryUsed: cat,
      pricingMode: "intra_hub_per_km",
      extraDistanceKm: travelKm,
      distanceChargePesos: Math.round(subtotalRaw * 100) / 100,
      farePerKmPesos: perKm,
      hubStartLabel: startRes.hubMatrixLabel,
      hubEndLabel: endRes.hubMatrixLabel,
      subtotalRoundedHalfPeso: subtotalRoundedHalf,
      preTerminalDestination: false,
      originSpurKm: 0,
      destinationSpurKm: 0,
      pricingSummary: formatIntraHubPricingSummary({
        travelKm,
        perKm,
        pct,
        fare,
        subtotalRoundedHalf,
      }),
    };
  }

  if (startRes && endRes) {
    hubStartLabel = startRes.hubMatrixLabel;
    hubEndLabel = endRes.hubMatrixLabel;
    /** Spur legs: always measured from each hub’s **terminal** to the chosen stop (Rule A), using chainage |Δkm| when set. */
    originKm =
      startRes.kind === "stop" && startRes.stop
        ? corridorKmDeltaStopFromTerminal(startRes.cov, startRes.stop)
        : 0;
    destKm =
      endRes.kind === "stop" && endRes.stop ? corridorKmDeltaStopFromTerminal(endRes.cov, endRes.stop) : 0;

    if (interHub) {
      const lookup = await loadHubTerminalFareMatrixLookup();
      const multi = await resolveInterHubMatrixPath(
        lookup,
        String(startRes.cov._id),
        String(endRes.cov._id),
        coverages,
        settings
      );
      if (multi && multi.segments.length > 0) {
        const sumMatrixBase = multi.totalBase;
        const distanceCharge = perKm * (originKm + destKm);
        const distanceChargePesos = Math.round(distanceCharge * 100) / 100;
        const subtotalRaw = sumMatrixBase + distanceCharge;
        const subtotalRoundedHalf = roundFareToNearestHalfPeso(subtotalRaw);
        const fareAfterDiscount = applyDiscount(subtotalRoundedHalf, pct);
        const fare = roundFareToNearestHalfPeso(fareAfterDiscount);
        const firstLab = multi.segments[0].fromLabel;
        const lastLab = multi.segments[multi.segments.length - 1].toLabel;
        const segmentLines = multi.segments.map((s) => {
          const tag = segmentPairAbbrev(s.fromLabel, s.toLabel);
          return `₱${Number(s.basePesos).toFixed(2)} (${tag})`;
        });
        const equation = formatFareBreakdownEquation({
          segmentLines,
          distanceChargePesos,
          originKm,
          destKm,
          subtotalRoundedHalf,
        });
        let fareBreakdownDisplay = equation;
        if (equation) {
          if (Number(pct) > 0) {
            fareBreakdownDisplay = `${equation} → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
          } else if (Number(subtotalRoundedHalf) !== Number(fare)) {
            fareBreakdownDisplay = `${equation} → ₱${Number(fare).toFixed(2)} total`;
          } else {
            fareBreakdownDisplay = `${equation} total`;
          }
        }
        return {
          matched: true,
          fare,
          baseFarePesos: sumMatrixBase,
          discountPct: pct,
          categoryUsed: cat,
          pricingMode: multi.pathSource === "hub_chain" ? "hub_linear_chain_matrix" : "hub_multi_segment_matrix",
          extraDistanceKm: originKm + destKm,
          distanceChargePesos,
          farePerKmPesos: perKm,
          hubStartLabel: firstLab,
          hubEndLabel: lastLab,
          subtotalRoundedHalfPeso: subtotalRoundedHalf,
          preTerminalDestination: false,
          originSpurKm: originKm,
          destinationSpurKm: destKm,
          segmentFares: multi.segments,
          fareBreakdownDisplay,
          pricingSummary: formatMultiSegmentPricingSummary({
            segments: multi.segments,
            originKm,
            destKm,
            perKm,
            distanceChargePesos,
            pct,
            fare,
            subtotalRoundedHalf,
          }),
        };
      }
    }

    if (interHub) {
      matrixEntry = await findMatrixEntryHubTerminalToHubTerminal(startRes.cov, endRes.cov);
      if (matrixEntry) pricingMode = "hub_matrix_plus_distance";
      if (!matrixEntry) {
        matrixEntry = await findMatrixEntryByLabels(hubStartLabel, hubEndLabel);
        if (matrixEntry) pricingMode = "hub_matrix_plus_distance";
      }
    } else {
      matrixEntry = await findMatrixEntryByResolvedEndpoints(startRes, endRes);
      if (matrixEntry) pricingMode = "hub_matrix_plus_distance";
      if (!matrixEntry) {
        matrixEntry = await findMatrixEntryByLabels(hubStartLabel, hubEndLabel);
        if (matrixEntry) pricingMode = "hub_matrix_plus_distance";
      }
    }
  }

  if (!matrixEntry) {
    matrixEntry = await findMatrixEntryByLabels(startLocation, destination);
    if (matrixEntry) pricingMode = "matrix_direct";
    originKm = 0;
    destKm = 0;
    hubStartLabel = null;
    hubEndLabel = null;
  }

  if (!matrixEntry) {
    const n = clientFare != null ? Number(clientFare) : NaN;
    return {
      matched: false,
      fare: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN,
      baseFarePesos: null,
      discountPct: null,
      categoryUsed: cat,
      pricingMode: "unmatched",
      extraDistanceKm: null,
      distanceChargePesos: null,
      farePerKmPesos: perKm,
      hubStartLabel: null,
      hubEndLabel: null,
      subtotalRoundedHalfPeso: null,
      preTerminalDestination: false,
    };
  }

  const matrixBase = Number(matrixEntry.baseFarePesos);
  const distanceCharge =
    pricingMode === "hub_matrix_plus_distance" ? perKm * (originKm + destKm) : 0;
  const distanceChargePesos =
    pricingMode === "hub_matrix_plus_distance" ? Math.round(distanceCharge * 100) / 100 : 0;
  const subtotalRaw = matrixBase + distanceCharge;
  const subtotalRoundedHalf = roundFareToNearestHalfPeso(subtotalRaw);
  const fareAfterDiscount = applyDiscount(subtotalRoundedHalf, pct);
  const fare = roundFareToNearestHalfPeso(fareAfterDiscount);

  const pricingSummary =
    pricingMode === "hub_matrix_plus_distance"
      ? formatHubMatrixPricingSummary({
          matrixBase,
          originKm,
          destKm,
          perKm,
          distanceChargePesos,
          pct,
          fare,
          subtotalRoundedHalf,
        })
      : null;

  let fareBreakdownDisplay = null;
  if (pricingMode === "hub_matrix_plus_distance" && hubStartLabel && hubEndLabel) {
    const segTag = segmentPairAbbrev(hubStartLabel, hubEndLabel);
    const segmentLines = [`₱${Number(matrixBase).toFixed(2)} (${segTag})`];
    const equation = formatFareBreakdownEquation({
      segmentLines,
      distanceChargePesos,
      originKm,
      destKm,
      subtotalRoundedHalf,
    });
    if (equation) {
      if (Number(pct) > 0) {
        fareBreakdownDisplay = `${equation} → ₱${Number(fare).toFixed(2)} after ${Number(pct)}% discount`;
      } else if (Number(subtotalRoundedHalf) !== Number(fare)) {
        fareBreakdownDisplay = `${equation} → ₱${Number(fare).toFixed(2)} total`;
      } else {
        fareBreakdownDisplay = `${equation} total`;
      }
    }
  }

  return {
    matched: true,
    fare,
    baseFarePesos: matrixBase,
    discountPct: pct,
    categoryUsed: cat,
    pricingMode,
    extraDistanceKm: pricingMode === "hub_matrix_plus_distance" ? originKm + destKm : 0,
    distanceChargePesos: distanceChargePesos,
    farePerKmPesos: perKm,
    hubStartLabel,
    hubEndLabel,
    subtotalRoundedHalfPeso: subtotalRoundedHalf,
    preTerminalDestination: false,
    originSpurKm: pricingMode === "hub_matrix_plus_distance" ? originKm : 0,
    destinationSpurKm: pricingMode === "hub_matrix_plus_distance" ? destKm : 0,
    pricingSummary,
    fareBreakdownDisplay,
  };
}

module.exports = {
  normalizeLocationLabel,
  terminalPointLabel,
  stopPointLabel,
  resolveEndpointToken,
  listFareLocationOptions,
  listFareLocationEndpointPairs,
  getGlobalSettingsLean,
  discountPctForCategory,
  applyDiscount,
  findMatrixEntryByLabels,
  computeTicketFare,
};
