const mongoose = require("mongoose");

/**
 * COORDINATE PIPELINE — bus stops, terminals, and deployed points (read this before touching
 * anything coordinate-related in this file or its consumers).
 *
 * 1. ORIGIN: coordinates are entered by an admin in Admin_Frontend's Location management panel
 *    (`ManagementModulePage.tsx` → `LocationManagementPanel`) — via typed lat/lng inputs, a
 *    Nominatim place search, a map click, or dragging the marker.
 * 2. FORMAT IN MONGODB: plain separate `latitude`/`longitude` Number fields on `terminal` and on
 *    each `stops[]` entry (see below) — NOT a GeoJSON `{type:"Point", coordinates:[lng,lat]}`
 *    structure. There is no GeoJSON anywhere in this collection; do not introduce one without
 *    updating every reader, since none of them expect it today.
 * 3. ADMIN API: `POST /api/locations/coverage` (`routes/locationsTicketing.js`) creates/updates
 *    this document, saving `latitude`/`longitude` essentially as submitted.
 * 4. PASSENGER API: `GET /api/public/deployed-points` (`server.js`) reads this same collection and
 *    re-serializes `terminal`/`stops[]` with the identical field names — a pure field-for-field
 *    copy, never an array/tuple, so there is no lat/lng-order transposition risk here.
 * 5. PASSENGER PROXY: `Backend/Passenger_Backend/server.js`'s `proxyAdminPublic` forwards that
 *    response byte-for-byte (no parsing, no transformation).
 * 6. PASSENGER FRONTEND: `DashboardMap.tsx` renders `<Marker position={[s.latitude, s.longitude]}>`
 *    — Leaflet's expected `[lat, lng]` order, built directly from the named fields above (not from
 *    a positional array), so there is no order bug possible in that call either.
 * 7. FORMAT LEAFLET EXPECTS: `[latitude, longitude]` tuples for `position`/`center` props — the
 *    conversion from this schema's named fields to that tuple happens only at the last possible
 *    step, inside each `<Marker>`/`<Circle>` call, never earlier.
 *
 * ROAD SNAPPING: raw admin-entered coordinates are frequently a few tens of meters off the real
 * road (manual placement or geocoder-centroid imprecision — not a bug in this pipeline). See
 * `services/busStopLocationValidation.js` (`validateBusStopLocation()`) for the fix: it snaps a
 * candidate coordinate to (1) the assigned corridor's own road geometry if one exists, else
 * (2) the nearest road in general via OSRM (`services/osrmTrafficService.js`'s `snapGpsToRoad`,
 * which calls OSRM's `/nearest` service — NOT `/match`, which requires ≥2 points and cannot snap
 * a single one). If neither succeeds within `STOP_SNAP_MAX_DISTANCE_M` (default 60m), the original
 * coordinate is returned unchanged with `reason: "too_far_from_road"` — it is never silently moved
 * an unbounded distance. `originalLatitude`/`originalLongitude`/`roadSnapped`/`roadSnapDistanceM`
 * below are the audit trail of that decision; `latitude`/`longitude` stay the one coordinate every
 * consumer (Admin map, Passenger map, fare/ETA calculations) reads — there is no second copy.
 * Existing stops are validated (not auto-modified) via `GET /api/locations/coverage/audit`, which
 * runs the same validator read-only and flags anything still too far from a road for manual
 * admin review — see `Frontend/Admin_Frontend/src/pages/ManagementModulePage.tsx`'s
 * "🔍 Audit existing locations" panel.
 */

const stopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    sequence: { type: Number, required: true, min: 1 },
    /** Same corridor chainage as terminal.kilometersFromStart (km from shared origin). */
    kilometersFromStart: { type: Number, min: 0 },
    geofenceRadiusM: { type: Number, default: 100, min: 10 },
    // When false, strict pickup buses will NOT allow pickups at this stop.
    // Default is true for backward compatibility (existing stops keep working).
    pickupOnly: { type: Boolean, default: true },
    /**
     * Road-snapping audit trail (all optional — absent on stops saved before this feature).
     * `latitude`/`longitude` above remain the one official coordinate every consumer reads;
     * these fields only record what was submitted before snapping, for admin/debug display.
     */
    originalLatitude: { type: Number },
    originalLongitude: { type: Number },
    roadSnapped: { type: Boolean },
    roadSnapDistanceM: { type: Number },
  },
  { _id: false }
);

const routeCoverageSchema = new mongoose.Schema(
  {
    locationName: { type: String, required: true, trim: true, index: true },
    pointType: { type: String, enum: ["terminal", "stop"], default: "terminal" },
    terminal: {
      name: { type: String, required: true, trim: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      geofenceRadiusM: { type: Number, default: 500, min: 50 },
      // When false, strict pickup buses will NOT allow pickups at the terminal.
      pickupOnly: { type: Boolean, default: true },
      /** Optional chainage (km) from a corridor origin — used for fare: base + |stopKm − terminalKm| × fare/km. */
      kilometersFromStart: { type: Number, min: 0 },
      /** Road-snapping audit trail — see stopSchema comment above for the same fields. */
      originalLatitude: { type: Number },
      originalLongitude: { type: Number },
      roadSnapped: { type: Boolean },
      roadSnapDistanceM: { type: Number },
    },
    /** Optional corridor/location pinpoint (separate from terminal hub center). */
    locationPoint: {
      name: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    /**
     * Inbound corridor ordering: stops with sequence < this value are "before" the hub terminal
     * along the modeled route. Pricing for those stops is controlled by [preTerminalStopFarePolicy].
     */
    terminalInboundSequence: { type: Number, min: 1 },
    /**
     * For stops with sequence < terminalInboundSequence on inter-hub trips:
     * - distance_only (default): origin hub terminal → stop × fare/km only (no matrix to destination hub).
     * - matrix_plus_corridor_delta: hub-to-hub matrix + |km_stop−km_terminal|×fare/km (after-terminal style spurs).
     */
    preTerminalStopFarePolicy: {
      type: String,
      enum: ["matrix_plus_corridor_delta", "distance_only"],
      default: "distance_only",
    },
    stops: { type: [stopSchema], default: [] },
  },
  { timestamps: true, collection: "route_coverage" }
);

module.exports = mongoose.models.RouteCoverage || mongoose.model("RouteCoverage", routeCoverageSchema);

