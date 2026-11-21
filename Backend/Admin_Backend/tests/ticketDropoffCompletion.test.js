/**
 * Pure-logic tests for the closest-approach/recede tracking in ticketDropoffCompletion.js — the
 * part that lets a bus "arrive" at a tight-radius intermediate stop even when no single published
 * GPS fix lands strictly inside its geofence (the actual Casisang bug: 3-8s ping cadence can
 * cross a 100m circle at highway speed between two fixes).
 * Run: node --test tests/ticketDropoffCompletion.test.js   (from Backend/Admin_Backend)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { foldApproachReading, haversineMeters } = require("../services/ticketDropoffCompletion");

test("direct hit inside the radius completes immediately", () => {
  const perPoint = new Map();
  const hit = foldApproachReading(perPoint, "casisang (malaybalay)", 40, 100);
  assert.equal(hit, true);
  assert.equal(perPoint.size, 0, "state cleared after a direct hit");
});

test("near-miss pass: distance dips close then recedes -> confirmed arrival", () => {
  const perPoint = new Map();
  const label = "casisang (malaybalay)";
  const radiusM = 100;
  // Simulates a bus crossing a 100m-radius stop at highway speed between 5s-spaced pings —
  // closest sample is 180m (never inside 100m), then it visibly recedes for 2 straight readings.
  assert.equal(foldApproachReading(perPoint, label, 400, radiusM), false);
  assert.equal(foldApproachReading(perPoint, label, 180, radiusM), false, "closest approach so far");
  assert.equal(foldApproachReading(perPoint, label, 220, radiusM), false, "1st receding reading — not confirmed yet");
  const confirmed = foldApproachReading(perPoint, label, 300, radiusM);
  assert.equal(confirmed, true, "2nd consecutive receding reading confirms the pass");
  assert.equal(perPoint.size, 0, "state cleared after confirmation");
});

test("a stop on a genuinely different nearby road never confirms", () => {
  const perPoint = new Map();
  const label = "some-other-stop (elsewhere)";
  const radiusM = 100;
  // Stays well outside even the near-miss tolerance (100m * 2.5 = 250m) the whole time — a bus on
  // a parallel road, never actually approaching this particular stop.
  const readings = [500, 480, 510, 490, 505, 495];
  let anyHit = false;
  for (const d of readings) {
    if (foldApproachReading(perPoint, label, d, radiusM)) anyHit = true;
  }
  assert.equal(anyHit, false);
});

test("single noisy jump (GPS glitch) does not falsely confirm without a second receding reading", () => {
  const perPoint = new Map();
  const label = "casisang (malaybalay)";
  const radiusM = 100;
  foldApproachReading(perPoint, label, 150, radiusM);
  const firstJump = foldApproachReading(perPoint, label, 600, radiusM); // one noisy outlier reading
  assert.equal(firstJump, false, "a single receding reading must not confirm by itself");
  // Then genuinely comes back closer than the best-ever approach (not just closer than the noisy
  // outlier) — the outlier was noise, not a real recede, so the streak resets against the true min.
  foldApproachReading(perPoint, label, 140, radiusM);
  const state = perPoint.get(label);
  assert.equal(state.consecutiveReceding, 0, "a reading closer than the recorded minimum resets the receding streak");
  assert.equal(state.minM, 140, "the new closer reading becomes the recorded minimum");
});

test("haversineMeters sanity: Casisang to Malaybalay terminal is a short local distance", () => {
  // Real coordinates from this project's RouteCoverage data.
  const casisang = { lat: 8.13512, lon: 125.126863 };
  const malaybalayTerminal = { lat: 8.14823, lon: 125.133195 };
  const d = haversineMeters(casisang.lat, casisang.lon, malaybalayTerminal.lat, malaybalayTerminal.lon);
  assert.ok(d > 1000 && d < 2500, `expected ~1.6km, got ${d}m`);
});
