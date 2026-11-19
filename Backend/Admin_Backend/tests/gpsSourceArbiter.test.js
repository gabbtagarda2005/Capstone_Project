/**
 * GPS source arbitration tests (phone primary → LILYGO mobile data → LILYGO SMS), driven by a
 * simulated clock at the real cadences: phone 3s, LILYGO mobile data 5s, LILYGO SMS 8s.
 * Run:  node --test tests/gpsSourceArbiter.test.js   (from Backend/Admin_Backend)
 * Uses the default thresholds (PHONE_GPS_STALE_TIMEOUT_MS=10000, PHONE_GPS_RECOVERY_REQUIRED_UPDATES=3).
 */
for (const k of [
  "PHONE_GPS_STALE_TIMEOUT_MS",
  "PHONE_GPS_TIMEOUT_MS",
  "PHONE_GPS_RECOVERY_REQUIRED_UPDATES",
  "PHONE_FAILBACK_STABLE_COUNT",
  "HARDWARE_MOBILE_TIMEOUT_MS",
  "GPS_FIX_MAX_AGE_MS",
  "SMS_FIX_MAX_AGE_MS",
]) {
  delete process.env[k];
}

const test = require("node:test");
const assert = require("node:assert/strict");
const arb = require("../services/gpsSourceArbiter");

const T0 = Date.UTC(2026, 10, 18, 0, 0, 0);
const s = (sec) => T0 + Math.round(sec * 1000);
let busSeq = 0;
const newBus = () => `TEST-BUS-${++busSeq}`;

/** Feed one fix; fix time = arrival time minus a small realistic transit delay. */
function feed(bus, source, tSec, { transitMs = 300, valid = true, fixAgeMs } = {}) {
  const nowMs = s(tSec);
  const fixMs = fixAgeMs != null ? nowMs - fixAgeMs : nowMs - transitMs;
  return { tSec, ...arb.decideActiveSource(bus, source, { fixMs, nowMs, valid }) };
}

/** Builds a merged, time-ordered event list of periodic pings. */
function schedule(streams) {
  const ev = [];
  for (const { source, start, end, every } of streams) {
    for (let t = start; t <= end + 1e-9; t += every) ev.push({ source, t: Math.round(t * 1000) / 1000 });
  }
  return ev.sort((a, b) => a.t - b.t || (a.source === "phone" ? -1 : 1));
}

test("Test 1 — normal operation: phone @3s stays active; hardware @5s is standby only", () => {
  const bus = newBus();
  const out = schedule([
    { source: "phone", start: 0, end: 60, every: 3 },
    { source: "lilygo", start: 1, end: 60, every: 5 },
  ]).map((e) => feed(bus, e.source, e.t));
  const phone = out.filter((_, i, a) => true).filter((r, i) => r.reason.startsWith("phone"));
  assert.ok(phone.every((r) => r.shouldPublish && r.activeSource === "phone"));
  const hw = out.filter((r) => r.reason === "standby_phone_healthy");
  assert.equal(hw.length, 12);
  assert.ok(hw.every((r) => !r.shouldPublish));
  assert.equal(arb.getSourceStatus(bus, s(60)).status, "ACTIVE");
});

