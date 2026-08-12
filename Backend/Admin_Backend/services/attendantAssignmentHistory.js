const AttendantAssignmentHistory = require("../models/AttendantAssignmentHistory");

/** Same identity scheme as routes/attendantsSignup.js resolveOperatorIdParam. */
function attendantKeyFor({ operatorPortalUserId, operatorMysqlId }) {
  if (operatorPortalUserId) return `portal:${String(operatorPortalUserId)}`;
  if (operatorMysqlId != null) return `mysql:${operatorMysqlId}`;
  return null;
}

/**
 * Call whenever a bus's assigned attendant changes (creation or PATCH). No-op if the attendant
 * is unchanged. Closes the outgoing attendant's open row for this bus and opens a new row for
 * the incoming attendant — defensively closing any stray open row that attendant had on a
 * *different* bus first, since an attendant is only ever assigned to one bus at a time.
 */
async function recordAssignmentChange({
  busId,
  busNumber,
  oldOperatorPortalUserId,
  oldOperatorMysqlId,
  newOperatorPortalUserId,
  newOperatorMysqlId,
}) {
  const oldKey = attendantKeyFor({ operatorPortalUserId: oldOperatorPortalUserId, operatorMysqlId: oldOperatorMysqlId });
  const newKey = attendantKeyFor({ operatorPortalUserId: newOperatorPortalUserId, operatorMysqlId: newOperatorMysqlId });
  if (oldKey === newKey) return;

  const bid = String(busId);
  const now = new Date();

  if (oldKey) {
    await AttendantAssignmentHistory.updateMany(
      { busId: bid, attendantKey: oldKey, unassignedAt: null },
      { $set: { unassignedAt: now } }
    );
  }

  if (newKey) {
    await AttendantAssignmentHistory.updateMany(
      { attendantKey: newKey, unassignedAt: null, busId: { $ne: bid } },
      { $set: { unassignedAt: now } }
    );
    await AttendantAssignmentHistory.create({
      attendantKey: newKey,
      attendantPortalUserId: newOperatorPortalUserId || null,
      attendantMysqlId: newOperatorMysqlId != null ? newOperatorMysqlId : null,
      busId: bid,
      busNumber: busNumber || null,
      assignedAt: now,
      unassignedAt: null,
    });
  }
}

/**
 * Self-heal for assignments that predate this feature (or otherwise never got a history row):
 * if this bus's *current* attendant has no open history row for it, backfill one. There's no way
 * to know the exact original assignment date, so this uses the bus record's own creation time as
 * the best available lower-bound proxy (not `lastUpdated`, which bumps on unrelated edits like a
 * plate-number change and would understate how long the assignment has actually been active).
 */
async function ensureAssignmentRecorded(bus) {
  const key = attendantKeyFor({
    operatorPortalUserId: bus.operatorPortalUserId,
    operatorMysqlId: bus.operatorMysqlId,
  });
  if (!key) return;
  const bid = String(bus.busId);

  const existingOpen = await AttendantAssignmentHistory.findOne({
    attendantKey: key,
    busId: bid,
    unassignedAt: null,
  }).lean();
  if (existingOpen) return;

  // Tidy up any stray open row on a different bus first — an attendant is only ever on one bus.
  await AttendantAssignmentHistory.updateMany(
    { attendantKey: key, unassignedAt: null, busId: { $ne: bid } },
    { $set: { unassignedAt: new Date() } }
  );

  const assignedAt = bus.createdAt || bus.lastUpdated || new Date();
  await AttendantAssignmentHistory.create({
    attendantKey: key,
    attendantPortalUserId: bus.operatorPortalUserId || null,
    attendantMysqlId: bus.operatorMysqlId != null ? bus.operatorMysqlId : null,
    busId: bid,
    busNumber: bus.busNumber || null,
    assignedAt,
    unassignedAt: null,
  });
}

/** Close any still-open assignment row for a bus that's being removed from the registry. */
async function closeOpenAssignmentsForBus(busId) {
  await AttendantAssignmentHistory.updateMany(
    { busId: String(busId), unassignedAt: null },
    { $set: { unassignedAt: new Date() } }
  );
}

module.exports = {
  recordAssignmentChange,
  attendantKeyFor,
  closeOpenAssignmentsForBus,
  ensureAssignmentRecorded,
};
