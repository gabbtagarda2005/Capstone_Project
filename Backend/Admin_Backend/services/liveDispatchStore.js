const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "live-dispatch.json");

/**
 * departurePoint = terminal / place the bus departs from (shown on passenger board).
 * status: on-time | delayed | cancelled | arriving (arriving = GPS terminal geofence intercept).
 * currentTerminalGate = last terminal name from geofence (shown as Gate after arrival phase ends).
 * @type {Array<{ id: string, busId: string, routeId: string, routeLabel: string, departurePoint: string, scheduledDeparture: string, serviceDate?: string, status: string, arrivalDetectedAt?: string, arrivalTerminalName?: string, gate?: string, arrivalLockedEta?: string, currentTerminalGate?: string, etaMinutes?: number, etaTargetIso?: string, nextTerminal?: string, createdAt?: string, updatedAt?: string }>}
 */
let blocks = [];
/** @type {{ holidayName: string, message: string, updatedAt: string } | null} */
let holidayBanner = null;

function tsMs(v) {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Keep one canonical row per bus (latest updatedAt/createdAt wins). */
function dedupeBlocksPerBus(rows) {
  const m = new Map();
  for (const r of rows) {
    const bid = String(r?.busId || "").trim();
    if (!bid) continue;
    const prev = m.get(bid);
    if (!prev || tsMs(r.updatedAt || r.createdAt) >= tsMs(prev.updatedAt || prev.createdAt)) {
      m.set(bid, r);
    }
  }
  return [...m.values()];
}

function deriveDeparturePoint(routeLabel, explicit) {
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const s = String(routeLabel || "").trim();
  if (!s) return "—";
  const parts = s.split(/\s*[–—-]\s*/);
  return (parts[0] || s).trim() || "—";
}

function load() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = fs.readFileSync(DATA_PATH, "utf8");
      const j = JSON.parse(raw);
      const rawBlocks = Array.isArray(j.blocks) ? j.blocks : [];
      const normalized = rawBlocks.map((b) => ({
        ...b,
        departurePoint: b.departurePoint || deriveDeparturePoint(b.routeLabel, null),
      }));
      blocks = dedupeBlocksPerBus(normalized);
      holidayBanner = j.holidayBanner && typeof j.holidayBanner === "object" ? j.holidayBanner : null;
      // Persist migration so stale duplicate rows do not come back on next reboot.
      if (blocks.length !== rawBlocks.length) save();
    }
  } catch {
    blocks = [];
    holidayBanner = null;
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify({ blocks, holidayBanner }, null, 2), "utf8");
  } catch (e) {
    console.warn("[live-dispatch] persist failed:", e.message);
  }
}

load();

function manilaTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** At Manila midnight semantics: roll each block to today's service date and clear prior-day movement state. */
function syncServiceDatesToManilaToday() {
  const today = manilaTodayYmd();
  let changed = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const sd = b.serviceDate != null && String(b.serviceDate).trim() ? String(b.serviceDate).trim().slice(0, 10) : "";
    if (sd === today) continue;
    blocks[i] = {
      ...b,
      serviceDate: today,
      status: normalizeStatus("on-time"),
      updatedAt: new Date().toISOString(),
    };
    delete blocks[i].arrivalDetectedAt;
    delete blocks[i].arrivalTerminalName;
    delete blocks[i].gate;
    delete blocks[i].arrivalLockedEta;
    delete blocks[i].currentTerminalGate;
    changed = true;
  }
  if (changed) save();
}

function listBlocks() {
  const deduped = dedupeBlocksPerBus(blocks);
  if (deduped.length !== blocks.length) {
    blocks = deduped;
    save();
  }
  return blocks.map((b) => ({ ...b }));
}

function normalizeStatus(status) {
  const s = String(status || "on-time").trim();
  if (s === "delayed" || s === "cancelled" || s === "arriving") return s;
  return "on-time";
}

function createBlock({ busId, routeId, routeLabel, scheduledDeparture, status, departurePoint, serviceDate }) {
  const id = randomUUID();
  const rlab = String(routeLabel || routeId).trim();
  const block = {
    id,
    busId: String(busId).trim(),
    routeId: String(routeId).trim(),
    routeLabel: rlab,
    departurePoint: deriveDeparturePoint(rlab, departurePoint),
    scheduledDeparture: String(scheduledDeparture).trim(),
    status: normalizeStatus(status),
    createdAt: new Date().toISOString(),
  };
  if (serviceDate != null && String(serviceDate).trim()) {
    block.serviceDate = String(serviceDate).trim().slice(0, 10);
  }
  blocks.push(block);
  save();
  return { ...block };
}

