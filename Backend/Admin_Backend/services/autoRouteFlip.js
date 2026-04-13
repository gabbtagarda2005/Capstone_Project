const Bus = require("../models/Bus");
const store = require("./liveDispatchStore");
const { buildHubOrderLabelsForRoute, ROUTE_FLIP_COOLDOWN_MS } = require("./passengerFleetIntel");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/gi, " ")
    .trim();
}

function splitRouteLabel(routeLabel) {
  const s = String(routeLabel || "").trim();
  if (!s) return null;
  const parts = s.split(/\s*[→➔>–—-]\s*/).map((v) => v.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { from: parts[0], to: parts[parts.length - 1] };
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
 * When GPS is inside the destination terminal's admin geofence, flip corridor direction on the bus
 * (and matching live-dispatch rows), reverse linear hub order, and start a new trip segment for
 * passenger seat counts. Cooldown prevents oscillation while idling inside the fence.
 *
 * @returns {{ flipped: boolean, terminalName?: string, newRoute?: string, returnToward?: string, cooldown?: boolean }}
 */
async function tryAutoRouteFlipForBusHit(busId, hit) {
  const bid = String(busId || "").trim();
  if (!bid || !hit?.doc) return { flipped: false };

  const terminalDisplay = terminalDisplayFromHit(hit);
  if (!terminalDisplay) return { flipped: false };

  const bus = await Bus.findOne({ busId: bid })
    .select("route hubOrderLabels lastRouteFlipAt tripSegmentStartedAt status")
    .lean();
  if (!bus || String(bus.status || "").trim() === "Inactive") return { flipped: false };

  const routeParts = splitRouteLabel(bus.route);
  if (!routeParts) return { flipped: false };

  if (norm(routeParts.to) !== norm(terminalDisplay)) return { flipped: false };

  const lastFlip = bus.lastRouteFlipAt ? new Date(bus.lastRouteFlipAt).getTime() : 0;
  if (lastFlip && Date.now() - lastFlip < ROUTE_FLIP_COOLDOWN_MS) {
    return { flipped: false, cooldown: true };
  }

  const flippedLabel = `${routeParts.to} → ${routeParts.from}`;
  let nextHubOrder = Array.isArray(bus.hubOrderLabels) ? bus.hubOrderLabels.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!nextHubOrder.length) {
    nextHubOrder = await buildHubOrderLabelsForRoute(routeParts.from, routeParts.to);
  }
  const reversedHubs = nextHubOrder.length ? [...nextHubOrder].reverse() : [];

  const now = new Date();
  await Bus.updateOne(
    { busId: bid },
    {
      $set: {
        route: flippedLabel,
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
      routeLabel: flippedLabel,
      departurePoint: routeParts.to,
    });
  }

  return {
    flipped: true,
    terminalName: terminalDisplay,
    newRoute: flippedLabel,
    returnToward: routeParts.from,
  };
}

module.exports = {
  tryAutoRouteFlipForBusHit,
  splitRouteLabel,
  terminalDisplayFromHit,
};
