/**
 * In-process receiver for the LILYGO SMS-fallback GPS path.
 *
 * Architecture (confirmed with the project owner — do NOT route this through IPROG/webhook/an
 * Android SMS-forwarder/the attendant phone): a LILYGO T-A7670E's OWN SIM sends an SMS directly to
 * a dedicated, physically separate receiving GSM modem (a second T-A7670E running
 * hardware/lilygo_ta7670e_sms_gateway, in AT-passthrough mode) connected via USB to the machine
 * running Admin_Backend. That gateway sketch prints one `SMSRX {...}` JSON line per received SMS
 * over the USB-serial connection; this module reads that serial port, validates each message, and
 * calls straight into the SAME ingestion pipeline every other GPS source already uses
 * (ingestHardwareSmsGps → decideActiveSource → checkGpsOutlier → publishHardwarePosition →
 * broadcastLocationUpdate) — an in-process function call, not a second HTTP hop, so there is
 * nothing new to expose or secure at the network layer, and no duplicate GPS ingestion system.
 *
 * Gated by SMS_GATEWAY_SERIAL_PORT — absent on machines with no physical gateway attached (e.g. a
 * dev laptop), in which case this module does nothing and logs once.
 */
const { ingestHardwareSmsGps } = require("./attendantGpsIngest");
const { isValidGpsCoordinate, resolveRecordedAtFromClientTimestamp } = require("./gpsValidation");
const IngestDevice = require("../models/IngestDevice");

const SENDER_RE = /^\+\d{8,15}$/;
const BODY_RE = /^BTGPS\|([^|]+)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)\|(-?\d+(?:\.\d+)?)\|(.+)$/;
const DEDUP_MAX_ENTRIES = 200;
const SERIAL_REOPEN_DELAY_MS = 10_000;

/** Bounded FIFO de-dup set, keyed on deviceId + recordedAt + lat + lon + source (exact combination
 *  requested) — SMS volume is inherently tiny at a 15s device-governed cadence, so 200 entries is
 *  ample headroom; not persisted (a few seconds of dedup memory lost on a process restart is a
 *  low-risk edge case given GpsHistory is append-only and idempotent re-publishes just re-set the
 *  same values). */
const seen = new Map();
function alreadySeen(key) {
  if (seen.has(key)) return true;
  seen.set(key, true);
  if (seen.size > DEDUP_MAX_ENTRIES) {
    const oldest = seen.keys().next().value;
    seen.delete(oldest);
  }
  return false;
}

function log(msg) {
  console.log(`[GPS][sms-gateway] ${msg}`);
}

function warn(msg) {
  console.warn(`[GPS][sms-gateway] ${msg}`);
}

/**
 * Parses+validates one `SMSRX {...}` line and, on success, ingests it. Never throws — every
 * failure is a logged rejection, since a malformed/spoofed line must never crash the receiver or
 * block the next legitimate one.
 */
