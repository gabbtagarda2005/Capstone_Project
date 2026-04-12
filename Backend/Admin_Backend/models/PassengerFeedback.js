const mongoose = require("mongoose");

const passengerFeedbackSchema = new mongoose.Schema(
  {
    passengerName: { type: String, trim: true, maxlength: 120, default: "Anonymous" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 2000, default: "" },
    driverId: { type: String, trim: true, maxlength: 64, default: "" },
    driverName: { type: String, trim: true, maxlength: 120, default: "" },
    attendantId: { type: String, trim: true, maxlength: 64, default: "" },
    attendantName: { type: String, trim: true, maxlength: 120, default: "" },
    busPlate: { type: String, trim: true, maxlength: 32, default: "" },
    routeName: { type: String, trim: true, maxlength: 200, default: "" },
    /** What the passenger said the feedback is mainly about (admin feed filter). */
    feedbackAbout: {
      type: String,
      trim: true,
      enum: ["bus", "driver", "attendant", "location"],
      default: "location",
    },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    isSos: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "passenger_feedbacks" }
);

passengerFeedbackSchema.index({ createdAt: -1 });
passengerFeedbackSchema.index({ rating: 1, createdAt: -1 });
passengerFeedbackSchema.index({ routeName: 1 });

module.exports =
  mongoose.models.PassengerFeedback || mongoose.model("PassengerFeedback", passengerFeedbackSchema);
