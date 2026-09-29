# LilyGO T-A7670E — cellular (SIM) HTTPS telemetry + SMS emergency fallback (field / on-bus)

Firmware uses **only the A7670E's own SIM/cellular radio** — no WiFi at all. This is the sketch meant to actually go on the bus; `lilygo_ta7670e_wifi_telemetry` (same board, same GNSS code) is for dev/testing on your LAN only, since a moving bus has no WiFi to join.

## GPS priority on this project

1. **Bus Attendant phone** (primary, separate app, 3s cadence) — `source: "staff"`
2. **This device over mobile-data/HTTPS** (backup, 5s cadence) — `source: "hardware"`
3. **This device over SMS** (emergency-only fallback, 15s cadence, active ONLY while mobile-data
   telemetry is confirmed failing) — `source: "hardware_sms"`

The backend's `gpsSourceArbiter.js` decides which source is actually "live" on the map; this
firmware's job is just to report faithfully via the best transport it can currently reach, and to
never send both mobile-data and SMS at the same time (they're two states of one state machine, so
that's structural, not just a rule).

## Firmware state machine

`SIM_CHECK → NETWORK_REGISTER → PDP_CONNECT → (first boot only) GNSS_START → GNSS_WAIT_FIX →
TELEMETRY_SEND ↔ TELEMETRY_SUCCESS / TELEMETRY_FAILED → SMS_FALLBACK (only after
`MOBILE_FAIL_CONFIRM_COUNT` consecutive HTTPS failures — not the first one) → back to
`PDP_CONNECT`/`TELEMETRY_SEND` once mobile data recovers, checked periodically in the background
without interrupting the SMS cadence`. GNSS acquisition itself is an always-on background poll,
independent of this connectivity state machine, once past the one-time boot gate.

Every important AT operation classifies its failure into a specific reason (`GNSS_UNAVAILABLE`,
`SIM_UNAVAILABLE`, `CELL_UNAVAILABLE`, `PDP_UNAVAILABLE`, `HTTPS_FAILED`, `BACKEND_UNAVAILABLE`,
`SMS_FAILED`) rather than one generic error — see the `[fw][ERROR][...]` log lines.

## Why a separate sketch from the WiFi version

GNSS (getting a lat/lon) and networking (sending it somewhere) are independent. This sketch keeps the exact same power-on sequence and `AT+CGNSSINFO` parser already verified on this board (see that sketch's `parseCgnssinfo()` comment for how the field layout was confirmed), and swaps WiFi+`HTTPClient` for the modem's own cellular data connection and HTTPS stack.

**HTTPS specifically needs the modem's native AT+HTTP\* command set, not TinyGSM** — TinyGSM's SIM7600 driver (the same class this chip's AT dialect is compatible with) has no SSL support at all (`"SSL not yet supported on this module!"` in its own source). So this sketch talks raw AT commands to the modem's built-in HTTP(S) engine instead; the modem does the TLS handshake itself, the ESP32 never touches the certificate.

## ⚠️ Verify before trusting on the bus

The `AT+CSSLCFG`/`AT+HTTPPARA`/`AT+HTTPACTION` sequence in `httpsPostTelemetry()` is synthesized from SIMCom's documented HTTP(S) AT command set plus a real practitioner report of it working on this exact chip — it has **not** been confirmed against the primary AT command manual for your specific firmware build. Before relying on it in the field:

1. Set `DEBUG_AT_PASSTHROUGH 1` in `config.h`, flash, open Serial at 115200.
2. By hand, run: `AT+CGDCONT=1,"IP","internet"` → `AT+CGACT=1,1` → the `AT+CSSLCFG`/`AT+HTTPINIT`/`AT+HTTPPARA`/`AT+HTTPACTION` sequence from the `.ino`, one line at a time, watching each raw reply.
3. Fix anything that errors, mirror the fix back into `httpsPostTelemetry()`, set `DEBUG_AT_PASSTHROUGH` back to `0`.

This is the same technique that caught the `AT+CGNSSINFO` field-index bug on this board — trust the live modem reply over any manual (including this one).

## Behaviour

1. **Cellular** — `AT+CGDCONT`/`AT+CGACT` (standard 3GPP PDP attach) using `CELL_APN`, one attempt per state-machine tick (see above).
2. **Modem** — `ATE0`, `AT+CGNSSPWR=1`, then polls `AT+CGNSSINFO` in the background every `GNSS_POLL_INTERVAL_MS`.
3. **Healthy fix** — same lat/lon/N-S/E-W/speed parser verified on this board; heading/course (field index 13) is a new, unverified extraction — bench-check it. Sends only when `satellites >= GPS_MIN_SATS`; never fabricates coordinates when there's no fix.
4. **POST** — JSON: `imei`, `deviceId`, `lat`, `lng`, `speedKph`, `heading`, `net: "cellular"`, `signal_strength` (from `AT+CSQ`), `voltage: null` (no verified battery-ADC pin on this board), `recordedAt` (GNSS-derived UTC timestamp when available), `source: "hardware"`, `transport: "cellular"`. Auth headers `x-device-id`/`x-device-key` (preferred, per-device credential) or legacy `x-device-secret`, via `AT+HTTPPARA="USERDATA",...`.
5. **HTTPS** — Prints `HTTP response code:` to Serial (expect 204). `SSL_VERIFY_SERVER_CERT` (default 0) trades certificate identity-checking for simplicity — see the comment in `config.h.example`; the device credential is the real per-request auth regardless.
6. **Local buffering** — a fix that fails to send is pushed into a small ring buffer (`TELEMETRY_BUFFER_SIZE`, default 20) with its true GNSS-derived timestamp; the buffer is flushed oldest-first, one send at a time, as soon as HTTPS telemetry succeeds again (including right after returning from SMS fallback).
7. **SMS fallback** — only entered after `MOBILE_FAIL_CONFIRM_COUNT` (default 2) *consecutive* HTTPS failures, not the first one. Sends `BTGPS|<BUS_ID_LABEL>|<lat>|<lon>|<speedKph>|<heading>|<timestamp>` to `SMS_GATEWAY_NUMBER` every `SMS_INTERVAL_MS` (default 15000ms) via `AT+CMGF=1`→`AT+CMGS`→Ctrl+Z. Rechecks mobile-data in the background every `SMS_PDP_RECHECK_MS` without interrupting the SMS cadence; returns to HTTPS telemetry automatically the moment mobile data is confirmed back. See the file header for the `AT+CMGF=1` GitHub-#247 risk and how this sketch degrades gracefully if your firmware doesn't support it.
8. **Cadence** — `POST_INTERVAL_MS` (default 5000ms) for HTTPS telemetry; `SMS_INTERVAL_MS` (default 15000ms) for SMS fallback; the two are mutually exclusive states of one state machine, never both active for the same cycle.

## Backend

Same endpoint as the WiFi sketch: `POST /api/buses/hardware-telemetry`, success = `204`. `SERVER_HOST` must be **publicly reachable** (not a LAN IP) — see [`deploy/raspberry-pi/README.md`](../../deploy/raspberry-pi/README.md) for standing up Admin_Backend on a Raspberry Pi with a stable public HTTPS address via Tailscale Funnel. SMS fallback goes to a completely separate destination — see [`../lilygo_ta7670e_sms_gateway/README.md`](../lilygo_ta7670e_sms_gateway/README.md) for the dedicated receiving gateway, not Admin_Backend directly.

## Setup

1. Copy `config.h.example` → `config.h` — set `CELL_APN` for your SIM's carrier, `SERVER_HOST` to your Pi's Tailscale Funnel address.
2. Register this unit via `POST /api/fleet/devices { deviceId, busId, label }` on the Admin backend (admin-JWT gated) — copy the returned plaintext secret into `DEVICE_ID`/`DEVICE_KEY` in `config.h` **now**, it is never shown again. (Legacy fallback: set `DEVICE_INGEST_SECRET` to match the server's `.env` instead, if you're not ready to migrate this unit to a per-device credential yet.)
3. Set `BUS_ID_LABEL` to this bus's human-readable id (must match the `busId` the device is registered to) and `SMS_GATEWAY_NUMBER` to the receiving gateway's SIM number — see [`../lilygo_ta7670e_sms_gateway/README.md`](../lilygo_ta7670e_sms_gateway/README.md). Also register this unit's OWN SIM number against its `IngestDevice` row via `PATCH /api/fleet/devices/:deviceId { smsSenderNumber }` so the gateway's validation allowlist accepts its SMS.
4. Arduino Library Manager: **ArduinoJson** (v6+). No TinyGSM needed (raw AT only).
5. Board: ESP32 (your LilyGO T-A7670E variant).
6. Insert the SIM, confirm it has an active mobile data plan **and SMS capability**, and no PIN lock.
7. Open Serial 115200 — confirm IMEI, then `SIM_CHECK`/`NETWORK_REGISTER`/`PDP_CONNECT` progress, then `HTTP response code: 204`.

## Physical install (on the bus)

- **GNSS antenna** needs real sky view — behind the windshield/dash, not inside a metal enclosure.
- **Power** from the bus's 12V/24V line through a proper buck converter to clean, stable 5V — not USB.
- Mount the board somewhere protected from vibration and heat.
- Bench-test the full path (real SIM, real `SERVER_HOST`) before installing — confirm registration, a GPS fix outdoors, a successful POST, AND (separately) that `AT+CMGF=1` actually returns OK on your unit before relying on SMS fallback in the field.
