/**
 * Real-time integration test of GPS source switching through the REAL ingest code paths:
 *   phone   → ingestAttendantGps (same function the Socket.IO + HTTP attendant routes call), every 3s
 *   LILYGO  → ingestDeviceGps    (same function POST /api/buses/hardware-telemetry calls), every 5s
 *   SMS     → smsGpsReceiver.handleLine("SMSRX {...}") with the exact BTGPS body the firmware
 *             builds — i.e. what the gateway board prints over serial — every 8s
 * Wall-clock timing (no fake clock), MongoDB writes, de-dup, device allowlist and bus-id check all real.
 *
 * SAFETY: refuses to run unless TEST_MONGODB_URI points at localhost; uses its own throwaway
 * database and test-only bus/device ids, and drops that database at the end.
 *
 * Run (from Backend/Admin_Backend):
 *   node tests/gpsFailover.integration.js
 *   (TEST_MONGODB_URI defaults to mongodb://127.0.0.1:27017/gps_failover_test)
 *
 * This simulates the three senders; it does NOT exercise phones, radios, SIMs or the gateway modem.
 */
const URI = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017/gps_failover_test";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URI)) {
  console.error(`Refusing to run against non-local database: ${URI}`);
  process.exit(2);
}
process.env.MONGODB_URI = URI;

const mongoose = require("mongoose");
const Bus = require("../models/Bus");
const GpsLog = require("../models/GpsLog");
const GpsHistory = require("../models/GpsHistory");
const { createDevice } = require("../services/deviceRegistry");
const { ingestAttendantGps, ingestDeviceGps } = require("../services/attendantGpsIngest");
const { handleLine, getSmsGatewayStatus } = require("../services/smsGpsReceiver");
const { getSourceStatus } = require("../services/gpsSourceArbiter");
const { getSystemEvents } = require("../services/systemHealthLog");

const BUS = "ZZ-TEST-FAILOVER";
const SMS_SENDER = "+639000000001"; // test-only number, not a real SIM
const OPERATOR_ID = new mongoose.Types.ObjectId();

const ioStub = { to: () => ioStub, emit: () => {} };
const published = []; // every location actually broadcast to admin/passenger clients
function broadcastStub(_io, payload) {
  published.push({ at: Date.now(), source: payload?.source, lat: payload?.latitude ?? payload?.lat });
}

