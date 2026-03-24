/**
 * Creates an Operator row for the **Bus Attendant** Flutter app (`POST /api/auth/operator-login`).
 * Usage: node scripts/seed-operator.js attendant@example.com YourPassword
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");

async function main() {
  const email = (process.argv[2] || "operator@bukidnon.local").toLowerCase().trim();
  const password = process.argv[3] || "ChangeMeOperator123!";

  if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) {
    console.error("Set MYSQL_HOST, MYSQL_USER, MYSQL_DATABASE (and MYSQL_PASSWORD) in .env");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE,
  });

  const hash = bcrypt.hashSync(password, 10);
  await conn.execute(
    `INSERT INTO bus_operators (first_name, last_name, middle_name, email, password, phone, role)
     VALUES (?, ?, ?, ?, ?, ?, 'Operator')
     ON DUPLICATE KEY UPDATE password = VALUES(password), role = 'Operator'`,
    ["Bus", "Attendant", null, email, hash, null]
  );

  console.log(`Operator ready for attendant app: ${email}`);
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
