const CorridorRoute = require("../models/CorridorRoute");

/**
 * Resolves a bus's `route` value (a corridor label like "ROUTE 1", a `CorridorRoute.displayName`,
 * or a legacy literal "A → B" string) to concrete terminal/hub endpoint names.
 *
 * Extracted from the inline `matchRouteEndpoints()` that used to live only in
 * server.js's `/api/public/fleet-buses` handler — services/autoRouteFlip.js needs the exact same
 * resolution to determine a bus's CURRENT effective destination (respecting `routeReversed`)
 * when deciding whether a geofence hit means "the bus has arrived", so this is now the single
 * shared implementation both call.
 */

function hubLabel(cov) {
  if (!cov || typeof cov !== "object") return null;
  const t = cov.terminal && String(cov.terminal.name || "").trim();
  if (t) return t;
  const ln = String(cov.locationName || "").trim();
  return ln || null;
}

function normRouteKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/↔/g, "->")
    .replace(/↔/g, "->")
    .replace(/→/g, "->");
}

let corridorCache = { metas: null, at: 0 };
const CORRIDOR_CACHE_TTL_MS = 30 * 1000;

async function loadCorridorMetas() {
  const now = Date.now();
  if (corridorCache.metas && now - corridorCache.at < CORRIDOR_CACHE_TTL_MS) return corridorCache.metas;

  const corridorDocs = await CorridorRoute.find().populate("originCoverageId").populate("destinationCoverageId").lean();
  const metas = corridorDocs.map((doc) => {
    const start = hubLabel(doc.originCoverageId);
    const end = hubLabel(doc.destinationCoverageId);
    const display = (doc.displayName && String(doc.displayName).trim()) || (start && end ? `${start} → ${end}` : null);
    return { start, end, display };
  });
  corridorCache = { metas, at: now };
  return metas;
}

/**
 * @param {string} routeStr - the bus's raw `route` field value.
 * @returns {Promise<{ routeStart: string|null, routeEnd: string|null }>} the corridor's defined
 *   origin→destination endpoints — NOT adjusted for `routeReversed`. Callers that need the bus's
 *   current effective direction must swap these themselves when the bus is reversed (see
 *   `resolveBusRouteEndpoints` below for that already applied).
 */
async function resolveRouteEndpoints(routeStr) {
  const raw = String(routeStr || "").trim();
  if (!raw) return { routeStart: null, routeEnd: null };

  const metas = await loadCorridorMetas();
  const n = normRouteKey(raw);

  for (const m of metas) {
    if (!m.display) continue;
    if (normRouteKey(m.display) === n && m.start && m.end) return { routeStart: m.start, routeEnd: m.end };
    if (m.start && m.end) {
      const arrow = normRouteKey(`${m.start} → ${m.end}`);
      const dash = normRouteKey(`${m.start} - ${m.end}`);
      const bi = normRouteKey(`${m.start} ↔ ${m.end}`);
      if (arrow === n || dash === n || bi === n) return { routeStart: m.start, routeEnd: m.end };
    }
  }

  const idxMatch = /^route\s*(\d+)\s*$/i.exec(raw);
  if (idxMatch) {
    const sorted = [...metas].sort((a, b) => (a.display || "").localeCompare(b.display || "", undefined, { sensitivity: "base" }));
    const idx = parseInt(idxMatch[1], 10) - 1;
    if (idx >= 0 && idx < sorted.length) {
      const hit = sorted[idx];
      if (hit.start && hit.end) return { routeStart: hit.start, routeEnd: hit.end };
    }
  }

  const parts = raw.split(/\s*(?:→|->|—>|–>)\s*/);
  if (parts.length >= 2) {
    const a = parts[0].trim();
    const b = parts.slice(1).join(" → ").trim();
    if (a && b) return { routeStart: a, routeEnd: b };
  }

  return { routeStart: null, routeEnd: null };
}

/**
 * Same as resolveRouteEndpoints, but swaps start/end when `routeReversed` is true — this is the
 * bus's CURRENT effective direction, which is what both the public API response and the
 * terminal-arrival flip check should use.
 */
async function resolveBusRouteEndpoints(routeStr, routeReversed) {
  const { routeStart, routeEnd } = await resolveRouteEndpoints(routeStr);
  if (!routeReversed) return { routeStart, routeEnd };
  return { routeStart: routeEnd, routeEnd: routeStart };
}

module.exports = { resolveRouteEndpoints, resolveBusRouteEndpoints, normRouteKey };
