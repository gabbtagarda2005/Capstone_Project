const Bus = require("../models/Bus");

function formatPersonName(first, last) {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim();
}

/**
 * Load live bus registry row for lost-item alerts (driver, attendant, plate, route).
 * @param {string} busId — canonical `buses.busId`
 */
async function loadBusContextForLostItem(busId) {
  const id = String(busId || "").trim();
  const empty = {
    busNumber: id || "—",
    busPlate: "—",
    routeFromDb: null,
    driverMongoId: "",
    driverDisplayName: "",
    attendantDisplayName: "",
  };
  if (!id || id === "UNKNOWN") {
    return empty;
  }
  try {
    const b = await Bus.findOne({ busId: id })
      .populate("driverId", "firstName lastName")
      .populate("operatorPortalUserId", "firstName lastName")
      .lean();
    if (!b) {
      return { ...empty, busNumber: id };
    }
    const busNumber = (b.busNumber != null && String(b.busNumber).trim()) || id;
    const busPlate = (b.plateNumber != null && String(b.plateNumber).trim()) || "—";
    const routeFromDb = b.route != null && String(b.route).trim() ? String(b.route).trim() : null;
    let driverMongoId = "";
    let driverDisplayName = "";
    if (b.driverId && typeof b.driverId === "object" && b.driverId._id) {
      driverMongoId = String(b.driverId._id);
      driverDisplayName = formatPersonName(b.driverId.firstName, b.driverId.lastName);
    }
    let attendantDisplayName = "";
    if (b.operatorPortalUserId && typeof b.operatorPortalUserId === "object") {
      attendantDisplayName = formatPersonName(
        b.operatorPortalUserId.firstName,
        b.operatorPortalUserId.lastName
      );
    }
    return {
      busNumber,
      busPlate,
      routeFromDb,
      driverMongoId,
      driverDisplayName,
      attendantDisplayName,
    };
  } catch {
    return { ...empty, busNumber: id };
  }
}

module.exports = { loadBusContextForLostItem, formatPersonName };