test("Test 2+3 — phone stops: marked stale at 10s, next hardware report takes over, hardware then publishes every 5s", () => {
  const bus = newBus();
  for (const e of schedule([
    { source: "phone", start: 0, end: 30, every: 3 },
    { source: "lilygo", start: 1, end: 30, every: 5 },
  ]))
    feed(bus, e.source, e.t);
  const lastPhoneArrival = 30;
  // status flips to STALE purely on time, without needing any ping
  assert.equal(arb.getSourceStatus(bus, s(lastPhoneArrival + 9.9)).status, "ACTIVE");
  assert.equal(arb.getSourceStatus(bus, s(lastPhoneArrival + 10)).status, "STALE");

  const hwPings = [];
  for (let t = 31; t <= 70; t += 5) hwPings.push(feed(bus, "lilygo", t));
  const takeover = hwPings.find((r) => r.shouldPublish);
  assert.ok(takeover, "hardware never took over");
  assert.equal(takeover.tSec, 41); // first hardware ping at/after 30+10s
  assert.match(takeover.switched.reason, /phone GPS stale \(11s/);
  const after = hwPings.filter((r) => r.tSec >= 41);
  assert.ok(after.every((r) => r.shouldPublish && r.activeSource === "lilygo"));
  assert.equal(arb.getSourceStatus(bus, s(70)).status, "FALLBACK");
  console.log(
    `  measured: phone stale after ${lastPhoneArrival + 10 - lastPhoneArrival}s; hardware takeover at +${takeover.tSec - lastPhoneArrival}s after last phone fix (next 5s report)`
  );
});

test("Test 5 — recovery: 3 consecutive fresh phone updates (hardware interleaved) switch back; hardware no longer publishes", () => {
  const bus = newBus();
  feed(bus, "phone", 0);
  for (let t = 11; t <= 41; t += 5) feed(bus, "lilygo", t); // phone stale → lilygo active
  assert.equal(arb.getActiveSource(bus), "lilygo");

  const out = schedule([
    { source: "phone", start: 42, end: 60, every: 3 },
    { source: "lilygo", start: 46, end: 60, every: 5 },
  ]).map((e) => ({ src: e.source, ...feed(bus, e.source, e.t) }));
  const phone = out.filter((r) => r.src === "phone");
  assert.deepEqual(
    phone.slice(0, 3).map((r) => r.reason),
    ["phone_recovering_1_of_3", "phone_recovering_2_of_3", "phone_recovered"]
  );
  assert.equal(phone[2].tSec, 48);
  assert.ok(phone.slice(2).every((r) => r.shouldPublish));
  // mid-streak (phone 2 of 3) the hardware fix at 46s must still publish — no frozen map
  const hwMid = out.find((r) => r.src === "lilygo" && r.tSec === 46);
  assert.equal(hwMid.shouldPublish, true);
  assert.equal(hwMid.activeSource, "lilygo");
  // the hardware ping at 46 (mid-streak) still publishes; after recovery hardware is standby
  const hwAfter = out.filter((r) => r.src === "lilygo" && r.tSec > 48);
  assert.ok(hwAfter.length > 0 && hwAfter.every((r) => !r.shouldPublish));
  assert.equal(arb.getSourceStatus(bus, s(60)).status, "ACTIVE");
  console.log(`  measured: phone resumed at 42s, active again at ${phone[2].tSec}s (+${phone[2].tSec - 42}s = 3 updates @3s)`);
});

test("Recovery streak breaks on a gap > stale timeout, an invalid (outlier) fix, or a stale fix", () => {
  const bus = newBus();
  feed(bus, "phone", 0);
  feed(bus, "lilygo", 11);
  assert.equal(arb.getActiveSource(bus), "lilygo");
  assert.equal(feed(bus, "phone", 12).reason, "phone_recovering_1_of_3");
  assert.equal(feed(bus, "phone", 15).reason, "phone_recovering_2_of_3");
  assert.equal(feed(bus, "phone", 26).reason, "phone_recovering_1_of_3"); // 11s gap → restart
  assert.equal(feed(bus, "phone", 29, { valid: false }).reason, "invalid_fix"); // outlier
  assert.equal(feed(bus, "phone", 32).reason, "phone_recovering_1_of_3");
  assert.equal(feed(bus, "phone", 35, { fixAgeMs: 60_000 }).reason, "stale_fix"); // old outbox replay
  assert.equal(feed(bus, "phone", 38).reason, "phone_recovering_1_of_3");
  assert.equal(arb.getSourceStatus(bus, s(38)).status, "RECOVERING");
  assert.equal(arb.getActiveSource(bus), "lilygo");
});

test("Anti-flap: an unstable phone (1 ping every ~12s) never takes the bus back from hardware", () => {
  const bus = newBus();
  feed(bus, "phone", 0);
  const flips = [];
  for (let t = 11; t <= 120; t += 5) {
    const r = feed(bus, "lilygo", t);
    if (r.switched) flips.push(r.switched);
  }
  for (let t = 13; t <= 120; t += 12) {
    const r = feed(bus, "phone", t);
    if (r.switched) flips.push(r.switched);
  }
  assert.equal(flips.length, 1); // only the initial phone → lilygo
  assert.equal(arb.getActiveSource(bus), "lilygo");
});

test("Never publish older/duplicate fixes across sources; stale fixes never shown as live", () => {
  const bus = newBus();
  assert.equal(feed(bus, "phone", 0).shouldPublish, true);
  assert.equal(feed(bus, "phone", 3).shouldPublish, true);
  // duplicate of the same phone fix (same fix time) is not re-published
  const nowMs = s(3.5);
  const dup = arb.decideActiveSource(bus, "phone", { fixMs: s(3) - 300, nowMs });
  assert.equal(dup.shouldPublish, false);
  assert.equal(dup.reason, "older_than_published");
  // phone goes stale; a hardware fix whose GPS time is OLDER than the last published phone fix arrives
  const old = arb.decideActiveSource(bus, "lilygo", { fixMs: s(2), nowMs: s(14) });
  assert.equal(old.activeSource, "lilygo");
  assert.equal(old.shouldPublish, false);
  assert.equal(old.reason, "older_than_published");
  // a fresh newer hardware fix publishes
  assert.equal(feed(bus, "lilygo", 19).shouldPublish, true);
  // a buffered (ring-buffer replay) hardware fix 45s old is never published as live
  assert.equal(feed(bus, "lilygo", 24, { fixAgeMs: 45_000 }).reason, "stale_fix");
});

test("Test 4 logic — SMS tier only when phone AND LILYGO mobile data are stale; mobile data preferred when it returns", () => {
  const bus = newBus();
  feed(bus, "phone", 0);
  feed(bus, "lilygo", 11); // lilygo active
  feed(bus, "lilygo", 16);
  // mobile data dies after 16s; firmware switches to SMS @8s
  const sms = [];
  for (let t = 24; t <= 80; t += 8) sms.push(feed(bus, "lilygo_sms", t, { transitMs: 6000 }));
  const firstSms = sms.find((r) => r.shouldPublish);
  assert.ok(firstSms, "SMS never became active");
  assert.equal(firstSms.tSec, 32); // first SMS at/after 16 + HARDWARE_MOBILE_TIMEOUT_MS(15s)
  assert.ok(sms.filter((r) => r.tSec >= 32).every((r) => r.shouldPublish && r.activeSource === "lilygo_sms"));
  // mobile data back
  const back = feed(bus, "lilygo", 85);
  assert.equal(back.shouldPublish, true);
  assert.equal(back.switched.to, "lilygo");
  // a late SMS arriving after data resumed must not override
  assert.equal(feed(bus, "lilygo_sms", 88, { transitMs: 6000 }).reason, "standby_hw_mobile_healthy");
  console.log(
    `  measured: mobile data last at 16s, SMS fix published at ${firstSms.tSec}s (+${firstSms.tSec - 16}s; bound by HARDWARE_MOBILE_TIMEOUT_MS=15s and the 8s SMS cadence)`
  );
});

test("Status snapshot exposes last switch + per-source timing", () => {
  const bus = newBus();
  feed(bus, "phone", 0);
  feed(bus, "lilygo", 11);
  const st = arb.getSourceStatus(bus, s(12));
  assert.equal(st.activeSource, "lilygo");
  assert.equal(st.activeSourceLabel, "LILYGO Mobile Data");
  assert.equal(st.lastSwitch.from, "phone");
  assert.equal(st.lastSwitch.to, "lilygo");
  assert.equal(st.perSource.phone.msSinceLastValid, 12_000);
  assert.equal(st.thresholds.phoneStaleTimeoutMs, 10_000);
  assert.equal(arb.getSourceStatus("never-seen", s(12)).status, "NO_SIGNAL");
});
