/**
 * Computes and stores each corridor's fleet-observed free-flow speed (see
 * services/corridorFreeFlowCalibration.js) from real GpsHistory breadcrumbs. Run this
 * periodically (e.g. monthly, or after a corridor's road/route changes) to keep the congestion
 * and delay engines' baseline grounded in this fleet's own recent driving data instead of only
 * OSRM's generic profile.
 *
 *   cd Backend/Admin_Backend && node scripts/calibrateCorridorFreeFlow.js [--window-days=45] [--min-samples=40]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { computeAllCorridorCalibrations } = require("../services/corridorFreeFlowCalibration");
const { getCorridorFreeFlowProfile } = require("../services/corridorGeometry");
const CorridorRoute = require("../models/CorridorRoute");

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
  console.log(`Calibrating corridors from the last ${windowDays} day(s) of GPS history (min ${minSamples} samples)...\n`);

  // OSRM's static estimate for each corridor, captured *before* upserting the calibration, so the
  // printed comparison always shows what the engine would have used otherwise — not a number
  // that's already been overwritten.
  const corridors = await CorridorRoute.find({ suspended: { $ne: true } })
    .populate("originCoverageId", "terminal")
    .populate("destinationCoverageId", "terminal")
    .lean();
  const osrmByCorridor = new Map();
  for (let i = 0; i < corridors.length; i++) {
    const c = corridors[i];
    process.stdout.write(`[${i + 1}/${corridors.length}] OSRM baseline for ${c.displayName || c._id}...\n`);
    const profile = await getCorridorFreeFlowProfile(c).catch(() => null);
    if (profile) osrmByCorridor.set(String(c._id), profile.freeFlowKph);
  }

  const results = await computeAllCorridorCalibrations({
    windowDays,
    minSamples,
    onProgress: (name, i, total) => process.stdout.write(`[${i}/${total}] Calibrating ${name} from GPS history...\n`),
  });

  const rows = results.map((r) => {
    const osrmKph = osrmByCorridor.get(String(r.corridorId));
    const calibratedKph = r.status === "ok" ? Math.round(r.observedFreeFlowKph * 10) / 10 : null;
    const deltaPct =
      calibratedKph != null && osrmKph
        ? `${(((calibratedKph - osrmKph) / osrmKph) * 100).toFixed(1)}%`
        : "—";
    return {
      Corridor: r.corridorName,
      Status: r.status,
      Samples: r.sampleSize ?? 0,
      "OSRM free-flow (kph)": osrmKph != null ? Math.round(osrmKph * 10) / 10 : "—",
      "Calibrated free-flow (kph)": calibratedKph ?? "—",
      "Δ vs OSRM": deltaPct,
    };
  });

  console.table(rows);
  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`\n${ok}/${results.length} corridor(s) calibrated. The rest stay on the OSRM fallback until enough GPS history accumulates.`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
