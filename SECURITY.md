# Security — Bukidnon Transit Platform

This document tracks the platform's threat model, what's implemented, and what remains. Security
is treated as ongoing, not a one-time pass — this file should be updated whenever auth, GPS
ingestion, or the trust boundaries below change.

**This system is not "100% secure."** It implements defense-in-depth against the threats below;
remaining risks are listed explicitly in each section rather than hidden.

## Architecture / trust boundaries

- **Admin_Backend** (port 4001) — owns MongoDB, Firebase Auth verification, Socket.IO broadcast,
  GPS ingestion (both attendant-phone and LILYGO-hardware paths), SMS/SMTP dispatch. The
  authoritative service; other backends are thin proxies in front of it.
- **BusAttendant_Backend** (port 4011) — proxies the attendant Flutter/web app to Admin_Backend.
  No database of its own. Mints its own short-lived JWT for the attendant session, but the GPS/
  ticketing proxy calls carry a separate Admin-issued ticket-issuer token that Admin_Backend
  re-validates — this service does not need to duplicate that validation.
- **Passenger_Backend** (port 4000) — public, unauthenticated by design (no passenger accounts).
  Proxies public read endpoints from Admin_Backend and logs an anonymous terminal-affinity
  counter. Every route here is intentionally public.
- **LILYGO hardware** (T-A7670E field units) — POST GPS telemetry directly to Admin_Backend
  (`/api/buses/ping`, `/api/buses/hardware-telemetry`), bypassing the other two services.

## Zero-trust posture

Nothing supplied by a client is trusted for identity or authorization:
- Google login: Admin_Backend verifies the Firebase ID token server-side (signature, audience,
  expiry) via `firebase-admin` — it never trusts a client-supplied email
  ([config/firebaseAdmin.js](Backend/Admin_Backend/config/firebaseAdmin.js)).
- Attendant GPS via Socket.IO: the bus/attendant identity is derived from the verified JWT on the
  socket (`live_fleet_authenticate`), never from client-supplied `busId`
  ([sockets/attendantLiveGpsSocket.js](Backend/Admin_Backend/sockets/attendantLiveGpsSocket.js)).
- All JWT verification across Admin_Backend pins `algorithms: ["HS256"]` explicitly rather than
  trusting whatever algorithm the token claims.

## GPS security

- **Coordinate validation**: range-checked, NaN/Infinity rejected, `(0,0)` no-fix sentinel
  rejected ([services/attendantGpsIngest.js](Backend/Admin_Backend/services/attendantGpsIngest.js) `isValidGpsCoordinate`).
- **Anti-spoofing / outlier rejection**: [services/gpsOutlierGuard.js](Backend/Admin_Backend/services/gpsOutlierGuard.js)
  computes implied speed between a new fix and the last fix from the *same* source (hardware vs.
  hardware, phone vs. phone). A jump implying >180 km/h is rejected from becoming the published
  position — the raw fix is still recorded for diagnostics, and a `gps_outlier` entry is written
  to `SecurityLog` (queryable via `/api/security/logs`). Applied to both the phone path
  (`ingestAttendantGps`) and the hardware path (`ingestDeviceGps`), so it covers the HTTP ingest
  routes and the Socket.IO attendant path (which shares the same function).