function updateBlock(id, patch) {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const cur = blocks[i];
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  if (!next.departurePoint) next.departurePoint = deriveDeparturePoint(next.routeLabel, null);
  if (patch.status != null) {
    next.status = normalizeStatus(patch.status);
    if (next.status === "on-time" || next.status === "delayed") {
      delete next.arrivalDetectedAt;
      delete next.arrivalTerminalName;
      delete next.gate;
      delete next.arrivalLockedEta;
      if (patch.preserveCurrentTerminal !== true) {
        delete next.currentTerminalGate;
      }
    }
  }
  if (patch.currentTerminalGate != null) {
    next.currentTerminalGate = String(patch.currentTerminalGate).trim() || undefined;
    if (!next.currentTerminalGate) delete next.currentTerminalGate;
  }
  if (patch.arrivalDetectedAt != null) next.arrivalDetectedAt = String(patch.arrivalDetectedAt);
  if (patch.arrivalTerminalName != null) next.arrivalTerminalName = String(patch.arrivalTerminalName).trim();
  if (patch.gate != null) next.gate = String(patch.gate).trim();
  if (patch.arrivalLockedEta != null) next.arrivalLockedEta = String(patch.arrivalLockedEta).trim();
  if (patch.etaMinutes !== undefined) {
    const n = Number(patch.etaMinutes);
    if (Number.isFinite(n) && n >= 0) next.etaMinutes = Math.round(n);
    else delete next.etaMinutes;
  }
  if (patch.etaTargetIso !== undefined) {
    const s = String(patch.etaTargetIso || "").trim();
    if (s) next.etaTargetIso = s;
    else delete next.etaTargetIso;
  }
  if (patch.nextTerminal !== undefined) {
    const s = String(patch.nextTerminal || "").trim();
    if (s) next.nextTerminal = s;
    else delete next.nextTerminal;
  }
  if (patch.scheduledDeparture != null) next.scheduledDeparture = String(patch.scheduledDeparture).trim();
  if (patch.busId != null) next.busId = String(patch.busId).trim();
  if (patch.routeId != null) next.routeId = String(patch.routeId).trim();
  if (patch.routeLabel != null) next.routeLabel = String(patch.routeLabel).trim();
  if (patch.departurePoint != null) next.departurePoint = deriveDeparturePoint(next.routeLabel, patch.departurePoint);
  else if (patch.routeLabel != null) next.departurePoint = deriveDeparturePoint(next.routeLabel, null);
  if (patch.serviceDate !== undefined) {
    if (patch.serviceDate == null || String(patch.serviceDate).trim() === "") delete next.serviceDate;
    else next.serviceDate = String(patch.serviceDate).trim().slice(0, 10);
  }
  delete next.preserveCurrentTerminal;
  blocks[i] = next;
  save();
  return { ...next };
}

function blockFingerprintMatch(busId, routeId, scheduledDeparture, serviceDate) {
  const sd = serviceDate != null && String(serviceDate).trim() ? String(serviceDate).trim().slice(0, 10) : "";
  return blocks.some(
    (b) =>
      String(b.busId) === String(busId) &&
      String(b.routeId) === String(routeId) &&
      String(b.scheduledDeparture) === String(scheduledDeparture) &&
      (b.serviceDate ? String(b.serviceDate) : "") === sd
  );
}

const WD_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function manilaWeekdayAndYmd(ms) {
  const d = new Date(ms);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const wlong = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "long" })
    .format(d)
    .toLowerCase();
  const wd = WD_MAP[wlong];
  return { ymd, wd: wd === undefined ? null : wd };
}

/**
 * One departure time per selected weekday between startDate and endDate (YYYY-MM-DD, Asia/Manila calendar).
 * @param {number[]} weekdays — JS getDay() convention: 0=Sun … 6=Sat
 */
function bulkWeeklyDepartures({
  busId,
  routeId,
  routeLabel,
  departurePoint,
  departureTime,
  startDate,
  endDate,
  weekdays,
}) {
  const bid = String(busId || "").trim();
  const rid = String(routeId || "").trim();
  if (!bid || !rid) throw new Error("busId and routeId required");
  const rlab = String(routeLabel || routeId).trim();
  let depTime = String(departureTime || "").trim();
  const tparts = depTime.split(":");
  if (tparts.length < 2) throw new Error("departureTime must be HH:mm");
  const hh = String(Math.min(23, Math.max(0, Number(tparts[0]) || 0))).padStart(2, "0");
  const mm = String(Math.min(59, Math.max(0, Number(tparts[1]) || 0))).padStart(2, "0");
  depTime = `${hh}:${mm}`;
  const sd0 = String(startDate || "").trim();
  const sd1 = String(endDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd0) || !/^\d{4}-\d{2}-\d{2}$/.test(sd1)) throw new Error("startDate and endDate must be YYYY-MM-DD");
  if (sd0 > sd1) throw new Error("startDate must be on or before endDate");
  const set = new Set(Array.isArray(weekdays) ? weekdays.map((n) => Number(n)) : []);
  if (set.size === 0) throw new Error("Select at least one weekday");
  const depPoint = deriveDeparturePoint(rlab, departurePoint);
  const startMs = new Date(`${sd0}T12:00:00+08:00`).getTime();
  const endMs = new Date(`${sd1}T12:00:00+08:00`).getTime();
  const now = new Date().toISOString();
  const batch = [];
  for (let t = startMs; t <= endMs; t += 86400000) {
    const { ymd, wd } = manilaWeekdayAndYmd(t);
    if (wd === null || !set.has(wd)) continue;
    if (blockFingerprintMatch(bid, rid, depTime, ymd)) continue;
    batch.push({
      id: randomUUID(),
      busId: bid,
      routeId: rid,
      routeLabel: rlab,
      departurePoint: depPoint,
      scheduledDeparture: depTime,
      serviceDate: ymd,
      status: "on-time",
      createdAt: now,
    });
  }
  if (!batch.length) throw new Error("No matching days in range (or trips already exist)");
  blocks.push(...batch);
  save();
  return batch.map((b) => ({ ...b }));
}

