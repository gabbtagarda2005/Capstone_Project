const mongoose = require("mongoose");

const fareGlobalSettingsSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: "global", unique: true, index: true },
    studentDiscountPct: { type: Number, default: 20, min: 0, max: 100 },
    pwdDiscountPct: { type: Number, default: 20, min: 0, max: 100 },
    seniorDiscountPct: { type: Number, default: 20, min: 0, max: 100 },
    /** Base distance rate in PHP per kilometer (policy; matrix base fares remain primary for quotes). */
    farePerKmPesos: { type: Number, default: 0, min: 0 },
    /**
     * Ordered major terminals along the main line. When no deployed corridor graph connects two hubs,
     * inter-hub fare = sum of hub→hub matrix legs along this chain (forward or backward).
     */
    hubChainCoverageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "RouteCoverage" }],
      default: [],
    },
  },
  { timestamps: true, collection: "fare_global_settings" }
);

module.exports =
  mongoose.models.FareGlobalSettings ||
  mongoose.model("FareGlobalSettings", fareGlobalSettingsSchema);
