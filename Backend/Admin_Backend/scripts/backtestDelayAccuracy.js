/**
 * Backtests the free-flow baseline the congestion/delay engines use, against real completed
 * trips reconstructed from GpsHistory. This is the actual accuracy measurement — not a code
 * review of the formulas, a comparison against real outcomes:
 *
 *   1. For each corridor, find every completed one-way trip in the lookback window (a bus
 *      leaving one terminal's geofence and later reaching the other's — see
 *      services/gpsTripSegmentation.js) and its real elapsed time from GPS timestamps.
 *   2. For that same trip, compute what travel time the OSRM-static baseline and the
 *      fleet-calibrated baseline would each have predicted, from the corridor's real road
 *      distance.
 *   3. Report MAE (mean absolute error, minutes), MAPE (%), and mean signed bias for both —
 *      bias matters here specifically because a free-flow baseline is *expected* to run faster
 *      than typical real trips (which include stops, boarding, and some traffic); what "more
 *      accurate" means is a smaller, more consistent gap, not a gap of zero.
 *
 * Both baselines are real, road-geometry-based numbers — this never simulates a trip, only
 * measures how far each baseline's prediction actually lands from real recorded outcomes.
 *
 *   cd Backend/Admin_Backend && node scripts/backtestDelayAccuracy.js [--window-days=45]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const CorridorRoute = require("../models/CorridorRoute");
const CorridorFreeFlowCalibration = require("../models/CorridorFreeFlowCalibration");
const GpsHistory = require("../models/GpsHistory");
const { stitchRouteGeometry, buildOrderedRouteWaypoints } = require("../services/corridorGeometry");
const { findBusesForCorridor } = require("../services/corridorFreeFlowCalibration");
const { segmentTripsFromBreadcrumbs } = require("../services/gpsTripSegmentation");

function parseArg(name, fallback) {
  const flag = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(flag));
  return hit ? Number(hit.slice(flag.length)) : fallback;
}

function stats(errors) {
  if (errors.length === 0) return { n: 0, mae: null, mape: null, bias: null };
  const mae = errors.reduce((s, e) => s + Math.abs(e.err), 0) / errors.length;
  const mape = errors.reduce((s, e) => s + Math.abs(e.err) / e.actual, 0) / errors.length * 100;
  const bias = errors.reduce((s, e) => s + e.err, 0) / errors.length;
  return { n: errors.length, mae, mape, bias };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const windowDays = parseArg("window-days", 45);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  console.log(`Backtesting against completed trips from the last ${windowDays} day(s)...\n`);

  const corridors = await CorridorRoute.find({ suspended: { $ne: true } })
    .populate("originCoverageId", "locationName terminal")
    .populate("destinationCoverageId", "locationName terminal")
    .lean();

  const perCorridorRows = [];
  const allOsrmErrors = [];
  const allCalErrors = [];

  for (const corridor of corridors) {
    const corridorName =
      corridor.displayName ||
      `${corridor.originCoverageId?.locationName || "?"} → ${corridor.destinationCoverageId?.locationName || "?"}`;

    const terminalA = corridor.originCoverageId?.terminal;
    const terminalB = corridor.destinationCoverageId?.terminal;
    if (
      !terminalA || !Number.isFinite(terminalA.latitude) || !Number.isFinite(terminalA.longitude) ||
      !terminalB || !Number.isFinite(terminalB.latitude) || !Number.isFinite(terminalB.longitude)
    ) {
      perCorridorRows.push({ Corridor: corridorName, Trips: 0, Note: "No usable terminal geometry" });
      continue;
    }

    const waypoints = buildOrderedRouteWaypoints(terminalA, corridor.authorizedStops, terminalB);
    const { distanceMeters, durationSeconds } = await stitchRouteGeometry(waypoints);
    if (!(distanceMeters > 0) || !(durationSeconds > 0)) {
      perCorridorRows.push({ Corridor: corridorName, Trips: 0, Note: "No usable OSRM route" });
      continue;
    }
    const osrmFreeFlowKph = (distanceMeters / durationSeconds) * 3.6;

    const calibration = await CorridorFreeFlowCalibration.findOne({ corridorId: corridor._id })
      .select("observedFreeFlowKph sampleSize")
      .lean();
    const calibratedFreeFlowKph = calibration?.observedFreeFlowKph || null;

    const busIds = await findBusesForCorridor(corridor._id);
    let breadcrumbs = [];
    for (const busId of busIds) {
      const rows = await GpsHistory.find({ busId, recordedAt: { $gte: since } })
        .select("latitude longitude recordedAt")
        .lean();
      breadcrumbs = breadcrumbs.concat(rows);
    }

    const trips = segmentTripsFromBreadcrumbs(breadcrumbs, terminalA, terminalB);
    if (trips.length === 0) {
      perCorridorRows.push({
        Corridor: corridorName,
        Trips: 0,
        Note: busIds.length === 0 ? "No buses assigned to this corridor" : "No completed trips found in window",
      });
      continue;
    }

    const osrmErrors = [];
    const calErrors = [];
    for (const trip of trips) {
      const predictedOsrmMinutes = (distanceMeters / (osrmFreeFlowKph * 1000)) * 60;
      osrmErrors.push({ err: predictedOsrmMinutes - trip.actualMinutes, actual: trip.actualMinutes });
      if (calibratedFreeFlowKph) {
        const predictedCalMinutes = (distanceMeters / (calibratedFreeFlowKph * 1000)) * 60;
        calErrors.push({ err: predictedCalMinutes - trip.actualMinutes, actual: trip.actualMinutes });
      }
    }
    allOsrmErrors.push(...osrmErrors);
    allCalErrors.push(...calErrors);

    const osrmStats = stats(osrmErrors);
    const calStats = stats(calErrors);
    perCorridorRows.push({
      Corridor: corridorName,
      Trips: trips.length,
      "OSRM MAE (min)": osrmStats.mae != null ? osrmStats.mae.toFixed(1) : "—",
      "OSRM MAPE": osrmStats.mape != null ? `${osrmStats.mape.toFixed(1)}%` : "—",
      "OSRM bias (min)": osrmStats.bias != null ? osrmStats.bias.toFixed(1) : "—",
      "Calibrated MAE (min)": calStats.mae != null ? calStats.mae.toFixed(1) : "not calibrated",
      "Calibrated MAPE": calStats.mape != null ? `${calStats.mape.toFixed(1)}%` : "—",
      "Calibrated bias (min)": calStats.bias != null ? calStats.bias.toFixed(1) : "—",
    });
  }

  console.table(perCorridorRows);

  const overallOsrm = stats(allOsrmErrors);
  const overallCal = stats(allCalErrors);
  console.log("\nOverall (all corridors combined):");
  console.table([
    {
      Baseline: "OSRM static",
      "Trips backtested": overallOsrm.n,
      "MAE (min)": overallOsrm.mae != null ? overallOsrm.mae.toFixed(2) : "—",
      MAPE: overallOsrm.mape != null ? `${overallOsrm.mape.toFixed(1)}%` : "—",
      "Bias (min)": overallOsrm.bias != null ? overallOsrm.bias.toFixed(2) : "—",
    },
    {
      Baseline: "Fleet calibrated",
      "Trips backtested": overallCal.n,
      "MAE (min)": overallCal.mae != null ? overallCal.mae.toFixed(2) : "—",
      MAPE: overallCal.mape != null ? `${overallCal.mape.toFixed(1)}%` : "—",
      "Bias (min)": overallCal.bias != null ? overallCal.bias.toFixed(2) : "—",
    },
  ]);
  console.log(
    "\nBias is (predicted − actual): negative means the baseline predicts trips faster than they really " +
      "run. A free-flow baseline is expected to run a bit fast versus typical trips (which include stops " +
      "and boarding) — what matters is whether the calibrated baseline's MAE/bias is smaller and more " +
      "consistent than OSRM's, since OSRM's default profile models a private car, not a bus."
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
