const Bus = require("../models/Bus");
const store = require("./liveDispatchStore");
const { buildHubOrderLabelsForRoute, ROUTE_FLIP_COOLDOWN_MS } = require("./passengerFleetIntel");
const { resolveBusRouteEndpoints } = require("./corridorRouteResolver");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ]+/gi, " ")
    .trim();
}

function terminalDisplayFromHit(hit) {
  const doc = hit?.doc;
  if (!doc) return "";
  return (
    (doc.terminal && doc.terminal.name && String(doc.terminal.name).trim()) ||
    String(doc.locationName || "").trim() ||
    ""
  );
}

/**
 * When GPS is inside the CURRENT destination terminal's admin geofence, flip the bus's active
 * direction (origin/destination swap), reverse linear hub order, and start a new trip segment for
 * passenger seat counts. Cooldown prevents oscillation while idling inside the fence.
 *
 * Unlike the original implementation, this does NOT parse/mutate `bus.route` as a literal
 * "A → B" string — `route` is very often a stable corridor label (e.g. "ROUTE 1") that has no
 * directional text in it at all, which silently made the old string-split approach never fire for
 * any bus configured that way (confirmed: BUKIDNON BUS 1's `route` is literally "ROUTE 1"). The
 * bus's CURRENT effective origin/destination is instead resolved via
 * resolveBusRouteEndpoints(route, routeReversed) — the same corridor lookup the public API uses —
 * and only the `routeReversed` boolean is toggled. `route` itself is left untouched.
 *
 * @returns {{ flipped: boolean, terminalName?: string, newRoute?: string, returnToward?: string, cooldown?: boolean }}
 */
async function tryAutoRouteFlipForBusHit(busId, hit) {
  const bid = String(busId || "").trim();
  if (!bid || !hit?.doc) return { flipped: false };

  const terminalDisplay = terminalDisplayFromHit(hit);
  if (!terminalDisplay) return { flipped: false };

  const bus = await Bus.findOne({ busId: bid })
    .select("route routeReversed hubOrderLabels lastRouteFlipAt tripSegmentStartedAt status")
    .lean();
  if (!bus || String(bus.status || "").trim() === "Inactive") return { flipped: false };

  const { routeStart: currentStart, routeEnd: currentEnd } = await resolveBusRouteEndpoints(
    bus.route,
    Boolean(bus.routeReversed)
  );
  if (!currentStart || !currentEnd) return { flipped: false };

  if (norm(currentEnd) !== norm(terminalDisplay)) return { flipped: false };

  const lastFlip = bus.lastRouteFlipAt ? new Date(bus.lastRouteFlipAt).getTime() : 0;
  if (lastFlip && Date.now() - lastFlip < ROUTE_FLIP_COOLDOWN_MS) {
    return { flipped: false, cooldown: true };
  }

  const nextReversed = !bus.routeReversed;
  // After the flip, the bus is heading back toward `currentStart` — that's the new effective
  // destination, and `currentEnd` (where it just arrived) is the new effective origin.
  const newRouteLabel = `${currentEnd} → ${currentStart}`;

  let nextHubOrder = Array.isArray(bus.hubOrderLabels) ? bus.hubOrderLabels.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!nextHubOrder.length) {
    nextHubOrder = await buildHubOrderLabelsForRoute(currentStart, currentEnd);
  }
  const reversedHubs = nextHubOrder.length ? [...nextHubOrder].reverse() : [];

  const now = new Date();
  await Bus.updateOne(
    { busId: bid },
    {
      $set: {
        routeReversed: nextReversed,
        hubOrderLabels: reversedHubs,
        lastRouteFlipAt: now,
        tripSegmentStartedAt: now,
        currentOccupancy: 0,
      },
    }
  ).catch(() => {});

  const blocks = store.listBlocks().filter((b) => String(b.busId) === bid && b.status !== "cancelled");
  for (const block of blocks) {
    store.updateBlock(block.id, {
      routeLabel: newRouteLabel,
      departurePoint: currentEnd,
    });
  }

  return {
    flipped: true,
    terminalName: terminalDisplay,
    newRoute: newRouteLabel,
    returnToward: currentStart,
  };
}

module.exports = {
  tryAutoRouteFlipForBusHit,
  terminalDisplayFromHit,
};