const t0 = Date.now();
const rel = (ms = Date.now()) => ((ms - t0) / 1000).toFixed(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// slow realistic movement (~20 km/h north) so the outlier guard sees plausible motion
const posAt = (ms) => ({ lat: 8.1477 + ((ms - t0) / 1000) * 0.00005, lng: 125.1324 });
const isoNoMs = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

const timers = {};
function every(name, ms, fn) {
  const run = () => void fn().catch((e) => console.log(`[${rel()}s] ${name} error: ${e.message}`));
  run();
  timers[name] = setInterval(run, ms);
}
function stop(name) {
  clearInterval(timers[name]);
  delete timers[name];
}

const log = [];
function note(msg) {
  const line = `[${rel()}s] ${msg}`;
  log.push(line);
  console.log(line);
}

let lastActive = null;
function watchActive() {
  const st = getSourceStatus(BUS);
  const key = `${st.activeSource}/${st.status}`;
  if (key !== lastActive) {
    note(`arbiter → active=${st.activeSource} status=${st.status}`);
    lastActive = key;
  }
}

async function phonePing() {
  const now = Date.now();
  const p = posAt(now);
  const r = await ingestAttendantGps(ioStub, broadcastStub, { sub: String(OPERATOR_ID) }, {
    latitude: p.lat,
    longitude: p.lng + 0.00002,
    speedKph: 20,
    clientRecordedAt: new Date(now - 200).toISOString(),
  });
  return r;
}
async function hwPing() {
  const now = Date.now();
  const p = posAt(now);
  return ingestDeviceGps(ioStub, broadcastStub, BUS, {
    latitude: p.lat,
    longitude: p.lng,
    speedKph: 20,
    heading: 0,
    net: "cellular",
    recordedAt: isoNoMs(now - 500), // GNSS time (whole seconds, like the firmware)
  });
}
let lastSmsLine = null;
async function smsPing() {
  const now = Date.now();
  const p = posAt(now - 4000); // SMS fix was taken ~4s before it reached the gateway
  const body = `BTGPS|${BUS}|${p.lat.toFixed(6)}|${p.lng.toFixed(6)}|20.0|0|${isoNoMs(now - 4000)}`;
  lastSmsLine = `SMSRX ${JSON.stringify({ sender: SMS_SENDER, body, scts: "", rssiDbm: -79 })}`;
  await handleLine(ioStub, broadcastStub, lastSmsLine);
}

function firstPublishAfter(ms, source) {
  return published.find((p) => p.at >= ms && p.source === source);
}

(async () => {
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await Bus.create({ busId: BUS, busNumber: BUS, plateNumber: "TEST", status: "Active", operatorPortalUserId: OPERATOR_ID });
  await createDevice({ deviceId: "zz-test-lilygo", busId: BUS, label: "integration test", smsSenderNumber: SMS_SENDER });
  setInterval(watchActive, 250);

  note("PHASE 1: phone @3s + LILYGO mobile data @5s (normal)");
  every("phone", 3000, phonePing);
  every("hw", 5000, hwPing);
  await sleep(20_000);

  const phoneStopMs = Date.now();
  stop("phone");
  note("PHASE 2: phone GPS stops (LILYGO mobile data continues)");
  await sleep(25_000);

  const hwStopMs = Date.now();
  stop("hw");
  note("PHASE 3: LILYGO mobile data stops; LILYGO SMS @8s via gateway line");
  every("sms", 8000, smsPing);
  await sleep(30_000);
  await handleLine(ioStub, broadcastStub, lastSmsLine); // exact duplicate SMS
  note("sent an exact duplicate of the last SMS line");

  const phoneBackMs = Date.now();
  note("PHASE 4: phone GPS resumes @3s (SMS continues)");
  every("phone", 3000, phonePing);
  await sleep(20_000);
  stop("sms");
  stop("phone");
  await sleep(500);

  // ---- negative SMS cases + gateway heartbeat parsing ----
  const nowIso = isoNoMs(Date.now());
  const neg = [
    ["unregistered sender", { sender: "+639000000999", body: `BTGPS|${BUS}|8.15|125.13|0|0|${nowIso}` }],
    ["old BUS-001 label (pre-fix tracker config)", { sender: SMS_SENDER, body: `BTGPS|BUS-001|8.15|125.13|0|0|${nowIso}` }],
    ["invalid coordinates", { sender: SMS_SENDER, body: `BTGPS|${BUS}|0|0|0|0|${nowIso}` }],
  ];
  for (const [label, msg] of neg) {
    await handleLine(ioStub, broadcastStub, `SMSRX ${JSON.stringify(msg)}`);
    note(`negative SMS (${label}) → lastRejectReason=${getSmsGatewayStatus().lastRejectReason}`);
  }
  await handleLine(ioStub, broadcastStub, `GWSTAT {"registered":true,"smsReady":true,"rssiDbm":-79,"uptimeS":42}`);
  const hbState = getSmsGatewayStatus();
  note(`GWSTAT heartbeat parsed: heartbeat=${JSON.stringify(hbState.heartbeat)} state=${hbState.state} (no serial port in this test)`);

  // ---- measurements ----
  const lastPhoneBeforeStop = published.filter((p) => p.source === "staff" && p.at <= phoneStopMs).at(-1);
  const hwTakeover = firstPublishAfter(phoneStopMs, "hardware");
  const smsTakeover = firstPublishAfter(hwStopMs, "hardware_sms");
  const phoneRecovered = firstPublishAfter(phoneBackMs, "staff");
  const sw = getSourceStatus(BUS).recentSwitches.slice().reverse();

  const hwGaps = [];
  const hwPubs = published.filter((p) => p.source === "hardware");
  for (let i = 1; i < hwPubs.length; i++) hwGaps.push(((hwPubs[i].at - hwPubs[i - 1].at) / 1000).toFixed(1));
  const smsPubs = published.filter((p) => p.source === "hardware_sms");
  const smsGaps = [];
  for (let i = 1; i < smsPubs.length; i++) smsGaps.push(((smsPubs[i].at - smsPubs[i - 1].at) / 1000).toFixed(1));
  const afterRecovery = published.filter((p) => phoneRecovered && p.at > phoneRecovered.at);

  console.log("\n================ RESULTS ================");
  console.log("switch events:", JSON.stringify(sw.map((e) => ({ at: `${rel(e.atMs)}s`, from: e.from, to: e.to, reason: e.reason }))));
  console.log(
    `phone stopped at ${rel(phoneStopMs)}s (last phone publish ${rel(lastPhoneBeforeStop?.at)}s) → hardware takeover publish at ${rel(hwTakeover?.at)}s ` +
      `= ${hwTakeover ? ((hwTakeover.at - lastPhoneBeforeStop.at) / 1000).toFixed(1) : "n/a"}s after last phone fix`
  );
  console.log(`hardware publish gaps (s): ${hwGaps.join(", ")}`);
  console.log(
    `hardware stopped at ${rel(hwStopMs)}s → first SMS publish at ${rel(smsTakeover?.at)}s = ${smsTakeover ? ((smsTakeover.at - hwStopMs) / 1000).toFixed(1) : "n/a"}s`
  );
  console.log(`SMS publish gaps (s): ${smsGaps.join(", ")}`);
  console.log(
    `phone resumed at ${rel(phoneBackMs)}s → phone active publish at ${rel(phoneRecovered?.at)}s = ${phoneRecovered ? ((phoneRecovered.at - phoneBackMs) / 1000).toFixed(1) : "n/a"}s`
  );
  console.log(`publishes after phone recovery by source: ${JSON.stringify(afterRecovery.reduce((a, p) => ((a[p.source] = (a[p.source] || 0) + 1), a), {}))}`);
  const gw = getSmsGatewayStatus();
  console.log(`SMS receiver counts: ${JSON.stringify(gw.counts)} lastReject=${gw.lastRejectReason}`);
  const dbLog = await GpsLog.findOne({ busId: BUS }).lean();
  const histCount = await GpsHistory.countDocuments({ busId: BUS });
  console.log(
    `DB gps_logs: source=${dbLog?.source} activeGpsSource=${dbLog?.activeGpsSource} smsRecordedAt=${dbLog?.smsRecordedAt?.toISOString?.()} | gps_history rows=${histCount}`
  );
  console.log("system events (GPS):", JSON.stringify(getSystemEvents({ service: "GPS" }).map((e) => e.message)));

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error("FAILED:", e);
  try {
    await mongoose.connection.db.dropDatabase();
  } catch {}
  process.exit(1);
});
