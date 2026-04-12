const nodemailer = require("nodemailer");

let cachedTransporter = null;

function resetTransporterCache() {
  cachedTransporter = null;
}

/** Strip spaces / non-breaking spaces (common when copying App Passwords). */
function normalizeSmtpPass(raw) {
  return String(raw || "").replace(/[\s\u00A0]/g, "");
}

function getSmtpAuth() {
  const user = process.env.SMTP_USER?.trim();
  const pass = normalizeSmtpPass(process.env.SMTP_PASS);
  return { user, pass };
}

/**
 * Build transporter from env. Priority: SENDGRID_API_KEY → SMTP_SERVICE=gmail → custom SMTP_*.
 */
function buildTransporter() {
  const sendgridKey = process.env.SENDGRID_API_KEY?.trim();
  if (sendgridKey) {
    return nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: { user: "apikey", pass: sendgridKey },
    });
  }

  const { user, pass } = getSmtpAuth();
  if (!user || !pass) return null;

  const service = (process.env.SMTP_SERVICE || "").trim().toLowerCase();
  if (service === "gmail") {
    // Explicit smtp.gmail.com is more reliable than `service: "gmail"` on some Node/OS setups.
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user, pass },
      tls: { servername: "smtp.gmail.com" },
    });
  }

  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = buildTransporter();
  }
  return cachedTransporter;
}

function formatSendError(err) {
  let message = err?.message || String(err);
  if (/Invalid login|535|534|authentication failed|EAUTH/i.test(message)) {
    message +=
      " Gmail: SMTP_USER must be the exact @gmail.com account where the App Password was created. Create a new App Password (Security → App passwords), paste it into SMTP_PASS with no spaces, restart the API. If it still fails, revoke old app passwords and try again.";
  }
  if (/SendGrid|550|permission denied/i.test(message) && process.env.SENDGRID_API_KEY) {
    message +=
      " In SendGrid: verify a Single Sender or domain, and set MAIL_FROM to that verified address.";
  }
  return message;
}

async function sendOtpEmail({ to, otp }) {
  const from =
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "no-reply@localhost";

  const subject = "Bukidnon Transport — Admin password reset code";
  const text = `Your one-time code is: ${otp}\n\nIt expires in 5 minutes. If you did not request this, ignore this email.\n`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#0B0E14;color:#E2E8F0;padding:24px;border-radius:12px;max-width:420px">
      <h2 style="margin:0 0 10px;color:#93C5FD;font-size:18px">Bukidnon Transport Admin</h2>
      <p style="margin:0 0 14px;color:#cbd5e1;font-size:14px">Use this code to finish resetting your password:</p>
      <div style="font-size:28px;letter-spacing:8px;font-weight:700;color:#60A5FA;font-variant-numeric:tabular-nums">${otp}</div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Expires in 5 minutes. If you didn’t ask for this, you can ignore this message.</p>
    </div>
  `;

  const transporter = getTransporter();
  if (!transporter) {
    return { simulated: true };
  }

  try {
    // Gmail accepts plain From address; display name can trigger extra checks on some accounts.
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    return { simulated: false };
  } catch (err) {
    resetTransporterCache();
    throw new Error(formatSendError(err));
  }
}

function describeMailProvider() {
  if (process.env.SENDGRID_API_KEY?.trim()) return "SendGrid";
  const { user, pass } = getSmtpAuth();
  if (!user || !pass) return null;
  if ((process.env.SMTP_SERVICE || "").trim().toLowerCase() === "gmail") return "Gmail";
  if (process.env.SMTP_HOST?.trim()) return `SMTP (${process.env.SMTP_HOST})`;
  return null;
}

function logMailerBoot() {
  resetTransporterCache();
  const t = buildTransporter();
  if (t) {
    const { user } = getSmtpAuth();
    console.log(`[mailer] OTP delivery: ON (${describeMailProvider()}) as ${user}`);
  } else {
    console.warn(
      "[mailer] OTP delivery: OFF (no SENDGRID_API_KEY / Gmail / SMTP). Use OTP_DEV_REVEAL=true for local testing, or configure email in .env."
    );
  }
}

/** True if env has enough config to attempt sending (does not verify credentials). */
function isOtpEmailConfigured() {
  if (process.env.SENDGRID_API_KEY?.trim()) return true;
  const { user, pass } = getSmtpAuth();
  if (!user || !pass) return false;
  if ((process.env.SMTP_SERVICE || "").trim().toLowerCase() === "gmail") return true;
  return Boolean(process.env.SMTP_HOST?.trim());
}

async function sendAttendantSignupOtpEmail({ to, otp }) {
  const from =
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "no-reply@localhost";

  const subject = "Bukidnon Transport — Bus attendant verification code";
  const text = `Your 6-digit verification code is: ${otp}\n\nIt expires in 5 minutes. An administrator started registration for this email. If this wasn’t you, you can ignore this message.\n`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#0B0E14;color:#E2E8F0;padding:24px;border-radius:12px;max-width:420px">
      <h2 style="margin:0 0 10px;color:#C4B5FD;font-size:18px">Bus attendant verification</h2>
      <p style="margin:0 0 14px;color:#cbd5e1;font-size:14px">Enter this code in the admin portal to continue registration:</p>
      <div style="font-size:28px;letter-spacing:8px;font-weight:700;color:#A78BFA;font-variant-numeric:tabular-nums">${otp}</div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Expires in 5 minutes.</p>
    </div>
  `;

  const transporter = getTransporter();
  if (!transporter) {
    return { simulated: true };
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    return { simulated: false };
  } catch (err) {
    resetTransporterCache();
    throw new Error(formatSendError(err));
  }
}

