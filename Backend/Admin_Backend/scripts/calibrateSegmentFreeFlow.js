/**
 * Computes and stores each road segment's fleet-observed free-flow speed (see
 * services/segmentFreeFlowCalibration.js) from real GpsHistory breadcrumbs. Sibling to
 * scripts/calibrateCorridorFreeFlow.js, one level deeper (per segment instead of per whole
 * corridor). Run this periodically (e.g. monthly, or after a corridor's stops change).
 *
 *   cd Backend/Admin_Backend && node scripts/calibrateSegmentFreeFlow.js [--window-days=45] [--min-samples=40]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { computeAllSegmentCalibrations } = require("../services/segmentFreeFlowCalibration");
// Required for its side effect only: CorridorRoute's originCoverageId/destinationCoverageId refs
// "RouteCoverage" — Mongoose's .populate() throws MissingSchemaError unless that model class has
// been registered somewhere in the process (mirrors calibrateCorridorFreeFlow.js's own note).
require("../models/RouteCoverage");

function parseArg(name, fallback) {
  const flag = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(flag));
  return hit ? Number(hit.slice(flag.length)) : fallback;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const windowDays = parseArg("window-days", 45);
  const minSamples = parseArg("min-samples", 40);
  console.log(`Calibrating road segments from the last ${windowDays} day(s) of GPS history (min ${minSamples} samples)...\n`);

  const results = await computeAllSegmentCalibrations({
    windowDays,
    minSamples,
    onProgress: (name, i, total) => process.stdout.write(`[${i}/${total}] ${name}...\n`),
  });

  const rows = results.map((r) => ({
    Segment: `${r.fromName || "?"} → ${r.toName || "?"}`,
    Status: r.status,
    Method: r.method === "p85_light_hours" ? "light-hours (10pm–5am)" : r.method === "p85_all_hours" ? "all-hours fallback" : "—",
    "Light-hr samples": r.lightHourSampleSize ?? 0,
    "All-hr samples": r.allHourSampleSize ?? 0,
    "Calibrated free-flow (kph)": r.status === "ok" ? Math.round(r.observedFreeFlowKph * 10) / 10 : "—",
  }));

  console.table(rows);
  const ok = results.filter((r) => r.status === "ok").length;
  console.log(
    `\n${ok}/${results.length} segment(s) calibrated. The rest stay on the corridor-wide/OSRM fallback ` +
      `(services/segmentTrafficStats.js) until enough GPS history accumulates on that exact segment.`
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
