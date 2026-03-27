const mongoose = require("mongoose");
const { getMysqlPool } = require("../db/mysqlPool");
const FareGlobalSettings = require("../models/FareGlobalSettings");
const FareMatrixEntry = require("../models/FareMatrixEntry");
const RouteCoverage = require("../models/RouteCoverage");

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

async function listTicketingLocationEndpoints() {
  const pool = getMysqlPool();
  if (!pool) return { starts: [], ends: [] };
  try {
    const [startRows] = await pool.query(
      `SELECT DISTINCT TRIM(start_location) AS loc FROM tickets
       WHERE start_location IS NOT NULL AND TRIM(start_location) <> ''
       ORDER BY loc ASC`
    );
    const [endRows] = await pool.query(
      `SELECT DISTINCT TRIM(destination) AS loc FROM tickets
       WHERE destination IS NOT NULL AND TRIM(destination) <> ''
       ORDER BY loc ASC`
    );
    const starts = [];
    const seenS = new Set();
    for (const row of startRows) {
      const loc = String(row.loc || "").trim();
      if (!loc || seenS.has(normalizeLocationLabel(loc))) continue;
      seenS.add(normalizeLocationLabel(loc));
      starts.push({ token: `tick:S:${encodeURIComponent(loc)}`, label: loc });
    }
    const ends = [];
    const seenE = new Set();
    for (const row of endRows) {
      const loc = String(row.loc || "").trim();
      if (!loc || seenE.has(normalizeLocationLabel(loc))) continue;
      seenE.add(normalizeLocationLabel(loc));
      ends.push({ token: `tick:E:${encodeURIComponent(loc)}`, label: loc });
    }
    return { starts, ends };
  } catch {
    return { starts: [], ends: [] };
  }
}

async function listFareLocationOptions() {
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
  const { starts, ends } = await listTicketingLocationEndpoints();
  const seen = new Set(options.map((o) => o.token));
  for (const o of starts) {
    if (!seen.has(o.token)) {
      options.push(o);
      seen.add(o.token);
    }
  }
  for (const o of ends) {
    if (!seen.has(o.token)) {
      options.push(o);
      seen.add(o.token);
    }
  }
  return options;
}

/**
 * Fare Management dropdowns: terminals and stops from admin-created RouteCoverage only
 * (Location Management). Same list for start and destination.
 */
async function listFareLocationEndpointPairs() {
  const options = [];
  const docs = await RouteCoverage.find().sort({ locationName: 1 }).lean();
  for (const cov of docs) {
    const id = String(cov._id);
    options.push({ token: `t:${id}`, label: terminalPointLabel(cov) });
    for (const s of cov.stops || []) {
      if (!Number.isFinite(s.sequence)) continue;
      options.push({ token: `s:${id}:${s.sequence}`, label: stopPointLabel(cov, s) });
    }
  }
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
    }).then((d) => d.toObject());
  }
  return doc;
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

async function findMatrixEntryByLabels(startLocation, destination) {
  const sn = normalizeLocationLabel(startLocation);
  const en = normalizeLocationLabel(destination);
  if (!sn || !en) return null;
  return FareMatrixEntry.findOne({ startNorm: sn, endNorm: en }).lean();
}

/**
 * @param {string} category - adult | regular | student | pwd | senior
 */
async function computeTicketFare({ startLocation, destination, category, clientFare }) {
  const entry = await findMatrixEntryByLabels(startLocation, destination);
  if (!entry) {
    const n = clientFare != null ? Number(clientFare) : NaN;
    return {
      matched: false,
      fare: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN,
      baseFarePesos: null,
      discountPct: null,
      categoryUsed: "adult",
    };
  }
  const settings = await getGlobalSettingsLean();
  const catRaw = String(category || "adult").toLowerCase();
  const cat =
    catRaw === "regular" ? "adult" : ["student", "pwd", "senior"].includes(catRaw) ? catRaw : "adult";
  const pct = discountPctForCategory(settings, cat);
  const fare = applyDiscount(entry.baseFarePesos, pct);
  return {
    matched: true,
    fare,
    baseFarePesos: entry.baseFarePesos,
    discountPct: pct,
    categoryUsed: cat,
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
