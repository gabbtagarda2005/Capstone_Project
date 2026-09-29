const express = require("express");
const { getAllCorridorSegments } = require("../services/corridorSegments");
const { computeSegmentCongestion } = require("../services/segmentTrafficStats");

/**
 * Segment-based traffic heat map — real observed speed vs. reference speed per road segment
 * (services/corridorSegments.js), never circles drawn around bus icons. See
 * services/segmentTrafficStats.js for how each row is computed; `status` honestly reflects
 * whether there's enough recent data ("ok") or not ("insufficient_data"/"unavailable") rather
 * than fabricating a congestion level.
 */
function createTrafficRouter() {
  const router = express.Router();

  router.get("/heatmap", async (_req, res) => {
    try {
      const segments = await getAllCorridorSegments();
      const rows = await Promise.all(
        segments.map(async (segment) => {
          const congestion = await computeSegmentCongestion(segment.segmentId, segment.corridorDoc).catch(() => null);
          const base = {
            segmentId: segment.segmentId,
            routeId: segment.corridorId,
            fromName: segment.fromName,
            toName: segment.toName,
            polyline: segment.polyline,
          };
          if (!congestion || congestion.status !== "ok") {
            return {
              ...base,
              status: congestion?.status || "unavailable",
              currentSpeed: null,
              referenceSpeed: null,
              speedRatio: null,
              congestionLevel: null,
              sampleCount: congestion?.sampleCount || 0,
              lastObservationAt: null,
              confidence: "UNKNOWN",
            };
          }
          return {
            ...base,
            status: "ok",
            currentSpeed: congestion.currentKph,
            referenceSpeed: congestion.referenceKph,
            speedRatio: congestion.congestionRatio,
            congestionLevel: congestion.level,
            sampleCount: congestion.sampleCount,
            lastObservationAt: congestion.lastObservationAt,
            confidence: congestion.confidence || "LOW",
          };
        })
      );
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createTrafficRouter };
