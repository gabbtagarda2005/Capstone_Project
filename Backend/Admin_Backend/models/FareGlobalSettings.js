const mongoose = require("mongoose");

const fareGlobalSettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: "global", unique: true, index: true },
    studentDiscountPct: { type: Number, default: 20, min: 0, max: 100 },
    pwdDiscountPct: { type: Number, default: 20, min: 0, max: 100 },
    seniorDiscountPct: { type: Number, default: 20, min: 0, max: 100 },
  },
  { timestamps: true, collection: "fare_global_settings" }
);

module.exports =
  mongoose.models.FareGlobalSettings ||
  mongoose.model("FareGlobalSettings", fareGlobalSettingsSchema);