function deleteBlock(id) {
  const before = blocks.length;
  blocks = blocks.filter((b) => b.id !== id);
  if (blocks.length !== before) save();
  return blocks.length !== before;
}

/** Remove every trip row for this bus, then add one row for today (Manila). */
function replaceSingleTripForBus({ busId, routeId, routeLabel, departurePoint, departureTime }) {
  const bid = String(busId || "").trim();
  const rid = String(routeId || "").trim();
  if (!bid || !rid) throw new Error("busId and routeId required");
  syncServiceDatesToManilaToday();
  blocks = blocks.filter((b) => String(b.busId) !== bid);
  const today = manilaTodayYmd();
  const rlab = String(routeLabel || routeId).trim();
  let depTime = String(departureTime || "").trim();
  const tparts = depTime.split(":");
  if (tparts.length < 2) throw new Error("departureTime must be HH:mm");
  const hh = String(Math.min(23, Math.max(0, Number(tparts[0]) || 0))).padStart(2, "0");
  const mm = String(Math.min(59, Math.max(0, Number(tparts[1]) || 0))).padStart(2, "0");
  depTime = `${hh}:${mm}`;
  const depPoint = deriveDeparturePoint(rlab, departurePoint);
  const id = randomUUID();
  const now = new Date().toISOString();
  const block = {
    id,
    busId: bid,
    routeId: rid,
    routeLabel: rlab,
    departurePoint: depPoint,
    scheduledDeparture: depTime,
    serviceDate: today,
    status: "on-time",
    createdAt: now,
    updatedAt: now,
  };
  blocks.push(block);
  save();
  return { ...block };
}

/** After ~5 minutes in ARRIVING, move to ON-TIME for next leg; keep terminal name on Gate. */
function completeArrivalAfterCooldown(id) {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const cur = blocks[i];
  if (cur.status !== "arriving") return { ...cur };
  const terminal =
    (cur.arrivalTerminalName && String(cur.arrivalTerminalName).trim()) ||
    (cur.gate && String(cur.gate).trim()) ||
    (cur.currentTerminalGate && String(cur.currentTerminalGate).trim()) ||
    "";
  const next = {
    ...cur,
    status: "on-time",
    updatedAt: new Date().toISOString(),
  };
  delete next.arrivalDetectedAt;
  delete next.arrivalTerminalName;
  delete next.gate;
  delete next.arrivalLockedEta;
  if (terminal) next.currentTerminalGate = terminal;
  blocks[i] = next;
  save();
  return { ...next };
}

function bulkPeakTemplate({ routeLabel, routeId, startTime, intervalMinutes, count, busIds }) {
  const ids = Array.isArray(busIds) ? busIds.map((s) => String(s).trim()).filter(Boolean) : [];
  if (!ids.length) throw new Error("busIds required");
  const im = Math.max(1, Number(intervalMinutes) || 15);
  const n = Math.max(1, Math.min(48, Number(count) || 12));
  const parts = String(startTime || "06:00").split(":");
  const h0 = Number(parts[0]) || 6;
  const m0 = Number(parts[1]) || 0;
  const rid = String(routeId).trim();
  const rlab = String(routeLabel || routeId).trim();
  const depPoint = deriveDeparturePoint(rlab, null);
  const now = new Date().toISOString();
  const batch = [];
  for (let i = 0; i < n; i++) {
    const mins = h0 * 60 + m0 + i * im;
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    const dep = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const busId = ids[i % ids.length];
    batch.push({
      id: randomUUID(),
      busId,
      routeId: rid,
      routeLabel: rlab,
      departurePoint: depPoint,
      scheduledDeparture: dep,
      status: "on-time",
      createdAt: now,
    });
  }
  blocks.push(...batch);
  save();
  return batch.map((b) => ({ ...b }));
}

function setHoliday({ holidayName, message }) {
  holidayBanner = {
    holidayName: String(holidayName || "Holiday").trim(),
    message: String(message || "Reduced service today.").trim(),
    updatedAt: new Date().toISOString(),
  };
  save();
  return { ...holidayBanner };
}

function clearHoliday() {
  holidayBanner = null;
  save();
}

function getHolidayBanner() {
  return holidayBanner ? { ...holidayBanner } : null;
}

module.exports = {
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  bulkPeakTemplate,
  bulkWeeklyDepartures,
  replaceSingleTripForBus,
  syncServiceDatesToManilaToday,
  completeArrivalAfterCooldown,
  manilaTodayYmd,
  setHoliday,
  clearHoliday,
  getHolidayBanner,
  deriveDeparturePoint,
};
