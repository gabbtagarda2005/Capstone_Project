const mongoose = require("mongoose");
const AppBroadcast = require("../models/AppBroadcast");
const IssuedTicketRecord = require("../models/IssuedTicketRecord");
const RouteCoverage = require("../models/RouteCoverage");
const PassengerTerminalAffinityRead = require("../models/PassengerTerminalAffinityRead");
const { buildPublicPayload } = require("../routes/liveDispatch");
const { isOperationsDeckLive } = require("./adminPortalSettingsService");
const { getCachedWeatherAdvisories } = require("./weatherLocationAdvisories");

function manilaDayBounds() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const y = String(parts.year ?? "1970");
  const m = String(parts.month ?? "01");
  const d = String(parts.day ?? "01");
  const start = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * @returns {Promise<Array<{ id: string, category: string, title: string, body: string, publishedAt: string }>>}
 */
async function buildPassengerCommandFeedItems() {
  const items = [];
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    if (mongoose.connection.readyState === 1) {
      const row = await AppBroadcast.findOne({ target: "passenger" }).lean();
      const msg = row?.message && String(row.message).trim();
      if (msg) {
        items.push({
          id: "feed-broadcast",
          category: "Operations",
          title: "Message from operations",
          body: msg.slice(0, 900),
          publishedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : nowIso,
        });
      }
    }
  } catch (e) {
    console.warn("[command-feed] broadcast:", e.message || e);
  }

  try {
    const payload = await buildPublicPayload();
    const h = payload.holidayBanner;
    if (h && typeof h === "object") {
      const msg = String(h.message || "").trim();
      const name = String(h.holidayName || "Schedule").trim();
      if (msg) {
        items.push({
          id: "feed-holiday",
          category: "Terminal notice",
          title: `${name} — schedule note`,
          body: msg.slice(0, 900),
          publishedAt: h.updatedAt ? new Date(h.updatedAt).toISOString() : payload.serverTime || nowIso,
        });
      }
    }

    if (await isOperationsDeckLive()) {
      const trips = Array.isArray(payload.items) ? payload.items : [];
      const delayed = trips.filter((t) => t.status === "delayed");
      const weak = trips.filter((t) => t.trackingDegraded && t.status !== "cancelled");
      if (delayed.length > 0) {
        const routes = [...new Set(delayed.map((t) => String(t.route || "").trim()).filter(Boolean))].slice(0, 5);
        const body =
          routes.length > 0
            ? `${delayed.length} active trip(s) are behind schedule (${routes.join(", ")}). See live departures for current ETAs.`
            : `${delayed.length} active trip(s) are behind schedule. See live departures for updates.`;
        items.push({
          id: "feed-delays",
          category: "Traffic & delays",
          title: "Trip delays on the network",
          body,
          publishedAt: payload.serverTime || nowIso,
        });
      } else if (weak.length > 0) {
        items.push({
          id: "feed-telemetry",
          category: "Traffic & delays",
          title: "GPS signal quality",
          body: `${weak.length} bus(es) have weaker GPS — ETAs may be estimates until signal improves.`,
          publishedAt: payload.serverTime || nowIso,
        });
      }
    }
  } catch (e) {
    console.warn("[command-feed] live board:", e.message || e);
  }

  const wx = getCachedWeatherAdvisories();
  const byLoc = wx.byLocation || [];
  if (byLoc.length > 0) {
    const rainy = byLoc.filter((x) => x.isRain);
    const lines = byLoc.map((x) => `• ${x.locationName}: ${x.summary}`);
    const parts = [];
    if (rainy.length > 0) {
      const names = rainy.map((x) => x.locationName);
      parts.push(
        `Rain or wet weather is reported at: ${names.join(", ")}. Bring an umbrella. Roads may be slower in these areas — expect possible bus delays. Check live departures before you travel.`
      );
    }
    parts.push("Current conditions at every location defined in admin (hubs, corridor stops, and ticketing stops), via Open-Meteo:");
    const head = parts.join("\n\n");
    const maxTotal = 1900;
    let list = lines.join("\n");
    let body = `${head}\n${list}`;
    if (body.length > maxTotal) {
      const budget = Math.max(400, maxTotal - head.length - 40);
      let acc = "";
      let used = 0;
      for (const line of lines) {
        if (acc.length + line.length + 1 > budget) break;
        acc += (acc ? "\n" : "") + line;
        used += 1;
      }
      const rest = lines.length - used;
      body =
        rest > 0
          ? `${head}\n${acc}\n… and ${rest} more location(s) — full list refreshes with the feed.`
          : `${head}\n${acc}`;
    }
    const title =
      rainy.length > 0
        ? "Rain advisory — umbrella & possible delays"
        : "Weather across all locations";
    items.push({
      id: "feed-weather",
      category: "Weather alert",
      title,
      body,
      publishedAt: wx.updatedAt || nowIso,
    });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const { start, end } = manilaDayBounds();
      const agg = await IssuedTicketRecord.aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lt: end },
            boardingStatus: { $ne: "cancelled" },
          },
        },
        { $group: { _id: "$startLocation", c: { $sum: 1 } } },
        { $sort: { c: -1 } },
        { $limit: 1 },
      ]);
      if (agg.length > 0 && agg[0]._id && Number(agg[0].c) >= 5) {
        const loc = String(agg[0]._id);
        const c = Number(agg[0].c);
        items.push({
          id: "feed-tickets-demand",
          category: "Passenger demand",
          title: `Busy point today — ${loc}`,
          body: `About ${c} tickets issued from this origin today (Philippine time). Queues may be longer — arrive a few minutes early if possible.`,
          publishedAt: nowIso,
        });
      }
    }
  } catch (e) {
    console.warn("[command-feed] tickets:", e.message || e);
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
      const rows = await PassengerTerminalAffinityRead.find({ lastHitAt: { $gte: since } })
        .sort({ hitCount: -1 })
        .limit(4)
        .lean();
      if (rows.length > 0 && Number(rows[0].hitCount) >= 3) {
        const top = rows[0];
        let label = "this area";
        try {
          if (/^[a-f0-9]{24}$/i.test(String(top.coverageId || ""))) {
            const cov = await RouteCoverage.findById(top.coverageId).select("locationName terminal.name").lean();
            if (cov) {
              label =
                String(cov.locationName || "").trim() ||
                String(cov.terminal?.name || "").trim() ||
                label;
            }
          }
        } catch {
          /* ignore name lookup */
        }
        items.push({
          id: "feed-affinity",
          category: "Passenger demand",
          title: `High app usage near ${label}`,
          body:
            "Many passengers recently enabled location near this terminal zone (anonymous counts only). Demand may be higher than usual — use live departures to pick a trip.",
          publishedAt: top.lastHitAt ? new Date(top.lastHitAt).toISOString() : nowIso,
        });
      }
    }
  } catch (e) {
    console.warn("[command-feed] affinity:", e.message || e);
  }

  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return items;
}

async function handleGetPassengerCommandFeed(_req, res) {
  try {
    const items = await buildPassengerCommandFeedItems();
    res.setHeader("Cache-Control", "public, max-age=45");
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || "command-feed failed" });
  }
}

module.exports = {
  buildPassengerCommandFeedItems,
  handleGetPassengerCommandFeed,
};
