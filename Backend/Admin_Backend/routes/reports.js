const express = require("express");

function createReportsRouter() {
  const router = express.Router();

  /** Placeholder for anomaly / off-route / revenue reports */
  router.get("/summary", (_req, res) => {
    res.json({
      message: "Wire to MongoDB aggregations (gps_history, geofence_events, buses)",
      generatedAt: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = { createReportsRouter };
