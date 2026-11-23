/**
 * Verifies that a traffic-category attendant incident report actually surfaces in the
 * passenger-facing command feed under "Traffic & delays" — previously it only created a
 * SecurityLog row and alerted the admin Command Center, with no path into the passenger feed.
 *
 * Connects to the real database. Creates one throwaway SecurityLog doc and deletes it
 * (both on success and failure) so no test data is left behind.
 * Run: node --test tests/trafficIncidentFeed.test.js   (from Backend/Admin_Backend)
 */
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

test("traffic incident feed suite", async (t) => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
  const SecurityLog = require("../models/SecurityLog");
  const { buildPassengerCommandFeedItems } = require("../services/passengerCommandFeed");

  const TEST_BUS_ID = "TEST-BUS-TRAFFIC-FEED";
  const TEST_ROUTE = "TEST ROUTE — DO NOT USE";
  const TEST_NOTE = "Flooded underpass near the test terminal";
  const createdIds = [];

  async function cleanup() {
    if (createdIds.length) {
      await SecurityLog.deleteMany({ _id: { $in: createdIds } }).catch(() => {});
    }
  }

  try {
    await t.test("a recent unresolved traffic incident appears as a Traffic & delays item", async () => {
      const doc = await SecurityLog.create({
        type: "attendant_incident",
        busId: TEST_BUS_ID,
        message: `Incident report (traffic) — Bus ${TEST_BUS_ID} | Plate TEST-000 | ${TEST_NOTE}`,
        severity: "warning",
        latitude: 8.15,
        longitude: 125.13,
        assignedRoute: TEST_ROUTE,
        source: "attendant_app",
        category: "traffic",
        note: TEST_NOTE,
      });
      createdIds.push(doc._id);

      const items = await buildPassengerCommandFeedItems();
      const match = items.find((it) => it.id === `feed-incident-${String(doc._id)}`);
      assert.ok(match, "expected a feed-incident-<id> item for the traffic report");
      assert.equal(match.category, "Traffic & delays");
      assert.ok(match.title.includes(TEST_ROUTE), "title should mention the affected route");
      assert.ok(match.body.includes(TEST_NOTE), "body should include the attendant's note");
    });

    await t.test("a resolved traffic incident does not appear", async () => {
      const doc = await SecurityLog.create({
        type: "attendant_incident",
        busId: TEST_BUS_ID,
        message: `Incident report (traffic) — Bus ${TEST_BUS_ID}`,
        severity: "warning",
        latitude: 8.15,
        longitude: 125.13,
        assignedRoute: TEST_ROUTE,
        source: "attendant_app",
        category: "traffic",
        note: "already cleared",
        resolvedAt: new Date(),
        resolvedByEmail: "test@example.com",
      });
      createdIds.push(doc._id);

      const items = await buildPassengerCommandFeedItems();
      const match = items.find((it) => it.id === `feed-incident-${String(doc._id)}`);
      assert.equal(match, undefined, "a resolved incident must not surface to passengers");
    });

    await t.test("an accident-category incident does not appear under Traffic & delays", async () => {
      const doc = await SecurityLog.create({
        type: "attendant_incident",
        busId: TEST_BUS_ID,
        message: `Incident report (accident) — Bus ${TEST_BUS_ID}`,
        severity: "warning",
        latitude: 8.15,
        longitude: 125.13,
        assignedRoute: TEST_ROUTE,
        source: "attendant_app",
        category: "accident",
        note: "minor fender bender",
      });
      createdIds.push(doc._id);

      const items = await buildPassengerCommandFeedItems();
      const match = items.find((it) => it.id === `feed-incident-${String(doc._id)}`);
      assert.equal(match, undefined, "only traffic-category incidents should feed Traffic & delays");
    });

    await t.test("an old (outside the window) traffic incident does not appear", async () => {
      const doc = await SecurityLog.create({
        type: "attendant_incident",
        busId: TEST_BUS_ID,
        message: `Incident report (traffic) — Bus ${TEST_BUS_ID}`,
        severity: "warning",
        latitude: 8.15,
        longitude: 125.13,
        assignedRoute: TEST_ROUTE,
        source: "attendant_app",
        category: "traffic",
        note: "stale report",
      });
      createdIds.push(doc._id);
      // Mongoose's `timestamps: true` makes createdAt immutable on Model.updateOne(), silently
      // dropping it from the $set — go through the native driver collection to actually backdate it.
      await mongoose.connection
        .collection("security_logs")
        .updateOne({ _id: doc._id }, { $set: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });

      const items = await buildPassengerCommandFeedItems();
      const match = items.find((it) => it.id === `feed-incident-${String(doc._id)}`);
      assert.equal(match, undefined, "an incident older than the surfacing window must not appear");
    });
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
});
