const mongoose = require("mongoose");

/**
 * Latest coordinate per bus — collection: gps_logs (live map reads this)
 */
const gpsLogSchema = new mongoose.Schema(
  {
    busId: { type: String, required: true, unique: true, index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    speedKph: { type: Number, default: null },
    heading: { type: Number, default: null },
    /** Last attendant connectivity tier: strong | weak | offline */
    signal: { type: String, default: null },
    /** active source used on admin map: staff | hardware */
    source: { type: String, default: "staff" },
    /** when source=hardware, indicates uplink path: wifi | 4g | unknown */
    network: { type: String, default: null },
    /** modem RSSI/RSRP normalized to number when available */
    signalStrength: { type: Number, default: null },
    /** hardware supply/battery voltage from LILYGO telemetry */
    voltage: { type: Number, default: null },
    attendantRecordedAt: { type: Date, default: null },
    hardwareRecordedAt: { type: Date, default: null },
    attendantLatitude: { type: Number, default: null },
    attendantLongitude: { type: Number, default: null },
    hardwareLatitude: { type: Number, default: null },
    hardwareLongitude: { type: Number, default: null },
    recordedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, collection: "gps_logs" }
);

module.exports = mongoose.models.GpsLog || mongoose.model("GpsLog", gpsLogSchema);
