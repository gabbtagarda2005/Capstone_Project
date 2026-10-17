# System Overview — Bukidnon Bus Company @BUKSU

*A comprehensive, manuscript-ready description of the completed system's architecture, technology stack, data flow, and design decisions. Written from the actual working codebase, not from the original project proposal — where the two differ, this document describes what was actually built.*

---

## 1. Introduction

The Bukidnon Bus Company @BUKSU system is a distributed, GPS-enabled public transportation management platform serving three distinct user groups through three purpose-built applications: an **Administrator Module** for fleet and operations management, a **Commuter Interface** for passenger-facing trip information, and a **Bus Attendant Mobile Application** for on-bus ticketing and location reporting. The three applications are unified by a single authoritative backend and a dedicated GPS tracking hardware unit installed on each bus, so that a single source of truth — the bus's real position, its assigned route and schedule, and its ticketing activity — is what every interface ultimately displays.

The system was built as a **monorepo**: all client applications, backend services, shared documentation, and hardware firmware live in one repository, organized by role rather than by technology.

```
Capstone Project/
├── Frontend/
│   ├── Admin_Frontend/          React + Vite web app (administrator)
│   ├── Passenger_Frontend/      React + Vite web app (commuter)
│   └── BusAttendant_Frontend/   Flutter app (bus attendant)
├── Backend/
│   ├── Admin_Backend/           Node.js/Express — the system's single source of truth
│   ├── Passenger_Backend/       Node.js/Express — thin gateway for the commuter app
│   └── BusAttendant_Backend/    Node.js/Express — thin gateway for the attendant app
├── hardware/
│   ├── lilygo_ta7670e_cellular_telemetry/   on-bus GPS + 4G LTE tracker firmware
│   └── lilygo_ta7670e_sms_gateway/          dedicated SMS-fallback receiver firmware
├── shared/                      cross-cutting docs and operational scripts
└── deploy/raspberry-pi/         production deployment scripts for the admin backend
```

---

## 2. High-Level Architecture

The system follows a **hub-and-spoke architecture** with one authoritative hub and three thin, role-specific spokes:

- **Admin_Backend is the single source of truth.** It owns the MongoDB database, all business logic (GPS validation and arbitration, fare computation, ETA calculation, congestion detection, ticketing, reporting), and is the only service that writes to the database directly.
- **Passenger_Backend and BusAttendant_Backend are gateway (proxy) layers, not independent services.** Each mints its own short-lived session tokens for its respective client app, then forwards (re-signs and relays) nearly every request to Admin_Backend. This design means a commuter's app or an attendant's phone never holds admin-level database credentials, while still allowing each client app to talk to a backend scoped to its own concerns and CORS origin.
- **Three client applications**, each driven by the technology best suited to its users and constraints: React for the two browser-based apps (administrators and commuters, who need a rich desktop-class dashboard or a simple public web page respectively), and Flutter for the attendant app (which needs to run as an installable mobile app on a device carried on the bus).
- **One piece of dedicated hardware per bus** — a LILYGO T-A7670E R2 GPS + 4G LTE module — acting as a backup location source to the attendant's phone, with a third, SMS-based fallback tier for when even its own mobile data connection fails.
- **Real-time delivery via Socket.IO**, so that a GPS fix, a new announcement, or an alert reaches connected clients the instant it is accepted, rather than through polling.