async function sendDriverSignupOtpEmail({ to, otp }) {
  const from =
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "no-reply@localhost";

  const subject = "Bukidnon Transport — Driver verification code";
  const text = `Your 6-digit verification code is: ${otp}\n\nIt expires in 5 minutes. An administrator started driver registration for this email.\n`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#0B0E14;color:#E2E8F0;padding:24px;border-radius:12px;max-width:420px">
      <h2 style="margin:0 0 10px;color:#93C5FD;font-size:18px">Driver verification</h2>
      <p style="margin:0 0 14px;color:#cbd5e1;font-size:14px">Enter this code in the admin portal to continue registration:</p>
      <div style="font-size:28px;letter-spacing:8px;font-weight:700;color:#38BDF8;font-variant-numeric:tabular-nums">${otp}</div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Expires in 5 minutes.</p>
    </div>
  `;

  const transporter = getTransporter();
  if (!transporter) {
    return { simulated: true };
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    return { simulated: false };
  } catch (err) {
    resetTransporterCache();
    throw new Error(formatSendError(err));
  }
}

async function sendOperatorPasswordResetOtpEmail({ to, otp }) {
  const from =
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "no-reply@localhost";

  const subject = "Bus attendant app — password reset code";
  const text = `Your 6-digit password reset code is: ${otp}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.\n`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#0B0E14;color:#E2E8F0;padding:24px;border-radius:12px;max-width:420px">
      <h2 style="margin:0 0 10px;color:#2DD4BF;font-size:18px">Bus attendant — reset password</h2>
      <p style="margin:0 0 14px;color:#cbd5e1;font-size:14px">Enter this code in the attendant app to set a new password:</p>
      <div style="font-size:28px;letter-spacing:8px;font-weight:700;color:#22D3EE;font-variant-numeric:tabular-nums">${otp}</div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Expires in 10 minutes. If you didn’t ask for this, you can ignore this message.</p>
    </div>
  `;

  const transporter = getTransporter();
  if (!transporter) {
    return { simulated: true };
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    return { simulated: false };
  } catch (err) {
    resetTransporterCache();
    throw new Error(formatSendError(err));
  }
}

/**
 * Ops digest (daily automated report). `to` = comma-separated string or array of emails.
 * `attachments` optional: [{ filename, content: Buffer, contentType }].
 */
async function sendDailyOperationsDigestEmail({ to, subject, text, html, attachments }) {
  const from =
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "no-reply@localhost";

  const transporter = getTransporter();
  if (!transporter) {
    return { simulated: true };
  }

  const toField = Array.isArray(to) ? to.join(", ") : String(to || "").trim();
  if (!toField) {
    return { simulated: true };
  }

  const att =
    Array.isArray(attachments) && attachments.length
      ? attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType || "application/octet-stream",
        }))
      : undefined;

  try {
    await transporter.sendMail({
      from,
      to: toField,
      subject,
      text,
      html,
      ...(att ? { attachments: att } : {}),
    });
    return { simulated: false };
  } catch (err) {
    resetTransporterCache();
    throw new Error(formatSendError(err));
  }
}

module.exports = {
  sendOtpEmail,
  sendAttendantSignupOtpEmail,
  sendDriverSignupOtpEmail,
  sendOperatorPasswordResetOtpEmail,
  sendDailyOperationsDigestEmail,
  resetTransporterCache,
  logMailerBoot,
  isOtpEmailConfigured,
  describeMailProvider,
  normalizeSmtpPass,
};
