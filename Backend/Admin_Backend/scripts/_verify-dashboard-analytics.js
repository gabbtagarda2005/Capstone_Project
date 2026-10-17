/**
 * Throwaway verification script for the Chapter-4 dashboard-analytics rewrite.
 * Exercises only the PURE functions exported from services/reportsAnalyticsMongo.js and
 * services/manilaTime.js against hand-built, in-memory synthetic data — no database connection,
 * no writes to the real Atlas cluster. Safe to delete once the user is satisfied; not wired into
 * any npm script or CI.
 *
 * Run: node scripts/_verify-dashboard-analytics.js
 */
const assert = require("assert");
const {
  computeTopPickups,
  computeTrend,
  completedMonthKeysBefore,
  computeMonthlyForecast,
  computeYearlyForecast,
  normalizeLocationKey,
  round2,
} = require("../services/reportsAnalyticsMongo");
const { manilaWallClockParts, addDaysYmd } = require("../services/manilaTime");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(`       ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("1) Manila wall-clock / day-boundary correctness");
check("a UTC timestamp that crosses to the next Manila day is bucketed into that next day", () => {
  // 2026-03-14 20:00:00 UTC = 2026-03-15 04:00:00 in Asia/Manila (UTC+8) — different calendar day.
  const d = new Date("2026-03-14T20:00:00.000Z");
  const parts = manilaWallClockParts(d);
  assert.strictEqual(parts.ymd, "2026-03-15");
  assert.strictEqual(parts.hour, 4);
});
check("a UTC timestamp just before the Manila day boundary stays on the prior day", () => {
  // 2026-03-14T15:59:59Z = 2026-03-14T23:59:59 Manila — still March 14 there.
  const d = new Date("2026-03-14T15:59:59.000Z");
  const parts = manilaWallClockParts(d);
  assert.strictEqual(parts.ymd, "2026-03-14");
  assert.strictEqual(parts.hour, 23);
});
check("addDaysYmd steps back one Manila calendar day", () => {
  assert.strictEqual(addDaysYmd("2026-03-01", -1), "2026-02-28");
});

console.log("\n2) Pickup-location normalization (Phase 2.B)");
check("two different formattings of the same stop merge into one group", () => {
  const docs = [
    { startLocation: "Malaybalay Terminal" },
    { startLocation: "malaybalay  terminal" },
    { startLocation: " Malaybalay Terminal " },
    { startLocation: "Don Carlos Terminal" },
  ];
  const top = computeTopPickups(docs, docs.length);
  const malaybalay = top.find((r) => normalizeLocationKey(r.location) === "malaybalay terminal");
  assert.ok(malaybalay, "expected a merged Malaybalay row");
  assert.strictEqual(malaybalay.ticketCount, 3, "three formattings of the same stop should merge to one count of 3");
  const donCarlos = top.find((r) => normalizeLocationKey(r.location) === "don carlos terminal");
  assert.strictEqual(donCarlos.ticketCount, 1, "a genuinely different stop must not be merged in");
});
check("sharePct is computed against the true period total, not just the displayed top 5", () => {
  const docs = Array.from({ length: 10 }, (_, i) => ({ startLocation: i < 6 ? "A" : "B" }));
  // totalForShare = 20 (imagine 10 more tickets exist outside this subset, e.g. a 6th+ location)
  const top = computeTopPickups(docs, 20);
  const a = top.find((r) => r.location === "A");
  assert.strictEqual(a.ticketCount, 6);
  assert.strictEqual(a.sharePct, 30, "6/20 = 30%, not 6/10 = 60%");
});

console.log("\n3) Revenue trend (Phase 2.D)");
check("previous period with real revenue computes a correct signed percentage", () => {
  const t = computeTrend(1100, 1000);
  assert.strictEqual(t.direction, "up");
  assert.strictEqual(t.pctChangePct, 10);
});
check("a revenue decrease is reported as down, not a misleading up arrow", () => {
  const t = computeTrend(800, 1000);
  assert.strictEqual(t.direction, "down");
  assert.strictEqual(t.pctChangePct, -20);
});
check("zero previous-period revenue never divides by zero or fabricates a percentage", () => {
  const t1 = computeTrend(500, 0);
  assert.strictEqual(t1.direction, "no_prior_data");
  assert.strictEqual(t1.pctChangePct, null);
  const t2 = computeTrend(0, 0);
  assert.strictEqual(t2.direction, "flat");
  assert.strictEqual(t2.pctChangePct, null);
});

console.log("\n4) completedMonthKeysBefore — correct across a year boundary");
check("walking back from January correctly rolls into the prior December", () => {
  assert.deepStrictEqual(completedMonthKeysBefore(2026, 1, 3), ["2025-12", "2025-11", "2025-10"]);
});
check("walking back from mid-year stays within the same year", () => {
  assert.deepStrictEqual(completedMonthKeysBefore(2026, 6, 3), ["2026-05", "2026-04", "2026-03"]);
});

console.log("\n5) Monthly/Yearly forecast (Phase 2.G) — honest about insufficient data");
check("monthly forecast with zero completed prior months is marked unavailable, not estimated", () => {
  const empty = new Map();
  const f = computeMonthlyForecast(empty, 2026, 3);
  assert.strictEqual(f.available, false);
  assert.strictEqual(f.estimatedRevenue, null);
  assert.ok(/insufficient/i.test(f.reason));
});
check("monthly forecast averages exactly the completed months that actually have data", () => {
  const m = new Map([
    ["2026-01", { tickets: 5, revenue: 1000 }],
    ["2026-02", { tickets: 5, revenue: 2000 }],
    // 2026-03 (current month) deliberately has no entry — it must not count as "completed"
  ]);
  const f = computeMonthlyForecast(m, 2026, 3);
  assert.strictEqual(f.available, true);
  assert.strictEqual(f.basedOnMonths, 2);
  assert.strictEqual(f.estimatedRevenue, 1500, "(1000 + 2000) / 2");
});
check("current month itself is excluded from its own forecast even if it has data so far", () => {
  const m = new Map([
    ["2026-02", { tickets: 5, revenue: 2000 }],
    ["2026-03", { tickets: 1, revenue: 50 }], // current, in-progress month — must be excluded
  ]);
  const f = computeMonthlyForecast(m, 2026, 3);
  assert.strictEqual(f.basedOnMonths, 1);
  assert.strictEqual(f.estimatedRevenue, 2000, "only Feb counts; the in-progress March must not drag the average down");
});
check("yearly forecast with a completed prior year averages real prior-year revenue", () => {
  const yearly = new Map([
    [2025, { tickets: 1000, revenue: 50000 }],
    [2026, { tickets: 20, revenue: 1135 }], // current year, in progress
  ]);
  const f = computeYearlyForecast(yearly, 2026, 1135, 30);
  assert.strictEqual(f.available, true);
  assert.strictEqual(f.estimatedRevenue, 50000);
  assert.strictEqual(f.basedOnYears, 1);
});
check("yearly forecast with no prior year and under 14 days of YTD data is honestly unavailable", () => {
  const yearly = new Map([[2026, { tickets: 16, revenue: 1135 }]]);
  const f = computeYearlyForecast(yearly, 2026, 1135, 9);
  assert.strictEqual(f.available, false, "9 days of data is below the 14-day minimum this method requires");
  assert.ok(/insufficient/i.test(f.reason));
});
check("yearly forecast extrapolates from YTD once at least 14 days of current-year data exist", () => {
  const yearly = new Map([[2026, { tickets: 100, revenue: 7000 }]]);
  const f = computeYearlyForecast(yearly, 2026, 7000, 14); // 7000/14 * 365 = 182500
  assert.strictEqual(f.available, true);
  assert.strictEqual(f.estimatedRevenue, round2((7000 / 14) * 365));
});

console.log(`\n${passed} check(s) passed.${process.exitCode ? " SOME CHECKS FAILED — see FAIL lines above." : ""}`);
