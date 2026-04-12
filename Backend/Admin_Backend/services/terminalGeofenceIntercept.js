const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const RouteCoverage = require("../models/RouteCoverage");
const store = require("./liveDispatchStore");
const { broadcastLiveBoard, broadcastBusTerminalArrival } = require("../sockets/socket");
const { buildPublicPayload } = require("../routes/liveDispatch");

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/gi, " ")
    .trim();
}

function routeOriginLabel(routeLabel) {
  const s = String(routeLabel || "");
  const parts = s.split(/\s*[→➔>–—-]\s*/);
  return (parts[0] || s).trim();
}

function tokens(normStr) {
  return normStr.split(/\s+/).filter((t) => t.length > 2);
}

function namesMatchTerminal(block, doc) {
  const dep = norm(block.departurePoint);
  const origin = norm(routeOriginLabel(block.routeLabel));
  const loc = norm(doc.locationName);
  const termName = norm(doc.terminal?.name);
  const bucket = [dep, origin].filter(Boolean);
  const terminals = [loc, termName].filter(Boolean);
  for (const b of bucket) {
    for (const t of terminals) {
      if (!b || !t) continue;
      if (b.includes(t) || t.includes(b)) return true;
      const bt = tokens(b);
      const tt = tokens(t);
      for (const x of bt) {
        for (const y of tt) {
          if (x.includes(y) || y.includes(x)) return true;
        }
      }
    }
  }
  return false;
}

function splitRouteLabel(routeLabel) {
  const s = String(routeLabel || "").trim();
  if (!s) return null;
  const parts = s.split(/\s*[→➔>–—-]\s*/).map((v) => v.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { from: parts[0], to: parts[parts.length - 1] };
}

let terminalCache = { at: 0, rows: [] };
const CACHE_MS = 45_000;

async function loadTerminalDocs() {
  if (Date.now() - terminalCache.at < CACHE_MS && terminalCache.rows.length) {
    return terminalCache.rows;
  }
  const rows = await RouteCoverage.find({ pointType: "terminal" }).select("locationName terminal").lean();
  terminalCache = { at: Date.now(), rows };
  return rows;
}

/**
 * When live GPS enters an admin-configured terminal geofence, mark matching live-dispatch blocks as ARRIVING.
 */
async function onBusGpsForTerminalArrival(io, busId, lat, lng) {
  if (mongoose.connection.readyState !== 1 || !io) return;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return;

  let terminals;
  try {
    terminals = await loadTerminalDocs();
  } catch (e) {
    console.warn("[terminal-geofence] load terminals:", e.message);
    return;
  }

  const sorted = [...terminals]
    .filter((d) => d.terminal && Number.isFinite(d.terminal.latitude) && Number.isFinite(d.terminal.longitude))
    .sort((a, b) => String(a.locationName).localeCompare(String(b.locationName)));

  const hits = [];
  for (const doc of sorted) {
    const t = doc.terminal;
    const r = Number(t.geofenceRadiusM);
    const radius = Number.isFinite(r) && r >= 50 ? r : 500;
    const d = haversineMeters(la, ln, t.latitude, t.longitude);
    if (d <= radius) hits.push({ doc, distanceM: d });
  }
  if (!hits.length) return;

  const blocks = store.listBlocks().filter((b) => String(b.busId) === String(busId) && b.status !== "cancelled");
  if (!blocks.length) return;

  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hh = String(parts.find((p) => p.type === "hour")?.value ?? "0").padStart(2, "0");
  const mm = String(parts.find((p) => p.type === "minute")?.value ?? "0").padStart(2, "0");
  const lockedEta = `${hh}:${mm}`;

  let changed = false;
  for (const hit of hits) {
    const terminalDisplay =
      (hit.doc.terminal && hit.doc.terminal.name && String(hit.doc.terminal.name).trim()) ||
      String(hit.doc.locationName || "").trim() ||
      "Terminal";
    for (const block of blocks) {
      if (!namesMatchTerminal(block, hit.doc)) continue;
      if (block.status === "arriving" && String(block.arrivalTerminalName || "") === terminalDisplay) {
        continue;
      }
      const routeParts = splitRouteLabel(block.routeLabel);
      if (routeParts && norm(routeParts.to) === norm(terminalDisplay)) {
        // Docked at destination terminal -> flip to return leg automatically.
        const flippedLabel = `${routeParts.to} → ${routeParts.from}`;
        await Bus.updateOne({ busId: String(block.busId) }, { route: flippedLabel }).catch(() => {});
        store.updateBlock(block.id, {
          routeLabel: flippedLabel,
          departurePoint: routeParts.to,
        });
      }
      store.updateBlock(block.id, {
        status: "arriving",
        arrivalDetectedAt: now.toISOString(),
        arrivalTerminalName: terminalDisplay,
        gate: terminalDisplay,
        currentTerminalGate: terminalDisplay,
        arrivalLockedEta: lockedEta,
      });
      changed = true;
    }
  }

  if (!changed) return;

  const primary = hits[0];
  const terminalLabel =
    primary &&
    ((primary.doc.terminal && String(primary.doc.terminal.name || "").trim()) ||
      String(primary.doc.locationName || "").trim() ||
      "Terminal");
  if (primary && terminalLabel) {
    broadcastBusTerminalArrival(io, {
      bus_id: String(busId),
      terminalName: terminalLabel,
      latitude: la,
      longitude: ln,
      recordedAt: now.toISOString(),
    });
  }

  try {
    const payload = await buildPublicPayload();
    broadcastLiveBoard(io, payload);
  } catch (e) {
    console.warn("[terminal-geofence] broadcast live board failed:", e.message);
  }
}

module.exports = { onBusGpsForTerminalArrival, namesMatchTerminal, haversineMeters };
