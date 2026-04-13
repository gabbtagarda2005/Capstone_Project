/**
 * SOS: email (Nodemailer via mailer) + SMS (IPROG) using Admin portal settings.
 * Uses companyEmail / companyPhone; if those are empty, falls back to legacy sosEmail / sosPhoneNumber.
 * Optional IPROG_SOS_TO (or aliases) adds an extra SMS destination.
 */
const { getPortalSettingsLean } = require("./adminPortalSettingsService");
const { sendDailyOperationsDigestEmail } = require("./mailer");
const {
  normalizePhilippineMobileE164,
  sendRawSms,
  redactPhilippineMsisdnForLogs,
} = require("./smsService");

/** E.164 +639XXXXXXXXX → masked for UI logs (last 4 visible). */
function maskPhMobileE164(e164) {
  const s = String(e164 || "");
  const m = s.match(/^\+639(\d{9})$/);
  if (!m) return "+63••••••••";
  return `+639•••••${m[1].slice(-4)}`;
}

/** Split comma/semicolon lists; collect every SOS env (do not use || — all can be set). */
function rawNumbersFromSosEnv() {
  const out = [];
  for (const key of ["IPROG_SOS_TO", "SOS_SMS_TO", "TWILIO_SOS_TO"]) {
    const v = process.env[key];
    if (v == null || !String(v).trim()) continue;
    for (const part of String(v).split(/[,;]/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Ordered SMS destinations: env list (IPROG_SOS_TO + SOS_SMS_TO + TWILIO_SOS_TO), company phone, legacy sosPhoneNumber.
 * De-duplicates after normalization.
 */
function collectSosSmsE164Candidates(settings) {
  const rawCo = settings.companyPhone != null ? String(settings.companyPhone).trim() : "";
  const rawSos = settings.sosPhoneNumber != null ? String(settings.sosPhoneNumber).trim() : "";
  const raws = [...rawNumbersFromSosEnv()];
  if (rawCo) raws.push(rawCo);
  if (rawSos) raws.push(rawSos);
  const out = [];
  const seen = new Set();
  for (const raw of raws) {
    const n = normalizePhilippineMobileE164(raw);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function googleMapsUrl(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(`${la},${ln}`)}`;
}

function formatAlertTime(iso, timeZone) {
  const tz = String(timeZone || "Asia/Manila").trim() || "Asia/Manila";
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "long",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function locationSnippet(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return "location unavailable";
  return `${la.toFixed(5)}, ${ln.toFixed(5)}`;
}

/** Short hint for attendant SOS modal — redact MSISDNs; mention IPROG / Admin settings. */
function friendlySmsFailureHint(msg, attemptedE164List, max = 420) {
  const attemptedMasked = (attemptedE164List || []).map(maskPhMobileE164);
  const suffix =
    attemptedMasked.length > 0 ? ` Numbers tried (masked): ${attemptedMasked.join(", ")}.` : "";
  const s = String(msg || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return attemptedMasked.length ? `SMS failed.${suffix}`.trim() : null;
  let out = s.replace(/\+639\d{9}/g, (m) => `+639•••••${m.slice(-4)}`);
  out = out.replace(/09\d{9}/g, (m) => `09•••••${m.slice(-4)}`);
  out = out.replace(/\+63\s*9\d{2}\s*\d{3}\s*\d{4}/gi, "+63 9•• ••• ••••");
  out = out.replace(/\+639[\d*•x]{6,}/gi, "+639••••••••");
  const hint =
    "Check IPROG credits, IPROG_API_TOKEN in Admin_Backend .env, and Admin → Settings company phone (09… or +639…), legacy SOS phone if still stored, or IPROG_SOS_TO in .env. ";
  out = hint + out + suffix;
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/**
 * @param {object} p
 * @param {string} p.levelLabel
 * @param {string} p.busId
 * @param {string} p.busNumber — display number for subject/SMS
 * @param {string} p.plate
 * @param {number} p.latitude
 * @param {number} p.longitude
 * @param {string} p.docId
 * @param {string} p.createdAtIso
 * @param {string|null} p.attendantDisplayName
 * @param {string|null} p.note
 * @returns {Promise<{ email: string, sms: string, smsDetail?: string|null, hint?: string|null }>}
 */
async function notifyAdminsOfSos(p) {
  const out = { email: "skipped_unconfigured", sms: "skipped_unconfigured", smsDetail: null, hint: null };

  let settings;
  try {
    settings = await getPortalSettingsLean();
  } catch (e) {
    console.warn("[sosAdminNotify] settings load failed:", e.message || e);
    return { email: "settings_error", sms: "settings_error", smsDetail: null };
  }

  const tz = settings.timezone || "Asia/Manila";
  const rawCoEmail = settings.companyEmail != null ? String(settings.companyEmail).trim() : "";
  const rawSosEmail = settings.sosEmail != null ? String(settings.sosEmail).trim() : "";
  const targetEmail = rawCoEmail || rawSosEmail;

  const rawCoPhone = settings.companyPhone != null ? String(settings.companyPhone).trim() : "";
  const rawSosPhone = settings.sosPhoneNumber != null ? String(settings.sosPhoneNumber).trim() : "";
  const rawPhone = rawCoPhone || rawSosPhone;
  const smsCandidates = collectSosSmsE164Candidates(settings);

  const busLabel = String(p.busNumber || p.busId || "—").trim() || "—";
  const maps = googleMapsUrl(p.latitude, p.longitude);
  const when = formatAlertTime(p.createdAtIso, tz);
  const locShort = locationSnippet(p.latitude, p.longitude);

  const subject = `🚨 EMERGENCY: SOS Triggered by ${busLabel}`;

  const textLines = [
    `EMERGENCY — Attendant SOS (${p.levelLabel})`,
    "",
    `Bus ID: ${p.busId}`,
    `Bus number: ${busLabel}`,
    `Plate: ${p.plate}`,
    ...(p.attendantDisplayName ? [`Attendant: ${p.attendantDisplayName}`] : []),
    ...(p.note ? [`Note: ${p.note}`] : []),
    "",
    `Location (approx): ${locShort}`,
    maps ? `Google Maps: ${maps}` : "",
    "",
    `Alert time (${tz}): ${when}`,
    `Security log id: ${p.docId}`,
    "",
    "Open the Admin Dashboard → Command Center / View Location for live tracking.",
  ].filter(Boolean);

  const text = textLines.join("\n");

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#1a0505;color:#fecaca;padding:22px;border-radius:12px;max-width:560px;border:2px solid #b91c1c">
      <h1 style="margin:0 0 14px;color:#fca5a5;font-size:20px;line-height:1.25">${escHtml(subject)}</h1>
      <p style="margin:0 0 10px;font-size:14px;color:#fecdd3;line-height:1.5"><strong>Severity:</strong> ${escHtml(p.levelLabel)}</p>
      <table style="border-collapse:collapse;font-size:13px;color:#fecdd3;line-height:1.55;width:100%">
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top;white-space:nowrap"><strong>Bus ID</strong></td><td>${escHtml(p.busId)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top"><strong>Bus number</strong></td><td>${escHtml(busLabel)}</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top"><strong>Plate</strong></td><td>${escHtml(p.plate)}</td></tr>
        ${p.attendantDisplayName ? `<tr><td style="padding:4px 8px 4px 0;vertical-align:top"><strong>Attendant</strong></td><td>${escHtml(p.attendantDisplayName)}</td></tr>` : ""}
        ${p.note ? `<tr><td style="padding:4px 8px 4px 0;vertical-align:top"><strong>Note</strong></td><td>${escHtml(p.note)}</td></tr>` : ""}
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top"><strong>When</strong></td><td>${escHtml(when)} (${escHtml(tz)})</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top"><strong>Coordinates</strong></td><td>${escHtml(locShort)}</td></tr>
      </table>
      ${
        maps
          ? `<p style="margin:16px 0 0"><a href="${escHtml(maps)}" style="color:#93c5fd;font-weight:600">Open in Google Maps</a></p>`
          : ""
      }
      <p style="margin:14px 0 0;font-size:11px;color:#94a3b8">Security log: ${escHtml(p.docId)}</p>
    </div>
  `;

  if (targetEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(targetEmail)) {
    try {
      const r = await sendDailyOperationsDigestEmail({
        to: targetEmail,
        subject,
        text,
        html,
      });
      out.email = r.simulated ? "not_configured" : "sent";
      if (r.simulated) {
        console.warn("[sosAdminNotify] email skipped (mailer not configured)");
      }
    } catch (e) {
      out.email = "failed";
      console.warn("[sosAdminNotify] email failed:", e.message || e);
    }
  } else if (targetEmail) {
    out.email = "skipped_invalid";
    console.warn("[sosAdminNotify] company/SOS email invalid, skipping mail");
  } else {
    out.email = "skipped_unconfigured";
  }

  if (smsCandidates.length > 0) {
    const smsBody = `SOS ALERT! Bus ${busLabel} has triggered an emergency at ${locShort}. Check the Admin Dashboard immediately.`;
    let lastError = null;
    let skippedNotConfigured = false;
    try {
      for (let i = 0; i < smsCandidates.length; i++) {
        const phoneE164 = smsCandidates[i];
        const r = await sendRawSms(phoneE164, smsBody.slice(0, 1500));
        if (r.skipped) {
          skippedNotConfigured = true;
          lastError = r.error || "IPROG SMS not configured";
          break;
        }
        if (r.success) {
          out.sms = "sent";
          break;
        }
        lastError = r.error || "SMS send failed";
        if (r.error) {
          console.warn(
            "[sosAdminNotify] SMS to",
            maskPhMobileE164(phoneE164),
            redactPhilippineMsisdnForLogs(r.error)
          );
        }
        if (i < smsCandidates.length - 1) continue;
        out.sms = "failed";
        out.smsDetail = friendlySmsFailureHint(lastError, smsCandidates);
        break;
      }
      if (out.sms === "skipped_unconfigured") {
        out.sms = skippedNotConfigured ? "not_configured" : "failed";
        if (!out.smsDetail) out.smsDetail = friendlySmsFailureHint(lastError, smsCandidates);
      }
    } catch (e) {
      const msg = e.message || String(e);
      out.sms = "failed";
      out.smsDetail = friendlySmsFailureHint(msg, smsCandidates);
      console.warn("[sosAdminNotify] SMS failed:", e.message || e);
    }
  } else {
    out.sms = rawPhone ? "skipped_invalid" : "skipped_unconfigured";
    if (rawPhone && !normalizePhilippineMobileE164(rawPhone)) {
      out.smsDetail =
        "SOS SMS skipped: company/SOS phone is not a valid Philippine mobile (use 09XXXXXXXXX or +639XXXXXXXXX).";
    }
  }

  if (out.email !== "sent" && out.sms !== "sent") {
    out.hint =
      "No email or SMS was delivered. In Admin → Settings, set Company email and a Philippine mobile (09…). On the server .env set IPROG_API_TOKEN (SMS) and SMTP / SendGrid (email).";
  }

  return out;
}

module.exports = { notifyAdminsOfSos };
