const cron = require("node-cron");
const fs = require("fs").promises;
const path = require("path");
const mongoose = require("mongoose");
const { buildDailyOperationsReport } = require("./dailyOperationsReport");
const { sendDailyOperationsDigestEmail } = require("./mailer");
const { renderDailyOpsPdfBuffer } = require("./dailyOperationsReportPdf");
const { buildAirportStyleDigest } = require("./dailyOperationsDigestEmail");
const { getPortalSettingsLean, normalizeDailyOpsTime } = require("./adminPortalSettingsService");

let scheduledTask = null;

function stopScheduledTask() {
  if (scheduledTask) {
    try {
      scheduledTask.stop();
    } catch (_) {}
    scheduledTask = null;
  }
}

const emailRetryTimers = new Map();

function parseBool(v, defaultVal = false) {
  if (v == null || v === "") return defaultVal;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function stopAllEmailRetries() {
  for (const t of emailRetryTimers.values()) {
    clearTimeout(t);
  }
  emailRetryTimers.clear();
}

/** Civil "yesterday" relative to today's calendar date in `timeZone`. */
function calendarYesterdayYmd(timeZone) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [Y, M, D] = today.split("-").map((x) => parseInt(x, 10));
  const u = new Date(Date.UTC(Y, M - 1, D));
  u.setUTCDate(u.getUTCDate() - 1);
  const yy = u.getUTCFullYear();
  const mm = String(u.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(u.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** File slug e.g. BUKIDNON_OPS → 2026-04-06_BUKIDNON_OPS.pdf */
function opsSnapshotSlug() {
  const raw = process.env.DAILY_OPS_REPORT_SNAPSHOT_SLUG?.trim();
  if (raw) {
    const s = raw.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase().replace(/_+/g, "_").replace(/^_|_$/g, "");
    return s.slice(0, 48) || "BUKIDNON_OPS";
  }
  return "BUKIDNON_OPS";
}

function getSnapshotDir() {
  return process.env.DAILY_OPS_REPORT_SNAPSHOT_DIR?.trim() || "";
}

/**
 * @returns {Promise<{ simulated?: boolean, sent?: boolean }>}
 */
async function attemptDailyOpsEmailSend(payload) {
  const { reportDate, recipients, subject, text, html } = payload;
  let pdfBuffer = payload.pdfBuffer;
  const pdfFilename = payload.pdfFilename;
  const pdfReadPath = payload.pdfReadPath;

  if (!pdfBuffer && pdfReadPath) {
    try {
      pdfBuffer = await fs.readFile(pdfReadPath);
    } catch (_) {
      pdfBuffer = null;
    }
  }

  const attachments =
    pdfBuffer && pdfFilename
      ? [{ filename: pdfFilename, content: pdfBuffer, contentType: "application/pdf" }]
      : undefined;

  try {
    const r = await sendDailyOperationsDigestEmail({
      to: recipients,
      subject,
      text,
      html,
      attachments,
    });
    if (r.simulated) {
      console.warn(
        "[daily-ops-cron] email skipped (no SMTP). Configure SENDGRID_API_KEY or SMTP_* — PDF/JSON snapshots still on disk if enabled."
      );
      return { simulated: true };
    }
    clearEmailRetryTimer(reportDate);
    console.log("[daily-ops-cron] digest emailed to", Array.isArray(recipients) ? recipients.join(", ") : recipients);
    return { sent: true };
  } catch (e) {
    const attempts = (payload._attempts || 0) + 1;
    const max = Math.max(1, Number(process.env.DAILY_OPS_EMAIL_MAX_RETRIES || 48));
    const delayMin = Math.max(1, Number(process.env.DAILY_OPS_EMAIL_RETRY_MINUTES || 30));
    console.error("[daily-ops-cron] email failed:", e.message || e);

    if (attempts >= max) {
      clearEmailRetryTimer(reportDate);
      console.error(`[daily-ops-cron] giving up after ${attempts} attempt(s); use Reports → Archive to retrieve PDF/JSON.`);
      return { sent: false };
    }

    payload._attempts = attempts;
    payload.pdfBuffer = undefined;

    clearEmailRetryTimer(reportDate);
    const id = setTimeout(() => {
      void attemptDailyOpsEmailSend(payload);
    }, delayMin * 60 * 1000);
    emailRetryTimers.set(reportDate, id);
    console.warn(`[daily-ops-cron] will retry email in ${delayMin}m (attempt ${attempts}/${max})`);
    return { sent: false };
  }
}

function clearEmailRetryTimer(reportDate) {
  const t = emailRetryTimers.get(reportDate);
  if (t) clearTimeout(t);
  emailRetryTimers.delete(reportDate);
}

let jobRunning = false;

async function runDailyOperationsReportJob() {
  if (mongoose.connection.readyState !== 1) {
    console.warn("[daily-ops-cron] MongoDB not connected — skip run");
    return;
  }

  let lean = {};
  try {
    lean = await getPortalSettingsLean();
  } catch (_) {}

  const tz =
    String(lean.timezone || "").trim() || process.env.DAILY_OPS_REPORT_TZ?.trim() || "Asia/Manila";
  const dateStr = calendarYesterdayYmd(tz);
  const brandLabel =
    String(lean.companyName || "").trim() ||
    process.env.DAILY_OPS_REPORT_BRAND?.trim() ||
    "Bukidnon Bus Company";
  const logoUrl = process.env.DAILY_OPS_REPORT_LOGO_URL?.trim() || "";

  let rep;
  try {
    rep = await buildDailyOperationsReport({ dateStr });
  } catch (e) {
    console.error("[daily-ops-cron] build failed:", e.message || e);
    return;
  }

  if (!rep.ok) {
    console.error("[daily-ops-cron] report not ok:", rep.error || "unknown");
    return;
  }

  const slug = opsSnapshotSlug();
  const baseName = `${dateStr}_${slug}`;
  const jsonName = `${baseName}.json`;
  const pdfName = `${baseName}.pdf`;

  const snapshotDir = getSnapshotDir();
  let pdfDiskPath = null;
  let pdfBufferForFirstSend = null;

  if (snapshotDir) {
    try {
      await fs.mkdir(snapshotDir, { recursive: true });
      const jsonPath = path.join(snapshotDir, jsonName);
      await fs.writeFile(jsonPath, JSON.stringify(rep, null, 2), "utf8");
      console.log("[daily-ops-cron] snapshot JSON:", jsonPath);

      pdfDiskPath = path.join(snapshotDir, pdfName);
      pdfBufferForFirstSend = await renderDailyOpsPdfBuffer(rep, {
        brandLabel,
        displayTimeZone: tz,
      });
      await fs.writeFile(pdfDiskPath, pdfBufferForFirstSend);
      console.log("[daily-ops-cron] snapshot PDF:", pdfDiskPath);
    } catch (e) {
      console.error("[daily-ops-cron] snapshot write failed:", e.message || e);
    }
  }

  let recipients = [];
  if (Array.isArray(lean.dailyOpsReportEmailRecipients) && lean.dailyOpsReportEmailRecipients.length) {
    recipients = lean.dailyOpsReportEmailRecipients.map(String).map((s) => s.trim()).filter(Boolean);
  }
  const rawTo = process.env.DAILY_OPS_REPORT_EMAIL_TO?.trim();
  if (!recipients.length && rawTo) {
    recipients = rawTo.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!recipients.length) {
    console.log("[daily-ops-cron] no email recipients (portal settings or DAILY_OPS_REPORT_EMAIL_TO) — digest skipped");
    return;
  }

  const { text, html } = buildAirportStyleDigest(rep, {
    brandLabel,
    displayTimeZone: tz,
    logoUrl: logoUrl || undefined,
  });
  const subject = `Daily operational log — ${rep.reportDate} · ${brandLabel}`;

  await attemptDailyOpsEmailSend({
    reportDate: dateStr,
    recipients,
    subject,
    text,
    html,
    pdfBuffer: pdfBufferForFirstSend || undefined,
    pdfFilename: pdfName,
    pdfReadPath: pdfDiskPath || undefined,
    _attempts: 0,
  });
}

async function runJobWrapped() {
  if (jobRunning) {
    console.warn("[daily-ops-cron] previous run still in progress — skip overlap");
    return;
  }
  jobRunning = true;
  try {
    await runDailyOperationsReportJob();
  } finally {
    jobRunning = false;
  }
}

/**
 * Re-read portal settings + env and (re)schedule the daily job.
 * Call after Mongo connects and after PUT /api/admin/settings.
 */
async function rescheduleDailyOperationsCron() {
  stopScheduledTask();
  stopAllEmailRetries();

  if (mongoose.connection.readyState !== 1) {
    console.warn("[daily-ops-cron] MongoDB not connected — cannot schedule yet");
    return;
  }

  let lean = {};
  try {
    lean = await getPortalSettingsLean();
  } catch (e) {
    console.warn("[daily-ops-cron] settings read failed:", e.message || e);
    return;
  }

  const dbOn = Boolean(lean.dailyOpsReportEmailEnabled);
  const envForce = parseBool(process.env.DAILY_OPS_REPORT_CRON_ENABLED, false);
  const enabled = dbOn || envForce;
  const snapshotDir = getSnapshotDir();

  let recipients = [];
  if (Array.isArray(lean.dailyOpsReportEmailRecipients) && lean.dailyOpsReportEmailRecipients.length) {
    recipients = lean.dailyOpsReportEmailRecipients.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (!recipients.length && process.env.DAILY_OPS_REPORT_EMAIL_TO?.trim()) {
    recipients = process.env.DAILY_OPS_REPORT_EMAIL_TO.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (!enabled) {
    console.log(
      "[daily-ops-cron] OFF — enable in Admin Reports (daily ops schedule) or set DAILY_OPS_REPORT_CRON_ENABLED=true"
    );
    return;
  }
  if (recipients.length === 0 && !snapshotDir) {
    console.warn(
      "[daily-ops-cron] enabled but no recipients and no DAILY_OPS_REPORT_SNAPSHOT_DIR — not scheduled"
    );
    return;
  }

  const tz =
    String(lean.timezone || "").trim() || process.env.DAILY_OPS_REPORT_TZ?.trim() || "Asia/Manila";
  let cronExpr = "30 6 * * *";
  if (dbOn) {
    const t = normalizeDailyOpsTime(lean.dailyOpsReportEmailTime);
    const parts = t.split(":");
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    cronExpr = `${mm} ${hh} * * *`;
  } else {
    cronExpr = process.env.DAILY_OPS_REPORT_CRON?.trim() || "30 6 * * *";
  }

  try {
    scheduledTask = cron.schedule(cronExpr, () => void runJobWrapped(), {
      scheduled: true,
      timezone: tz,
    });
    const dest = [
      recipients.length ? `email → ${recipients.join(", ")}` : null,
      snapshotDir ? `snapshots → ${snapshotDir}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`[daily-ops-cron] scheduled ${cronExpr} (${tz}) — ${dest || "(snapshots only)"}`);
  } catch (e) {
    console.error("[daily-ops-cron] invalid cron or timezone:", cronExpr, tz, e.message || e);
  }
}

/**
 * Initial boot: schedule from Mongo + env. Use rescheduleDailyOperationsCron after settings change.
 */
function startDailyOperationsReportCron() {
  void rescheduleDailyOperationsCron();
  return {
    stop: () => {
      stopScheduledTask();
      stopAllEmailRetries();
    },
    runOnceForTests: runJobWrapped,
    rescheduleDailyOperationsCron,
  };
}

/** Used by GET /api/reports/daily-ops-snapshots */
function getConfiguredSnapshotDir() {
  const d = getSnapshotDir();
  return d || null;
}

module.exports = {
  startDailyOperationsReportCron,
  rescheduleDailyOperationsCron,
  calendarYesterdayYmd,
  getConfiguredSnapshotDir,
  opsSnapshotSlug,
};
