/**
 * Copy all collections from bukidnon_transport → CapstoneProject, then optionally drop the old database.
 *
 * Usage (from Admin_Backend folder):
 *   node scripts/migrate-mongodb-to-capstone.js
 *   node scripts/migrate-mongodb-to-capstone.js --clear-target
 *   node scripts/migrate-mongodb-to-capstone.js --drop-source
 *   node scripts/migrate-mongodb-to-capstone.js --clear-target --drop-source
 *
 * Env: MONGODB_URI (any database name in the path is fine; script uses FROM_DB / TO_DB below).
 * Optional: MONGODB_FROM_DB=bukidnon_transport MONGODB_TO_DB=CapstoneProject
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { applyPublicDnsForMongo } = require("../config/mongoDns");
applyPublicDnsForMongo();

const mongoose = require("mongoose");

const FROM_DB = process.env.MONGODB_FROM_DB || "bukidnon_transport";
const TO_DB = process.env.MONGODB_TO_DB || "CapstoneProject";
const DROP_SOURCE = process.argv.includes("--drop-source");
const CLEAR_TARGET = process.argv.includes("--clear-target");

function cleanIndexOptions(idx) {
  const { key, v, ns, ...rest } = idx;
  const out = { ...rest };
  delete out.version;
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI in .env");
    process.exit(1);
  }

  if (FROM_DB === TO_DB) {
    console.error("FROM_DB and TO_DB must differ.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 60_000 });
  const client = mongoose.connection.getClient();
  const source = client.db(FROM_DB);
  const dest = client.db(TO_DB);

  if (CLEAR_TARGET) {
    console.log(`Clearing all collections in "${TO_DB}"…`);
    const cols = await dest.listCollections().toArray();
    for (const c of cols) {
      if (c.name.startsWith("system.")) continue;
      await dest.collection(c.name).drop();
    }
  } else {
    const existingCols = await dest.listCollections().toArray();
    let destDocTotal = 0;
    for (const c of existingCols) {
      if (c.name.startsWith("system.")) continue;
      destDocTotal += await dest.collection(c.name).countDocuments();
    }
    if (destDocTotal > 0 && !process.argv.includes("--force")) {
      console.error(
        `Target "${TO_DB}" already has ${destDocTotal} document(s). Use --clear-target to wipe it, or drop the DB in Compass.`
      );
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  const collections = await source.listCollections().toArray();
  const userCols = collections.map((c) => c.name).filter((n) => !n.startsWith("system."));

  if (userCols.length === 0) {
    console.warn(`No collections found in "${FROM_DB}". Nothing to copy.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Copying ${userCols.length} collection(s) from "${FROM_DB}" → "${TO_DB}"…`);

  for (const name of userCols) {
    const fromCol = source.collection(name);
    const count = await fromCol.countDocuments();
    const toCol = dest.collection(name);
    if (count === 0) {
      await dest.createCollection(name).catch(() => {});
      console.log(`  ${name}: 0 documents (empty collection created)`);
      continue;
    }
    const batch = [];
    const BATCH = 500;
    let inserted = 0;
    for await (const doc of fromCol.find({})) {
      batch.push(doc);
      if (batch.length >= BATCH) {
        await toCol.insertMany(batch, { ordered: false });
        inserted += batch.length;
        batch.length = 0;
      }
    }
    if (batch.length) {
      await toCol.insertMany(batch, { ordered: false });
      inserted += batch.length;
    }
    console.log(`  ${name}: ${inserted} document(s)`);

    const indexes = await fromCol.indexes();
    for (const idx of indexes) {
      if (idx.name === "_id_") continue;
      try {
        await toCol.createIndex(idx.key, cleanIndexOptions(idx));
      } catch (e) {
        console.warn(`    index ${idx.name}: ${e.message}`);
      }
    }
  }

  if (DROP_SOURCE) {
    console.log(`Dropping database "${FROM_DB}"…`);
    await source.dropDatabase();
    console.log("Done.");
  } else {
    console.log(`\nSource "${FROM_DB}" was NOT dropped. Run with --drop-source to remove it after verifying "${TO_DB}".`);
  }

  console.log(`\nUpdate MONGODB_URI in .env so the path uses /${TO_DB}?... (instead of /${FROM_DB}?...)`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