- **Device authentication — two tiers, per-device now available**:
  [services/deviceIngestAuth.js](Backend/Admin_Backend/services/deviceIngestAuth.js)'s
  `authenticateDeviceIngest(req, claimedBusId)` is the single entry point used by all three
  ingest routes (`/api/buses/ping`, `/api/buses/hardware-telemetry`, `/api/hardware-telemetry`):
  1. **Per-device credential (preferred)** — if the request carries `x-device-id` +
     `x-device-key` headers, it's verified against a registry
     ([models/IngestDevice.js](Backend/Admin_Backend/models/IngestDevice.js) /
     [services/deviceRegistry.js](Backend/Admin_Backend/services/deviceRegistry.js)): each device
     has its own bcrypt-hashed secret and is bound to exactly one `busId`. The registry's `busId`
     is authoritative and **overrides** whatever `busId`/`imei` the request body claimed — a
     device cannot impersonate a different bus even if it sends one in the body. Revoked devices
     are rejected immediately. Managed via admin-only routes (`requireAdminJwt`, mounted under
     `/api/fleet`, added in [routes/fleetHardware.js](Backend/Admin_Backend/routes/fleetHardware.js)):
     - `POST /api/fleet/devices { deviceId, busId, label? }` → returns `{ deviceId, busId, secret }`.
       **The `secret` is shown exactly once** — copy it into that physical unit's config
       (`x-device-key` header) immediately; it is stored only as a hash and cannot be recovered.
     - `GET /api/fleet/devices` → list registered devices (no secrets returned).
     - `POST /api/fleet/devices/:deviceId/revoke` → immediately blocks that device's credential
       (the IT-emergency "revoke device credential" control).
     Live-tested: created a test device, confirmed a matching `busId`+secret is accepted (204),
     confirmed the *same* credential claiming a different `busId` is rejected (401, cross-bus
     impersonation blocked), confirmed a wrong secret is rejected (401), confirmed revocation
     immediately blocks further ingest (401), confirmed the management routes 401 without an
     admin JWT. Test device and its data were cleaned up afterward.
  2. **Fleet-wide shared secret (legacy fallback)** — if no per-device headers are presented,
     falls back to the original `DEVICE_INGEST_SECRET`/`DEVICE_INGEST_API_KEY` check, for units
     not yet migrated to a per-device credential.
  ⚠️ **Known gap, not yet closed**: the shared-secret fallback is a no-op if neither env var is
  set — currently true in this dev environment, meaning any device that does *not* send
  `x-device-id`/`x-device-key` is still accepted unauthenticated. **Action needed before any real
  deployment**: register every physical unit via `POST /api/fleet/devices` and flash its unique
  secret into its `config.h` (`x-device-key` header) — once every unit has migrated, remove
  `DEVICE_INGEST_SECRET`/`DEVICE_INGEST_API_KEY` from the fallback path entirely (or set them to a
  strong value as an interim measure for units not yet migrated). Treat "every bus migrated to a
  per-device credential" as a hard release gate before public/production deployment.
- **Rate limiting**: `deviceIngestLimiter` (60 req/min per IP) on `/api/buses/ping`,
  `/api/buses/hardware-telemetry`, and `/api/hardware-telemetry`.
- **Not implemented**: sequence-number/nonce-based replay detection (an attacker who captures a
  *plausible* — not outlier — packet could still resend it undetected). Low priority relative to
  the auth gap above; revisit once device auth is enforced.

## Authentication & JWT

- Admin/attendant login: per-account lockout after N failed attempts (configurable, default 5
  attempts / 15 min lockout) via [services/adminAuthLockout.js](Backend/Admin_Backend/services/adminAuthLockout.js).
- All 11 JWT verification sites in Admin_Backend pin `algorithms: ["HS256"]`.
- BusAttendant_Backend no longer falls back to a hardcoded JWT secret
  (`"change-this-secret"`) — it fails closed (503) if `BUS_ATTENDANT_JWT_SECRET` is unset. That
  secret **must** equal Admin_Backend's `JWT_SECRET` (documented in `.env.example`); the local dev
  `.env` has been created with matching values.
  ⚠️ **Regression found and fixed**: removing the hardcoded fallback initially broke login,
  because this service's `server.js` never actually called `require("dotenv").config()` — it had
  no `dotenv` dependency at all, so `.env` was silently never read (the old fallback secret was
  masking that gap). Added `dotenv` to `package.json` and the `require("dotenv").config()` call at
  the top of `server.js`, matching Admin_Backend/Passenger_Backend's pattern. Verified: `.env`
  now loads, and `operator-login` reaches real credential validation again instead of 503ing.
- Passwords/OTPs: bcrypt (bcryptjs), cost factor bumped from 10 → 12 across all 17 hash sites in
  Admin_Backend. Existing cost-10 hashes remain valid (bcrypt embeds its own cost factor); only
  newly created hashes use the higher cost.
- **Known gap**: Admin_Frontend stores the admin JWT in `localStorage`, not an httpOnly cookie.
  No XSS sink currently exists in the codebase (audited — no `dangerouslySetInnerHTML` anywhere),
  so this isn't actively exploitable today, but it's a defense-in-depth gap: a future XSS bug
  would be able to exfiltrate the session. Moving to httpOnly cookies is a real architecture
  change (CSRF token flow required) — flagged, not done, pending a decision on priority.

## Rate limiting

`express-rate-limit` added to all three backends:
- Admin_Backend: general 300 req/min per IP on all `/api/*`; auth routes (login, google-login,
  operator-login, forgot/reset/OTP — every POST under `/api/auth`) at 30 req/15min; device
  ingest at 60 req/min.
- BusAttendant_Backend: general 300 req/min; `/api/auth/*` POSTs at 30 req/15min.
- Passenger_Backend: general 300 req/min; the unauthenticated `terminal-affinity` write endpoint
  at 30 req/min.

