/**
 * Quick Gmail SMTP check: from Admin_Backend folder run:
 *   node scripts/test-smtp.js
 * Expect: "SMTP connection OK" — if not, fix SMTP_USER / SMTP_PASS in .env
 */
require("dotenv").config();
const nodemailer = require("nodemailer");
const { normalizeSmtpPass } = require("../services/mailer");

const user = process.env.SMTP_USER?.trim();
const pass = normalizeSmtpPass(process.env.SMTP_PASS);

if (!user || !pass) {
  console.error("Set SMTP_USER and SMTP_PASS in .env first.");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user, pass },
  tls: { servername: "smtp.gmail.com" },
});

transporter.verify((err) => {
  if (err) {
    console.error("SMTP verify FAILED:", err.message);
    console.error("→ Use App Password from the SAME Google account as SMTP_USER. Regenerate at https://myaccount.google.com/apppasswords");
    process.exit(1);
  }
  console.log("SMTP connection OK — Gmail accepted SMTP_USER + App Password.");
  process.exit(0);
});
