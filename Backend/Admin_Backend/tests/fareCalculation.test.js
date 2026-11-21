/**
 * Fare calculation regression tests for the Maramag/Valencia/Casisang/Malaybalay corridor — the
 * ₱279 bug (Maramag -> Casisang priced via a per-km spur measured from Valencia, instead of the
 * matrix fare to Malaybalay minus a small credit for the short remaining distance).
 *
 * These assert INVARIANTS (a pre-terminal stop's fare is never more than the fare to the farther
 * terminal) rather than hardcoded peso amounts, since the admin-configured fare matrix / per-km
 * rate can change — the relationship is what must always hold.
 *
 * Connects to the real database (read-only: computeTicketFare never writes). Requires
 * MONGODB_URI / MONGO_URI in the environment (same as the running server).
 * Run: node --test tests/fareCalculation.test.js   (from Backend/Admin_Backend)
 */
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const MARAMAG = "Maramag Integrated Bus Terminal, Purok 5";
const VALENCIA = "Valencia City Integrated Transport Terminal Complex, Poblacion";
const MALAYBALAY = "Malaybalay Integrated Bus Terminal, Barangay 9";
const CASISANG = "Casisang (Malaybalay)";

test("fare calculation suite", async (t) => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
  const { computeTicketFare } = require("../services/farePricing");

  await t.test("Maramag -> Malaybalay terminal matches (sanity baseline)", async () => {
    const r = await computeTicketFare({ startLocation: MARAMAG, destination: MALAYBALAY, category: "adult" });
    assert.equal(r.matched, true);
    assert.ok(r.fare > 0);
  });

  await t.test("Maramag -> Casisang is matched and <= Maramag -> Malaybalay terminal", async () => {
    const toTerminal = await computeTicketFare({ startLocation: MARAMAG, destination: MALAYBALAY, category: "adult" });
    const toCasisang = await computeTicketFare({ startLocation: MARAMAG, destination: CASISANG, category: "adult" });
    assert.equal(toCasisang.matched, true);
    assert.ok(
      toCasisang.fare <= toTerminal.fare,
      `Casisang fare (${toCasisang.fare}) must not exceed the farther terminal's fare (${toTerminal.fare}) — this was the ₱279 bug`
    );
    // Regression guard against the specific reported bad value, in case thresholds ever coincide.
    assert.notEqual(toCasisang.fare, 279);
  });

  await t.test("Maramag -> Valencia matches (unaffected by the fix)", async () => {
    const r = await computeTicketFare({ startLocation: MARAMAG, destination: VALENCIA, category: "adult" });
    assert.equal(r.matched, true);
    assert.ok(r.fare > 0);
  });

  await t.test("Valencia -> Casisang is matched and <= Valencia -> Malaybalay terminal", async () => {
    const toTerminal = await computeTicketFare({ startLocation: VALENCIA, destination: MALAYBALAY, category: "adult" });
    const toCasisang = await computeTicketFare({ startLocation: VALENCIA, destination: CASISANG, category: "adult" });
    assert.equal(toCasisang.matched, true);
    assert.ok(
      toCasisang.fare <= toTerminal.fare,
      `Valencia->Casisang fare (${toCasisang.fare}) must not exceed Valencia->Malaybalay terminal (${toTerminal.fare})`
    );
  });

  await t.test("Reverse direction (Malaybalay terminal -> Maramag) still matches", async () => {
    const r = await computeTicketFare({ startLocation: MALAYBALAY, destination: MARAMAG, category: "adult" });
    assert.equal(r.matched, true);
    assert.ok(r.fare > 0);
  });

  await t.test("Reverse pre-terminal origin (Casisang -> Maramag) is sane and >= Malaybalay->Maramag", async () => {
    // Boarding from a point just short of the terminal should cost a little MORE than boarding at
    // the terminal itself (you travel the same corridor plus the short extra spur), not less.
    const fromTerminal = await computeTicketFare({ startLocation: MALAYBALAY, destination: MARAMAG, category: "adult" });
    const fromCasisang = await computeTicketFare({ startLocation: CASISANG, destination: MARAMAG, category: "adult" });
    assert.equal(fromCasisang.matched, true);
    assert.ok(fromCasisang.fare >= fromTerminal.fare);
  });

  for (const cat of ["student", "pwd", "senior"]) {
    await t.test(`${cat} category is discounted vs adult for Maramag -> Casisang`, async () => {
      const adult = await computeTicketFare({ startLocation: MARAMAG, destination: CASISANG, category: "adult" });
      const discounted = await computeTicketFare({ startLocation: MARAMAG, destination: CASISANG, category: cat });
      assert.equal(discounted.matched, true);
      assert.ok(discounted.fare <= adult.fare, `${cat} fare (${discounted.fare}) should not exceed adult (${adult.fare})`);
    });
  }

  await t.test("Invalid/unmapped destination does not match and does not throw", async () => {
    const r = await computeTicketFare({ startLocation: MARAMAG, destination: "Nonexistent Place XYZ", category: "adult" });
    assert.equal(r.matched, false);
  });

  await mongoose.disconnect();
});