## CORS

- Admin_Backend: explicit allowlist (`CORS_ORIGIN` + optional `CORS_ALLOW_LOCALHOST`) — already
  correct before this pass.
- Passenger_Backend: previously defaulted to `*` (wildcard) whenever `CORS_ORIGIN` was unset —
  **fixed** to default to the known local dev frontend origins instead; `*` is now only honored
  when explicitly set (and logs a warning when it is).
- BusAttendant_Backend: `origin: true` (reflects any origin). Left as-is — auth here is
  Bearer-token based (not cookies), so this doesn't create a CSRF/credential-theft path the way
  it would for cookie auth, but it's broader than necessary. Low priority.

## Security headers

`helmet` added to all three backends: `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
`Strict-Transport-Security`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy:
cross-origin` (kept permissive so the frontends on other origins/ports can still fetch these
APIs directly). `contentSecurityPolicy` is disabled at the API layer — these are pure JSON/
Socket.IO services with no HTML to protect.

### Frontend CSP (not yet deployed — see below)

Neither React app (Admin_Frontend, Passenger_Frontend) currently ships a CSP. It was **not**
added as a `<meta>` tag in `index.html` because that file is shared with the Vite dev server,
and Vite's dev-mode HMR relies on `eval()` / inline scripts that a strict CSP would break —
adding it there would have broken `npm run dev` for both apps. CSP belongs at the production
static-host layer (Nginx, Vercel/Netlify headers config, etc.), applied only to the built output.
Based on an audit of every external host each app actually calls, here is the CSP ready to apply
at that layer:

**Admin_Frontend:**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://maps.googleapis.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://*.basemaps.cartocdn.com https://maps.googleapis.com https://maps.gstatic.com https://api.qrserver.com https://lh3.googleusercontent.com;
  connect-src 'self' https://api.weatherapi.com https://api.open-meteo.com https://maps.googleapis.com https://*.googleapis.com https://*.firebaseio.com https://*.firebasedatabase.app https://*.firebaseapp.com <ADMIN_API_ORIGIN>;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```
(`style-src 'unsafe-inline'` is required because the app uses React inline `style` props
extensively; there's no CSS-in-JS nonce setup to avoid it. Replace `<ADMIN_API_ORIGIN>` with the
deployed Admin API origin if the frontend calls it cross-origin rather than same-origin.)

**Passenger_Frontend:**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://*.tile.opentopomap.org;
  connect-src 'self' https://router.project-osrm.org <PASSENGER_API_ORIGIN> <ADMIN_API_ORIGIN>;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
```

Both should also add `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, and
`X-Frame-Options: DENY` at the same static-host layer once served over HTTPS.

## Dependency audit

`npm audit fix` (non-breaking) applied to all three backends:
- Admin_Backend: 33 → 12 vulnerabilities (the critical `websocket-driver` and high `ws`
  Socket.IO-adapter issues are resolved). Remaining 12 (10 moderate, 2 high) are all a `uuid`
  version conflict deep in `firebase-admin`'s dependency tree (via `@google-cloud/firestore` /
  `google-gax`) — fixing those requires a major-version bump of `firebase-admin`, which is a
  breaking change not applied here without testing Firebase Auth/RTDB compatibility first.
- BusAttendant_Backend: 3 → 0.
- Passenger_Backend: 8 → 0.

Verified all three backends still boot and respond correctly after both the code changes and the
dependency updates (Socket.IO handshake re-tested after the `ws` update).

## Secrets

- No `.env` file has ever been committed to git (verified via `git log --all -- **/.env` and
  `.gitignore`).
- A real (non-placeholder) WeatherAPI.com key was committed in `Backend/Passenger_Backend/.env.example`
  and `Backend/BusAttendant_Backend/.env.example`. Removed from both example files.
  **Action needed from you**: rotate this key at weatherapi.com — it was exposed in git history
  and I cannot rotate a third-party API key on your behalf.
- `hardware/lilygo_gps_telemetry/config.h.txt` is tracked in git but contains only placeholder
  values; the `.gitignore` pattern (`hardware/**/config.h`) doesn't match `config.h.txt`. No
  actual leak, but rename/adjust the pattern if a real per-device config ever needs that name.

## Firmware

- `lilygo_ngrok_bus_ping.ino` disabled TLS certificate verification (`setInsecure()`) for its
  ngrok-tunnel dev/demo path. Left functionally as-is (this sketch talks to an ephemeral ngrok
  tunnel to a dev machine, never a fixed production domain — pinning a CA here would break on
  every new tunnel), but the security boundary is now made explicit in code comments and a
  runtime serial warning. **Do not adapt this sketch's pattern for a real fleet deployment** —
  production units should point at a fixed domain with a real certificate and use
  `client.setCACert(...)`.
