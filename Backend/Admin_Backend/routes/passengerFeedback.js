const express = require("express");
const mongoose = require("mongoose");
const PassengerFeedback = require("../models/PassengerFeedback");
const { requireAdminJwt } = require("../middleware/requireAdminJwt");

/** Approximate corridor centroids for admin hotspot map when lat/lng omitted */
const ROUTE_COORD_FALLBACK = {
  "Valencia–Malaybalay": [8.0, 125.05],
  "Malaybalay–Manolo Fortich": [8.22, 124.87],
  "Maramag–Valencia": [7.77, 125.0],
  "Don Carlos–Malaybalay": [7.86, 125.02],
  "Impasug-ong–Cagayan": [8.3, 124.98],
  "Valencia–Lantapan": [8.06, 125.03],
  "Malaybalay–Libona": [8.12, 124.96],
  "Quezon–Malaybalay": [7.75, 125.1],
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "was",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "one",
  "our",
  "out",
  "has",
  "have",
  "been",
  "from",
  "with",
  "they",
  "this",
  "that",
  "your",
  "what",
  "when",
  "will",
  "just",
  "very",
  "also",
  "into",
  "than",
  "then",
  "them",
  "some",
  "about",
  "would",
  "could",
  "there",
  "their",
]);

function tokenizeComment(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function extractKeywords(rows, limit = 14) {
  const counts = new Map();
  for (const row of rows) {
    for (const w of tokenizeComment(row.comment)) {
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function resolveCoords(routeName, lat, lng) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  const key = String(routeName || "").trim();
  if (key && ROUTE_COORD_FALLBACK[key]) {
    const [la, ln] = ROUTE_COORD_FALLBACK[key];
    return { lat: la, lng: ln };
  }
  return null;
}

const ABOUT_SET = new Set(["bus", "driver", "attendant", "location"]);

function inferFeedbackAbout(doc) {
  const stored = String(doc.feedbackAbout || "").trim();
  if (ABOUT_SET.has(stored)) return stored;
  if (String(doc.attendantId || "").trim() || String(doc.attendantName || "").trim()) return "attendant";
  if (String(doc.driverId || "").trim() || String(doc.driverName || "").trim()) return "driver";
  if (String(doc.busPlate || "").trim()) return "bus";
  return "location";
}

function serializeDoc(doc) {
  return {
    id: String(doc._id),
    passengerName: doc.passengerName || "Anonymous",
    rating: doc.rating,
    comment: doc.comment || "",
    driverId: doc.driverId || "",
    driverName: doc.driverName || "",
    attendantId: doc.attendantId || "",
    attendantName: doc.attendantName || "",
    busPlate: doc.busPlate || "",
    routeName: doc.routeName || "",
    feedbackAbout: inferFeedbackAbout(doc),
    latitude: doc.latitude != null ? doc.latitude : null,
    longitude: doc.longitude != null ? doc.longitude : null,
    isSos: !!doc.isSos,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
  };
}

async function handlePublicPassengerFeedbackPost(req, res) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database unavailable" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const rating = Number(body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return res.status(400).json({ error: "rating must be an integer 1–5" });
  }

  const passengerName = String(body.passengerName ?? "Anonymous").trim().slice(0, 120) || "Anonymous";
  const comment = String(body.comment ?? "").trim().slice(0, 2000);
  const driverId = String(body.driverId ?? "").trim().slice(0, 64);
  const driverName = String(body.driverName ?? "").trim().slice(0, 120);
  const attendantId = String(body.attendantId ?? "").trim().slice(0, 64);
  const attendantName = String(body.attendantName ?? "").trim().slice(0, 120);
  const busPlate = String(body.busPlate ?? "").trim().slice(0, 32);
  const routeName = String(body.routeName ?? "").trim().slice(0, 200);
  const rawAbout = String(body.feedbackAbout ?? body.about ?? "").trim().toLowerCase();
  const feedbackAbout = ABOUT_SET.has(rawAbout) ? rawAbout : "location";
  const isSos = body.isSos === true || body.isSos === "true";

  let latitude = body.latitude != null ? Number(body.latitude) : null;
  let longitude = body.longitude != null ? Number(body.longitude) : null;
  if (!Number.isFinite(latitude)) latitude = null;
  if (!Number.isFinite(longitude)) longitude = null;

  const coords = resolveCoords(routeName, latitude, longitude);
  if (coords) {
    latitude = coords.lat;
    longitude = coords.lng;
  }

  if (!comment && rating >= 3 && !isSos) {
    return res.status(400).json({ error: "comment required unless reporting SOS or rating below 3" });
  }
  if (isSos && comment.length < 4) {
    return res.status(400).json({ error: "SOS reports require a short description" });
  }

  try {
    const doc = await PassengerFeedback.create({
      passengerName,
      rating,
      comment,
      driverId,
      driverName,
      attendantId,
      attendantName,
      busPlate,
      routeName,
      feedbackAbout,
      latitude,
      longitude,
      isSos,
    });
    res.status(201).json({ ok: true, id: String(doc._id) });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to save feedback" });
  }
}

/**
 * Safety score 0–100 from passenger feedback: low stars, driver-targeted concerns, and SOS pull the score down.
 */
function computeDriverSafetyFromFeedback(rows) {
  if (!rows.length) {
    return {
      sampleSize: 0,
      avgRating: null,
      safetyPercent: null,
      complaintCount: 0,
      lastFeedbackAt: null,
    };
  }
  const n = rows.length;
  let sumRating = 0;
  let complaintCount = 0;
  let adjustment = 0;
  for (const r of rows) {
    const rating = Number(r.rating);
    const rt = Number.isFinite(rating) ? rating : 0;
    sumRating += rt;
    const about = String(r.feedbackAbout || "").trim();
    if (r.isSos) {
      adjustment += 22;
      complaintCount += 1;
    } else if (rt <= 2) {
      adjustment += 12;
      complaintCount += 1;
    } else if (about === "driver" && rt === 3) {
      adjustment += 6;
      complaintCount += 1;
    }
  }
  const avgRating = Math.round((100 * sumRating) / n) / 100;
  const base = (sumRating / n / 5) * 100;
  const safetyPercent = Math.round(Math.min(100, Math.max(0, base - adjustment)));
  const last = rows[0]?.createdAt;
  return {
    sampleSize: n,
    avgRating,
    safetyPercent,
    complaintCount,
    lastFeedbackAt: last ? new Date(last).toISOString() : null,
  };
}

function createPassengerFeedbackRouter() {
  const router = express.Router();
  router.use(requireAdminJwt);

  /** Aggregate passenger_feedbacks for admin driver dossier (Mongo driver document id). */
  router.get("/driver/:driverDocId", async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database unavailable" });
    }
    const { driverDocId } = req.params;
    if (!mongoose.isValidObjectId(driverDocId)) {
      return res.status(400).json({ error: "Invalid driver id" });
    }
    try {
      const Driver = require("../models/Driver");
      const driver = await Driver.findById(driverDocId).lean();
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }
      const mongoId = String(driver._id);
      const personnelId = String(driver.driverId || "").trim();
      const fullName = [driver.firstName, driver.middleName, driver.lastName]
        .filter(Boolean)
        .join(" ")
        .trim()
        .toLowerCase();

      const or = [{ driverId: mongoId }];
      if (personnelId) {
        or.push({ driverId: personnelId });
      }
      if (fullName.length >= 3) {
        or.push({
          feedbackAbout: "driver",
          $expr: {
            $eq: [{ $toLower: { $trim: { input: { $ifNull: ["$driverName", ""] } } } }, fullName],
          },
        });
      }

      const rows = await PassengerFeedback.find({ $or: or }).sort({ createdAt: -1 }).limit(400).lean();

      res.json(computeDriverSafetyFromFeedback(rows));
    } catch (e) {
      res.status(500).json({ error: e.message || "Failed to load driver feedback" });
    }
  });

  router.get("/dashboard", async (_req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    try {
      const rows = await PassengerFeedback.find({})
        .sort({ createdAt: -1 })
        .limit(280)
        .lean();

      const serialized = rows.map(serializeDoc);

      const withRating = serialized.filter((r) => r.rating >= 1);
      const positive = withRating.filter((r) => r.rating >= 4).length;
      const overallPositivePct =
        withRating.length === 0 ? 0 : Math.round((100 * positive) / withRating.length);

      const criticalAlerts = serialized
        .filter((r) => r.rating < 3 || r.isSos)
        .slice(0, 18);

      const liveSignalFeed = serialized.slice(0, 36);

      const keywords = extractKeywords(rows);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const monthRows = await PassengerFeedback.find({ createdAt: { $gte: startOfMonth } })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();

      const byDriver = new Map();
      for (const r of monthRows) {
        const key = (r.driverId && String(r.driverId).trim()) || (r.driverName && String(r.driverName).trim());
        if (!key) continue;
        if (!byDriver.has(key)) {
          byDriver.set(key, {
            driverId: r.driverId ? String(r.driverId).trim() : "",
            driverName: r.driverName ? String(r.driverName).trim() : key,
            sum: 0,
            n: 0,
          });
        }
        const b = byDriver.get(key);
        b.sum += r.rating;
        b.n += 1;
        if (!b.driverName && r.driverName) b.driverName = String(r.driverName).trim();
        if (!b.driverId && r.driverId) b.driverId = String(r.driverId).trim();
      }

      const topDrivers = [...byDriver.values()]
        .filter((d) => d.n >= 1)
        .map((d) => ({
          driverId: d.driverId,
          driverName: d.driverName || d.driverId || "Driver",
          avgRating: Math.round((100 * d.sum) / d.n) / 100,
          sampleSize: d.n,
        }))
        .sort((a, b) => b.avgRating - a.avgRating || b.sampleSize - a.sampleSize)
        .slice(0, 3);

      const negByRoute = new Map();
      for (const r of serialized) {
        if (r.rating > 2 && !r.isSos) continue;
        const route = (r.routeName || "").trim() || "Unknown corridor";
        negByRoute.set(route, (negByRoute.get(route) || 0) + 1);
      }

      const routeHotspots = [...negByRoute.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([routeName, negativeCount]) => {
          const row = rows.find((x) => (x.routeName || "").trim() === routeName);
          const lat = row && row.latitude != null ? Number(row.latitude) : null;
          const lng = row && row.longitude != null ? Number(row.longitude) : null;
          const c = resolveCoords(routeName, lat, lng);
          return {
            routeName,
            negativeCount,
            latitude: c ? c.lat : null,
            longitude: c ? c.lng : null,
          };
        })
        .filter((h) => h.latitude != null && h.longitude != null);

      res.json({
        updatedAt: new Date().toISOString(),
        overallPositivePct,
        totalSamples: withRating.length,
        criticalAlerts,
        liveSignalFeed,
        keywords,
        topDrivers,
        routeHotspots,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || "Dashboard failed" });
    }
  });

  return router;
}

module.exports = { createPassengerFeedbackRouter, handlePublicPassengerFeedbackPost };
