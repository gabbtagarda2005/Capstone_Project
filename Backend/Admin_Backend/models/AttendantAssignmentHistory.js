const mongoose = require("mongoose");

/**
 * Day-by-day record of which bus an attendant was assigned to — a bus's `operatorId` only ever
 * holds the *current* assignment, so this is the append-only trail behind "what bus was this
 * attendant on, on a given day" (Management → Attendants → assignment history).
 * Collection: attendant_assignment_history
 */
const attendantAssignmentHistorySchema = new mongoose.Schema(
  {
    /** "portal:<PortalUser _id>" or "mysql:<numeric attendant id>" — matches resolveOperatorIdParam. */
    attendantKey: { type: String, required: true, index: true },
    attendantPortalUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
    attendantMysqlId: { type: Number, default: null },
    busId: { type: String, required: true, index: true },
    busNumber: { type: String, default: null },
    assignedAt: { type: Date, required: true, default: Date.now },
    /** null while the assignment is still active. */
    unassignedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: "attendant_assignment_history" }
);

attendantAssignmentHistorySchema.index({ attendantKey: 1, assignedAt: -1 });
attendantAssignmentHistorySchema.index({ busId: 1, assignedAt: -1 });

module.exports =
  mongoose.models.AttendantAssignmentHistory ||
  mongoose.model("AttendantAssignmentHistory", attendantAssignmentHistorySchema);
