/**
 * Creates or updates an Admin user in MongoDB (portal_users) when MySQL is not used.
 * Email must be on the admin whitelist (see config/adminWhitelist.js).
 *
 * Usage: node scripts/seed-admin-mongo.js you@student.buksu.edu.ph YourPassword
 * Requires: MONGODB_URI and JWT_SECRET in .env
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { applyPublicDnsForMongo } = require("../config/mongoDns");
applyPublicDnsForMongo();

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const PortalUser = require("../models/PortalUser");
const { normalizeEmail } = require("../config/adminWhitelist");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI in .env (e.g. MongoDB Atlas connection string).");
    process.exit(1);
  }

  const email = normalizeEmail(process.argv[2] || "2301108330@student.buksu.edu.ph");
  const password = process.argv[3] || "ChangeMeAdmin123!";

  if (!email) {
    console.error("Provide a valid email.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30_000 });
  const hash = bcrypt.hashSync(password, 10);
  await PortalUser.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        password: hash,
        firstName: "Admin",
        lastName: "Portal",
        middleName: null,
        phone: null,
        role: "Admin",
      },
    },
    { upsert: true }
  );

  console.log(`MongoDB admin ready: ${email}`);
  console.log("Sign in at the admin portal with this email and password.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message || e);
  if (e.code === "ECONNREFUSED" && String(e.syscall || "").includes("query")) {
    console.error(`
If you see querySrv ECONNREFUSED (DNS):
  • This script now uses public DNS (8.8.8.8) for the Node process — run it again.
  • Or set Windows DNS to 8.8.8.8, then: ipconfig /flushdns
  • Or in Atlas: Connect → Drivers → use the "standard" connection string
    (mongodb://user:pass@host1:27017,host2:27017/...) as MONGODB_URI instead of mongodb+srv://
`);
  }
  process.exit(1);
});