- The actual production sketch (`lilygo_ta7670e_wifi_telemetry`) posts over plain HTTP to
  Admin_Backend's LAN address in the current dev setup — no TLS bypass issue there since there's
  no TLS involved at all. For a real production deployment where the device reaches Admin_Backend
  over the public internet/cellular APN, adding HTTPS on that path is a real embedded-TLS
  undertaking that needs testing on physical hardware — flagged as follow-up work, not attempted
  blind here.

## Not yet addressed (remaining phases)

- Physical rollout of per-device credentials: the registry/verification system above exists and
  is tested, but no real LILYGO unit has been registered/reflashed yet — that's a per-device,
  per-bus task for whoever has physical access to the hardware.
- GPS sequence/nonce-based replay detection (beyond the outlier-speed check already in place) —
  lower priority now that per-device credentials make blind replay/impersonation much harder.
- Admin JWT moved out of `localStorage` to httpOnly cookies (needs a CSRF token flow).
- Firebase RTDB security rules aren't version-controlled in this repo — verify them directly in
  the Firebase console; the backend's use of the Admin SDK bypasses rules by design, so this
  matters only if any client ever reads/writes RTDB directly.

## Fixed since the last update

- Socket.IO flood protection: `attendant_live_location` is now capped at 20 events/10s per
  socket connection ([sockets/attendantLiveGpsSocket.js](Backend/Admin_Backend/sockets/attendantLiveGpsSocket.js)).
- BusAttendant_Backend's 14 proxy error handlers no longer echo `ADMIN_BACKEND_URL` or the raw
  exception message to the client — logged server-side via `console.error`, client gets a generic
  `"Admin backend unavailable"` plus a non-sensitive route label. Boot-tested after the change.
- Per-device LILYGO credential system (see GPS security section above) — done and live-tested.
- Flutter attendant token storage migrated from `shared_preferences` to `flutter_secure_storage`
  (Keychain on iOS, Keystore on Android, Credential Manager on Windows) — see below.
- `firebase-admin` major-version upgrade is still open — see below for why it was deferred.

### Flutter secure storage — done
`BusAttendant_Frontend/lib/services/session_store.dart` previously stored the attendant's
JWT/ticketing token via `shared_preferences` (plain unencrypted on-device storage). Migrated to
`flutter_secure_storage` (added to `pubspec.yaml`), with the exact same public API
(`saveSession`/`clear`/`getToken`/`getDisplayName`/`getTicketingToken`) so none of its three call
sites (`login_screen.dart`, `main_shell.dart`, `main.dart`) needed to change. Includes a one-time
migration guard: if an existing session is found in the old `shared_preferences` location, it's
copied into secure storage and the plaintext copy deleted, so anyone already signed in isn't
silently logged out by this update. Verified with `flutter pub get` (resolved clean) and `flutter
analyze` across the whole project (0 errors — only 26 pre-existing style-lint infos unrelated to
this file). Not exercised in a live login flow (no running emulator/device session in this pass);
worth a manual sign-in/sign-out check on a real device before shipping.

### `firebase-admin` dependency upgrade — deferred, needs a real ID token to verify
The remaining 12 dependency advisories all trace to one moderate-severity `uuid` advisory
("missing buffer bounds check in v3/v5/v6 when a buffer is provided", CVE range `<11.1.1`),
pinned deep inside `firebase-admin`'s own dependency tree (via `@google-cloud/firestore`/
`google-gax`/`gaxios`/`node-cron`). **Practical exploitability here is low**: the bug only
triggers when calling code passes an attacker-controlled buffer/offset into `uuid.v3/v5/v6`
directly — none of these libraries' internal usage does that; they call it for plain internal ID
generation. Closing it anyway requires a major-version bump of `firebase-admin` itself, and that
package is what verifies every Google login server-side (`verifyFirebaseIdToken`) and drives the
RTDB twin-write. I can confirm the new major version still *initializes* without throwing, but
whether `admin.auth().verifyIdToken()` still validates a real Google-issued token the same way
can't be exercised here without a live browser Google sign-in producing a real ID token. Given the
low real-world exploitability and the risk of silently breaking every admin's login, this is left
as a documented, low-priority residual risk rather than forced through on a smoke test. Recommend
testing the upgrade against a real Google login in a dev browser session before merging.