async function handleLine(io, broadcastLocationUpdate, rawLine) {
  const line = String(rawLine || "").trim();
  if (!line.startsWith("SMSRX ")) return; // other gateway diagnostic output, e.g. "[gw] ..." — ignore

  let parsed;
  try {
    parsed = JSON.parse(line.slice("SMSRX ".length));
  } catch {
    warn(`malformed line, dropped: ${line.slice(0, 200)}`);
    return;
  }

  const sender = parsed?.sender != null ? String(parsed.sender).trim() : "";
  const body = parsed?.body != null ? String(parsed.body) : "";
  if (!SENDER_RE.test(sender)) {
    warn(`rejected: sender "${sender}" is not E.164`);
    return;
  }

  const m = BODY_RE.exec(body);
  if (!m) {
    warn(`rejected malformed BTGPS body from ${sender}: ${body.slice(0, 200)}`);
    return;
  }
  const [, claimedBusIdRaw, latRaw, lonRaw, speedRaw, headingRaw, tsRaw] = m;
  const claimedBusId = String(claimedBusIdRaw || "").trim();

  let device;
  try {
    device = await IngestDevice.findOne({ smsSenderNumber: sender, revoked: { $ne: true } }).lean();
  } catch (e) {
    warn(`device lookup failed for sender ${sender}: ${e.message || e}`);
    return;
  }
  if (!device) {
    warn(`rejected: sender ${sender} not in allowlist (no non-revoked IngestDevice.smsSenderNumber match)`);
    return;
  }
  if (String(device.busId).trim() !== claimedBusId) {
    warn(
      `rejected: SMS from ${sender} (device ${device.deviceId}, registered to bus ${device.busId}) claimed busId "${claimedBusId}" — mismatch`
    );
    return;
  }

  const latitude = Number(latRaw);
  const longitude = Number(lonRaw);
  if (!isValidGpsCoordinate(latitude, longitude)) {
    warn(`rejected: invalid coordinates from ${sender} (device ${device.deviceId}): ${latRaw},${lonRaw}`);
    return;
  }
  const speedKph = Number(speedRaw);
  const heading = Number(headingRaw);
  const recordedAt = resolveRecordedAtFromClientTimestamp(tsRaw);

  const dedupKey = `${device.deviceId}|${recordedAt.toISOString()}|${latitude}|${longitude}|hardware_sms`;
  if (alreadySeen(dedupKey)) {
    return; // silent — duplicate of an already-processed fix
  }

  try {
    await ingestHardwareSmsGps(io, broadcastLocationUpdate, device.busId, {
      latitude,
      longitude,
      speedKph: Number.isFinite(speedKph) ? speedKph : null,
      heading: Number.isFinite(heading) ? heading : null,
      recordedAt,
      deviceId: device.deviceId,
    });
    log(`SMS GPS received (bus ${device.busId}, device ${device.deviceId})`);
  } catch (e) {
    warn(`ingestHardwareSmsGps failed for bus ${device.busId}: ${e.message || e}`);
  }
}

/**
 * Opens the receiving gateway's serial port and processes lines forever, reopening on error/close.
 * Never throws out of this function — a missing/unplugged gateway must not crash the server.
 */
function startSmsGpsReceiver(io, broadcastLocationUpdate) {
  const portPath = process.env.SMS_GATEWAY_SERIAL_PORT;
  if (!portPath) {
    log("SMS_GATEWAY_SERIAL_PORT not set — SMS fallback receiver disabled");
    return { stop: () => {} };
  }

  let serialport;
  try {
    serialport = require("serialport");
  } catch (e) {
    warn(
      `"serialport" package not installed — run "npm install serialport" in Backend/Admin_Backend to enable the SMS fallback receiver (${e.message || e})`
    );
    return { stop: () => {} };
  }
  const { SerialPort, ReadlineParser } = serialport;

  let stopped = false;
  let port = null;
  let reopenTimer = null;

  function scheduleReopen() {
    if (stopped || reopenTimer) return;
    reopenTimer = setTimeout(() => {
      reopenTimer = null;
      open();
    }, SERIAL_REOPEN_DELAY_MS);
  }

  function open() {
    if (stopped) return;
    try {
      port = new SerialPort({ path: portPath, baudRate: 115200 }, (err) => {
        if (err) {
          warn(`failed to open ${portPath}: ${err.message || err} — retrying in ${SERIAL_REOPEN_DELAY_MS / 1000}s`);
          scheduleReopen();
        }
      });
    } catch (e) {
      warn(`failed to open ${portPath}: ${e.message || e} — retrying in ${SERIAL_REOPEN_DELAY_MS / 1000}s`);
      scheduleReopen();
      return;
    }

    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line) => {
      void handleLine(io, broadcastLocationUpdate, line).catch((e) => {
        warn(`unexpected handleLine error: ${e.message || e}`);
      });
    });
    port.on("error", (err) => {
      warn(`serial port error on ${portPath}: ${err.message || err}`);
    });
    port.on("close", () => {
      if (stopped) return;
      warn(`serial port ${portPath} closed — retrying in ${SERIAL_REOPEN_DELAY_MS / 1000}s`);
      scheduleReopen();
    });
    log(`listening for SMS-fallback GPS on ${portPath}`);
  }

  open();

  return {
    stop: () => {
      stopped = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      try {
        port?.close?.();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { startSmsGpsReceiver };
