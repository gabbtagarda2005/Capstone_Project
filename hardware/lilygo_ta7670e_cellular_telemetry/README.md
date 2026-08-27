# LilyGO T-A7670E — cellular (SIM) HTTPS telemetry (field / on-bus)

Firmware uses **only the A7670E's own SIM/cellular radio** — no WiFi at all. This is the sketch meant to actually go on the bus; `lilygo_ta7670e_wifi_telemetry` (same board, same GNSS code) is for dev/testing on your LAN only, since a moving bus has no WiFi to join.

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

1. **Cellular** — `AT+CGDCONT`/`AT+CGATT`/`AT+CGACT` (standard 3GPP PDP attach) using `CELL_APN`.
2. **Modem** — `ATE0`, `AT+CGNSSPWR=1`, then polls `AT+CGNSSINFO`.
3. **Healthy fix** — same parser as the WiFi sketch; sends only when `satellites >= GPS_MIN_SATS`.
4. **POST** — JSON: `imei`, `lat`, `lng`, `speedKph`, `net: "cellular"`. Header `x-device-secret` via `AT+HTTPPARA="USERDATA",...` if `DEVICE_INGEST_SECRET` is set (must match Admin `.env`).
5. **HTTPS** — Prints `HTTP response code:` to Serial (expect 204). `SSL_VERIFY_SERVER_CERT` (default 0) trades certificate identity-checking for simplicity — see the comment in `config.h.example`; `DEVICE_INGEST_SECRET` is the real per-request auth regardless.
6. **Cadence** — waits `POST_INTERVAL_MS` after each attempt (no fix, no registration, or bad HTTP).

## Backend

Same endpoint as the WiFi sketch: `POST /api/buses/hardware-telemetry`, success = `204`. `SERVER_HOST` must be **publicly reachable** (not a LAN IP) — see [`deploy/raspberry-pi/README.md`](../../deploy/raspberry-pi/README.md) for standing up Admin_Backend on a Raspberry Pi with a stable public HTTPS address via Tailscale Funnel.

## Setup

1. Copy `config.h.example` → `config.h` — set `CELL_APN` for your SIM's carrier, `SERVER_HOST` to your Pi's Tailscale Funnel address, `DEVICE_INGEST_SECRET`.
2. Arduino Library Manager: **ArduinoJson** (v6+). No TinyGSM needed (raw AT only).
3. Board: ESP32 (your LilyGO T-A7670E variant).
4. Insert the SIM, confirm it has an active mobile data plan and no PIN lock.
5. Open Serial 115200 — confirm IMEI, then cellular registration, then `HTTP response code: 204`.

## Physical install (on the bus)

- **GNSS antenna** needs real sky view — behind the windshield/dash, not inside a metal enclosure.
- **Power** from the bus's 12V/24V line through a proper buck converter to clean, stable 5V — not USB.
- Mount the board somewhere protected from vibration and heat.
- Bench-test the full path (real SIM, real `SERVER_HOST`) before installing — confirm registration, a GPS fix outdoors, and a successful POST first.