A single GPS ping's journey through the system illustrates how these pieces fit together: the attendant's phone (or, if that's unavailable, the LILYGO unit) sends a coordinate to Admin_Backend; the backend validates it, runs it through outlier/anti-spoofing checks, decides whether this source is currently authoritative for that bus, persists it, and broadcasts a `locationUpdate` event over Socket.IO; the Admin dashboard and the Passenger web app — both already subscribed — move the bus marker on their respective maps without either needing to refresh or poll.

---

## 3. Technology Stack

| Layer | Technology | Where it's used |
|---|---|---|
| Admin & Commuter frontend | **React 18** + **Vite** + **TypeScript** | `Admin_Frontend`, `Passenger_Frontend` |
| Attendant mobile frontend | **Flutter** (Dart) | `BusAttendant_Frontend` — compiled to Android/iOS/web |
| Backend runtime | **Node.js** + **Express** | All three backends |
| Database | **MongoDB** (Atlas, cloud-hosted) via **Mongoose** ODM | Owned exclusively by `Admin_Backend` |
| Real-time transport | **Socket.IO** (WebSocket with fallback) | GPS position updates, live dispatch board, command-center alerts |
| Authentication | **JWT (HS256)** signed tokens + **bcrypt** password hashing | All three backends |
| Web mapping (Admin) | **Google Maps JavaScript API** (`@react-google-maps/api`) *and* **Leaflet** (switchable) | `LocationsPage.tsx` |
| Web mapping (Commuter) | **Leaflet** with OpenStreetMap-family tiles (OSM standard, CartoDB dark, Esri satellite, OpenTopoMap terrain) | `DashboardMap.tsx` |
| Routing / distance engine | **OSRM** (Open Source Routing Machine) | ETA and corridor-distance calculations |
| Geocoding | **Nominatim** (OpenStreetMap's geocoder), proxied through the backend | Address/location lookups |
| Weather data | **Open-Meteo API** | Weather advisories and ETA weather adjustment |
| Email | **Nodemailer** (Gmail SMTP) | OTPs, password resets, daily operations digest, SOS alerts |
| SMS | **IPROG SMS API** | OTPs, SOS alerts, and the LILYGO hardware's SMS GPS-fallback path |
| Security middleware | **Helmet** (HTTP headers), **CORS** allowlists, **express-rate-limit** | All three backends |
| Hardware | **LILYGO T-A7670E R2** (ESP32 + GPS + 4G LTE/GPRS modem) | On-bus tracker, programmed in C++ (Arduino framework) |
| Production deployment | **Raspberry Pi** (systemd service for the backend, a shell-script deploy for the frontend) | `deploy/raspberry-pi/` |

---

## 4. The Three Applications

### 4.1 Administrator Module
A React/Vite single-page application used by Bukidnon Bus Company staff to run the operation: creating and managing bus, driver, and attendant records; defining routes, stops, schedules, and fares; monitoring the live position of every active bus; configuring system-wide settings and staff privileges; reviewing analytics and daily operational reports; and visualizing fleet and ticketing trends on a dashboard. Access is restricted to a hard-coded email whitelist (presently two accounts) and further scoped by a role-based privilege system (detailed in §10).

### 4.2 Commuter Interface
A public, account-free React/Vite web application for passengers. It shows available routes and schedules, an estimated seat-availability indicator per bus, a live map of active buses, administrator-issued announcements and travel alerts, and local weather advisories relevant to a commuter's trip. Because it requires no login, it talks to the rest of the system entirely through `Passenger_Backend`'s public, read-mostly proxy endpoints.

### 4.3 Bus Attendant Mobile Application
A Flutter application used by the attendant assigned to each bus. After logging in, the attendant sees their assigned bus, route, and trip schedule; issues tickets to boarding passengers (with an offline queue for connectivity gaps); has their phone's GPS continuously and automatically transmitted to the backend while a trip is active; receives administrator broadcasts and weather/maintenance notices; and can raise an SOS or a categorized incident report (accident, mechanical, or traffic) that immediately alerts the administrator and — for traffic-caused delays — is reflected to affected passengers through the delay-classification pipeline.

---

## 5. Backend Architecture and the Gateway Pattern

`Admin_Backend` is the largest and most consequential codebase in the system — roughly 23 route files, 40+ service modules, and 30 Mongoose models — because it is where every piece of real business logic lives: GPS validation and source arbitration, ETA computation, congestion detection, fare pricing, ticket issuance, account/role management, reporting aggregations, and notification broadcasting.

`Passenger_Backend` and `BusAttendant_Backend` are deliberately thin. Each:
1. Exposes a small, role-appropriate set of routes to its own client app (e.g., `Passenger_Backend` exposes `/api/public/*` read endpoints; `BusAttendant_Backend` exposes `/api/auth/operator-login`, `/api/tickets/*`, `/api/live-location`, etc.).
2. Mints its own token for its client (the attendant backend additionally carries forward an admin-issued ticketing token).
3. Forwards the actual request — with the appropriate credential attached — to `Admin_Backend`, and relays the response back unchanged.

This pattern keeps each client app's network surface small and specific to what it actually needs, while avoiding any duplication of business logic or data ownership — a bug fixed once in `Admin_Backend` is fixed for every client simultaneously.

---

## 6. Database Design

The system uses a single **MongoDB Atlas** cluster, accessed exclusively through `Admin_Backend`'s Mongoose models. The roughly thirty models fall into several functional groups:

**Fleet & personnel**
`Bus` (plate number, IMEI, seat capacity, assigned route, status, driver/operator links), `Driver`, `AttendantRegistry` (verified bus-attendant personnel records, six-digit employee IDs), `PortalUser` (login accounts — `role` is one of `Admin`, `Operator`, or `BusAttendant`; there is no commuter account type), `AttendantAssignmentHistory`.

**Routing, scheduling & fares**
`CorridorRoute` (road-following route geometry between terminals), `RouteCoverage` (terminals/stops and their geofence radii), `FareMatrixEntry`, `FareRoute`, `FareGlobalSettings`, `FareChangeLog`.

**GPS & live tracking**
`GpsLog` (latest known position per bus — what the live map reads), `GpsHistory` (full breadcrumb trail per bus, for replay and the daily operations report), `IngestDevice` (registered LILYGO hardware units and their health/status).

**Ticketing**
`IssuedTicketRecord` (every ticket issued, with fare, category, and idempotency key), `TicketLocation`, `DriverTicketEditLog`.

**Security & access**
`AdminAuditLog`, `AdminAuthLockout`, `AdminRbacAssignment`, `AdminPortalSettings`, `AdminOtpCode`, `AdminItAccountOtp`, `AttendantSignupOtp`, `DriverSignupOtp`, `PasswordResetToken`, `OperatorPasswordResetOtp`, `SecurityLog` (SOS reports, incident reports, speed violations, GPS outlier rejections).

**Commuter-facing & communication**
`AppBroadcast` (administrator announcements, targeted at `passenger` and/or `attendant`), `PassengerFeedback`, `PassengerTerminalAffinity`/`PassengerTerminalAffinityRead`, `FrontendErrorLog`.

Notably, **there is no commuter/passenger account collection** — the `PortalUser.role` enum only recognizes `Admin`, `Operator`, and `BusAttendant`. Passengers interact with the system anonymously; what the administrator manages on the "passenger" side of the Management Module is feedback and lost-item records, not login accounts.

---

## 7. Real-Time Communication

`Admin_Backend` runs a Socket.IO server (`sockets/socket.js`, plus a dedicated `sockets/attendantLiveGpsSocket.js` channel) that pushes three kinds of events the moment the relevant state changes:

- **`locationUpdate` / `liveBoard`** — a bus's accepted GPS position, consumed by the Admin Locations map and (via `Passenger_Backend`'s proxy) the Commuter live map.
- **`commandAlert`** — operational alerts (SOS reports, incident reports, speed violations) pushed to the Administrator Command Center in real time.
- **Connection/subscription events** (`subscribe:buses`, `subscribe:liveBoard`) that let a newly connected client receive an immediate snapshot before further live updates arrive.

Because clients subscribe once and receive pushes thereafter, none of the three applications needs to poll the backend on a short interval to stay current — the one partial exception being the Commuter map, which (per its own code) re-fetches live positions on an ~18-second timer as a resilience fallback rather than relying on Socket.IO alone.

---

## 8. GPS Tracking Subsystem

This is the system's most architecturally significant subsystem, combining hardware redundancy, anti-spoofing validation, and a multi-stage ETA pipeline.

### 8.1 Source arbitration (hardware redundancy)
Each bus can report its position from up to three sources, and `services/gpsSourceArbiter.js` enforces a strict, documented preference order:

1. **Attendant's phone** (primary) — sent every few seconds while the Bus Attendant app has an active trip.
2. **LILYGO hardware, over its own 4G/HTTPS connection** (backup) — takes over only once the phone has stopped reporting past a configured timeout.
3. **LILYGO hardware, over SMS** (emergency) — used only when *both* the phone and the LILYGO unit's mobile-data connection have gone quiet; messages are received by a second, physically separate LILYGO unit acting as a dedicated SMS gateway and handed to the backend over USB-serial.

The arbiter is an explicit per-bus state machine (not an ad-hoc recency check) specifically to prevent a known failure mode: a stale hardware fix overwriting a fresher, still-healthy phone fix. Recovery back to the phone requires a short streak of consecutive good phone pings before the system "fails back," to avoid the map marker flapping between sources.

### 8.2 Validation and anti-spoofing
Before a fix is accepted, two independent checks run:
- **`gpsValidation.js`** — coordinate/timestamp sanity checks shared by all three ingestion paths (phone, hardware, SMS).
- **`gpsOutlierGuard.js`** — rejects a fix if the implied speed between it and the previous fix *from the same source* exceeds 180 km/h (physically implausible for a city bus), logging the rejection to `SecurityLog` as a `gps_outlier` event rather than silently dropping it.

### 8.3 ETA computation
`services/freeEtaEngine.js` computes a travel-time estimate using a tiered strategy, each tier only engaged when the one before it isn't available:
1. **Segment-based** (preferred) — sums remaining distance over each real road segment of the bus's assigned corridor, at that segment's live or historical speed.
2. **OSRM point-to-point routing** — a static route-only estimate when segment data isn't resolvable (e.g., the bus is off-route).
3. **Haversine fallback** — straight-line distance × a 1.18 road-buffer factor, divided by a clamped realistic speed, when neither of the above is available.

On top of the base estimate, the engine layers: a **terminal dwell-time buffer** (0–10 minutes, scaled to how full the bus is, modeling boarding time), a **weather delay multiplier** (up to ×1.45, derived from Open-Meteo WMO weather codes at the bus's current and upcoming stops), and a **Kalman filter** that smooths the final number across successive pings — so the displayed ETA doesn't visibly flicker — with its trust in each new reading (measurement noise) adjusted by how confident the underlying traffic data is.

### 8.4 Congestion detection
`services/congestionEngine.js` computes `congestionRatio = 1 − (currentSpeedKph / freeFlowSpeedKph)`, using the bus's own live speed against a real, driving-condition-based free-flow reference (OSRM-routed or fleet-calibrated — never a guessed constant). A bus parked at a terminal or moving under 2 km/h is explicitly excluded from classification, since a single stopped-speed reading cannot distinguish "gridlocked" from "idle."

### 8.5 Delay classification (what reaches the passenger)
`services/delayClassifier.js` independently compares how far along its corridor a bus *should* be (schedule + free-flow duration) against how far it *really* is (GPS position projected onto the route). This produces a delay tier (`EARLY` through `SEVERE_DELAY`) that is never computed from stale GPS, never flags a legitimate stop as a delay, and only attributes a delay to "traffic" when the congestion engine actually measured heavy congestion for that bus. Buses currently tagged as delayed surface to commuters as a "Traffic & delays" advisory in the public command feed.

---

## 9. Ticketing and Fare Subsystem

Ticket issuance (`POST /issue` in `routes/ticketsTicketing.js`) is built around two deliberate design choices:

- **Idempotency.** Every ticket carries a `clientRequestId`. If the attendant app's offline-sync retries a ticket whose server-side creation actually succeeded but whose response never made it back to the device, the backend recognizes the repeated key and returns the already-issued ticket instead of creating a duplicate — preventing double-charging a passenger or double-incrementing the bus's ticket counter.
- **Offline-first mobile design.** The attendant app queues tickets locally (`ticket_outbox_store.dart`) when connectivity drops and submits them automatically once it's restored, so a dead zone on the route never blocks ticketing.

Fare computation (`services/farePricing.js`) resolves a fare as:
```
subtotal = baseFarePesos (route/stop matrix) + farePerKm × distanceKm
subtotal rounded to the nearest ₱0.50
fare = subtotal × (1 − discountPct/100)   [20% default for student/PWD/senior]
fare rounded to the nearest ₱0.50
```
Every issued ticket becomes a row in `IssuedTicketRecord`, which is simultaneously the record passengers are charged against and the raw dataset the Analytics module aggregates to identify peak boarding hours, days, months, and years.

---

## 10. Security Architecture

- **Authentication.** Passwords are hashed with **bcrypt**; sessions are **JWT (HS256)** tokens verified by `requireAdminJwt.js` (admin) and `requireTicketIssuerJwt.js` (attendant/operator) on every protected route. Google Sign-In is supported for admin accounts via Firebase.
- **Authorization tiers.** Admin access is gated by a hard-coded email whitelist (`config/adminWhitelist.js`, two accounts). On top of that, a role-based access system (`services/adminRbac.js`) assigns each authorized admin one of **`super_admin`**, **`fleet_manager`**, **`auditor`**, or **`it_support`** — with a single, separately hard-coded super-admin email (`config/adminRoles.js`) retaining full delete and global-fare-rule privileges regardless of RBAC assignment. Sensitive actions (deleting a route, changing another user's privileges) are additionally gated by `requireSuperAdmin.js`.
- **Account lockout.** Repeated failed logins (tracked per email, separately for admin and attendant scopes) lock the account after a configurable 3–10 attempts (default 5) for a configurable 5–1440 minutes (default 15).
- **Rate limiting** (`express-rate-limit`, three tiers): authentication endpoints (30 requests/15 min), hardware GPS ingest (60/min — generous enough for a real device pinging every few seconds, tight enough to blunt forged telemetry), and a general backstop (300/min) on everything else.
- **HTTP hardening.** `Helmet` sets standard security headers on every backend; CORS is an explicit origin allowlist (not a wildcard) in production, with the wildcard option only ever honored when deliberately set for local development.
- **Audit trail.** Privilege changes and other sensitive admin actions are written to `AdminAuditLog` and reviewable in the Settings module.

---

## 11. Notification and Alert Subsystem

Two related but distinct mechanisms cover the system's "alerting" functional requirements:

- **Administrator-authored broadcasts** (`AppBroadcast` model, `routes/appBroadcast.js`) — a message with a severity (`normal`/`medium`/`critical`) and a target audience (`passenger` and/or `attendant`), composed by an admin on the Command Center's Broadcast page and polled by both the Passenger web app and the Attendant mobile app.
- **Automatic, condition-triggered alerts ("Smart Alert")** — the attendant can raise an SOS (with an urgency level) or a categorized incident report (accident/mechanical/traffic) directly from the mobile app; both are logged to `SecurityLog` and pushed to the Admin Command Center instantly via `commandAlert`, with an SOS additionally triggering an email and SMS to administrators (`services/sosAdminNotify.js`). Automatically detected speed violations (`services/speedViolationAlert.js`, threshold 80 km/h) follow the same admin-alert path. Trouble that manifests as a delay (rather than requiring an admin's immediate attention) reaches passengers indirectly, through the delay-classification pipeline described in §8.5 — the attendant never has to manually notify passengers of a traffic delay.

---

## 12. Analytics and Reporting Subsystem

`services/reportMasterAggregations.js` and `services/reportsAnalyticsMongo.js` run MongoDB aggregation pipelines over `IssuedTicketRecord` and GPS logs to produce usage statistics and peak-hour figures. `services/dailyOperationsReport.js`, scheduled by `dailyOperationsReportCron.js`, compiles each day's arrival precision, speed violations, crew activity, and hub health into a daily operations snapshot — optionally emailed to administrators (`dailyOperationsDigestEmail.js`) and exportable as PDF (`reportMasterPdfmake.js`, `reportPdfCharts.js`) or Excel.

---

## 13. The GPS Hardware Component

The on-bus hardware is a **LILYGO T-A7670E R2**, an ESP32-based board integrating GPS positioning with a **4G LTE/GPRS cellular modem** on a single unit, programmed in C++ against the Arduino framework. Its role is strictly that of a **backup**, not a replacement, to the attendant's phone (§8.1): it reports a GPS fix over its own cellular HTTPS connection when the phone has gone quiet, and — as a last resort, if its own mobile-data connection is also failing — over SMS, received by a second, physically separate LILYGO unit dedicated solely to that purpose (`hardware/lilygo_ta7670e_sms_gateway/`) and relayed to the backend over USB-serial (`services/smsGpsReceiver.js`). A periodic heartbeat (`services/deviceStatusIngest.js`) reports each unit's cellular/GPS-fix/SMS-fallback status, surfaced on the Admin dashboard's Fleet Hardware Summary.

---

## 14. Deployment

For local development, each of the six processes (three backends, two React dev servers, one Flutter web build) runs independently on its own port (4000/4001/4011 for the backends, 5173/5174 for the web frontends, 50015 for the Flutter web build), orchestrated by a one-shot PowerShell script (`shared/scripts/start-all.ps1`). For production, `Admin_Backend` runs as a **systemd service on a Raspberry Pi** (`deploy/raspberry-pi/admin-backend.service`), with a companion shell script (`deploy-frontend.sh`) handling frontend deployment to the same device — a deliberately low-cost, locally-hosted deployment target appropriate for a single bus company's operations, backed by a cloud-hosted MongoDB Atlas database rather than a locally-hosted one.

---

## 15. Functional Requirements → Subsystem Map

| Functional Requirement | Primary Subsystem(s) |
|---|---|
| Admin Login / Attendant Login | §10 Security Architecture |
| User (Attendant/Driver) Account Management | §6 Database Design — fleet & personnel |
| Bus Management | §6 Database Design — fleet & personnel |
| Route and Schedule Management | §6 Database Design — routing, scheduling & fares |
| Real-Time Bus Monitoring (Admin & Commuter) | §7 Real-Time Communication, §8 GPS Tracking |
| System Configuration | §10 Security Architecture (RBAC) |
| Analytics and Reporting | §12 Analytics and Reporting |
| Dashboard Trends and Visualization | §12 Analytics and Reporting |
| View Routes and Schedules (Commuter) | §5 Gateway Pattern, §6 Database Design |
| Seat Availability Check | §9 Ticketing (occupancy derived from issued tickets) |
| Notification and Alerts / Notification Handling | §11 Notification and Alert Subsystem |
| Weather Display | §8.3 ETA weather adjustment, §11 |
| Trip Dashboard | §6 Database Design — fleet & personnel |
| Ticketing | §9 Ticketing and Fare Subsystem |
| GPS Transmission | §8 GPS Tracking Subsystem, §13 Hardware |
| Smart Alert | §11 Notification and Alert Subsystem |

This table — and every subsystem it points to — is the same material documented screen-by-screen, file-by-file in `CHAPTER4_SYSTEM_PRESENTATION.md`, and tested requirement-by-requirement in `CHAPTER4_TEST_CASES.csv`. This document is the connective narrative between them: it explains *why* the system is shaped the way it is, where those two documents show *what* was built and *how it's verified*.
