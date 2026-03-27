const Bus = require("../models/Bus");

function healthStatusFromTicketCount(n) {
  const c = Number(n) || 0;
  if (c > 1000) return "Due for Inspection";
  if (c > 100) return "Needs Maintenance";
  return "Good";
}

/**
 * After changing ticketsIssued, persist derived healthStatus on the bus document.
 */
async function refreshBusHealthByBusId(busIdNorm) {
  const doc = await Bus.findOne({ busId: busIdNorm }).lean();
  if (!doc) return null;
  const next = healthStatusFromTicketCount(doc.ticketsIssued);
  if (doc.healthStatus !== next) {
    await Bus.updateOne({ _id: doc._id }, { $set: { healthStatus: next, lastUpdated: new Date() } });
  }
  return next;
}

/**
 * Increment Mongo ticketsIssued for the registered bus matching busId (e.g. BUK-101).
 */
async function incrementBusTicketsIssued(busNumberRaw) {
  const busId = normalizeBusId(busNumberRaw);
  if (!busId) return { ok: false, reason: "invalid_bus_number" };

  const updated = await Bus.findOneAndUpdate(
    { busId },
    { $inc: { ticketsIssued: 1 }, $set: { lastUpdated: new Date() } },
    { new: true }
  ).lean();

  if (!updated) return { ok: false, reason: "bus_not_registered" };

  const nextHealth = healthStatusFromTicketCount(updated.ticketsIssued);
  if (updated.healthStatus !== nextHealth) {
    await Bus.updateOne({ _id: updated._id }, { $set: { healthStatus: nextHealth } });
  }

  return { ok: true, busId, ticketsIssued: updated.ticketsIssued, healthStatus: nextHealth };
}

function normalizeBusId(raw) {
  if (raw == null) return "";
  const s = String(raw).trim().toUpperCase();
  if (!s) return "";
  return s;
}

module.exports = {
  healthStatusFromTicketCount,
  refreshBusHealthByBusId,
  incrementBusTicketsIssued,
  normalizeBusId,
};
