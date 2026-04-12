/**
 * Copies all non-suspended corridor routes into Atlas `FareRoutes` for fare pathfinding.
 * Run once if you had corridor data before FareRoutes mirroring was added.
 *
 *   cd Backend/Admin_Backend && node scripts/backfill-fareroutes-from-corridors.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const CorridorRoute = require("../models/CorridorRoute");
const { upsertFareRouteMirrorFromCorridorDoc } = require("../services/fareRouteMirror");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const rows = await CorridorRoute.find({}).lean();
  let n = 0;
  for (const row of rows) {
    await upsertFareRouteMirrorFromCorridorDoc(row);
    n++;
  }
  console.log(`FareRoutes mirror: upserted ${n} document(s) from corridor_routes.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
