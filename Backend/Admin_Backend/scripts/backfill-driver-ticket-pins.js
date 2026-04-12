/**
 * Sets ticketEditPinHash for MongoDB drivers that don't have one yet, when driverId is exactly 6 digits.
 * Default PIN = those 6 digits (same as OTP driver signup and admin-created numeric IDs).
 *
 * Usage (from Backend/Admin_Backend):
 *   node scripts/backfill-driver-ticket-pins.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Driver = require("../models/Driver");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const cursor = Driver.find({
    $or: [{ ticketEditPinHash: null }, { ticketEditPinHash: { $exists: false } }],
  })
    .select("driverId")
    .cursor();

  let updated = 0;
  let skipped = 0;
  for await (const doc of cursor) {
    const id = String(doc.driverId || "").trim();
    if (!/^\d{6}$/.test(id)) {
      skipped++;
      continue;
    }
    const hash = await bcrypt.hash(id, 10);
    await Driver.updateOne({ _id: doc._id }, { $set: { ticketEditPinHash: hash } });
    updated++;
  }

  console.log(`Backfill complete: ${updated} driver(s) got default 6-digit ticket PIN; ${skipped} skipped (non-numeric driverId — set PIN in Admin).`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
