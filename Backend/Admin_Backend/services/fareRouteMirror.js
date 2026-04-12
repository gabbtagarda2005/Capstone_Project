const mongoose = require("mongoose");
const FareRoute = require("../models/FareRoute");

/**
 * Keeps Atlas collection `FareRoutes` aligned with `corridor_routes` for fare pathfinding.
 * @param {import("mongoose").Document | Record<string, unknown>} doc
 */
async function upsertFareRouteMirrorFromCorridorDoc(doc) {
  if (!doc || !doc._id) return;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  await FareRoute.replaceOne(
    { _id: plain._id },
    {
      _id: plain._id,
      displayName: plain.displayName || "",
      originCoverageId: plain.originCoverageId,
      destinationCoverageId: plain.destinationCoverageId,
      viaCoverageIds: Array.isArray(plain.viaCoverageIds) ? plain.viaCoverageIds : [],
      authorizedStops: Array.isArray(plain.authorizedStops) ? plain.authorizedStops : [],
      suspended: plain.suspended === true,
    },
    { upsert: true }
  );
}

async function removeFareRouteMirror(id) {
  const raw = String(id || "").trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return;
  await FareRoute.deleteOne({ _id: new mongoose.Types.ObjectId(raw) });
}

module.exports = { upsertFareRouteMirrorFromCorridorDoc, removeFareRouteMirror };
