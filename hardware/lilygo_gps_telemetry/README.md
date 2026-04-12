# LilyGO automatic GPS telemetry (firmware)

This sketch runs on **ESP32 + cellular modem** boards (e.g. LilyGO T-SIM7000G). It implements the “automatic” behavior entirely in **C++**:

1. **Boot** — UART to modem, restart, read **IMEI** (`AT+CGSN`).
2. **GNSS** — Power GNSS (`AT+CGNSPWR=1`), poll **`AT+CGNSINF`** until a valid fix (lat/lon).
3. **Data** — Attach **GPRS** with your carrier **APN**.
4. **Upload** — `POST` JSON to **`/api/hardware-telemetry`** with **`imei`**, **`lat`**, **`lng`**, optional **`signal_strength`**, header **`x-device-secret`** if your Admin backend uses `DEVICE_INGEST_SECRET`.
5. **Self-healing** — On network or HTTP failure, disconnect GPRS as needed and **wait `POST_INTERVAL_MS` (default 5 s)** before retrying the whole loop.

## Admin backend contract

Matches `Backend/Admin_Backend/server.js`:

- **URL:** `http://YOUR_HOST:PORT/api/hardware-telemetry` (this sketch uses **plain HTTP** on port **80** for simplicity).
- **Body:** `{ "imei": "15digits", "lat": …, "lng": …, "net": "4g", … }`
- **Header:** `x-device-secret: …` when `DEVICE_INGEST_SECRET` is set in `.env`.

Register the modem **IMEI** on the bus document in Fleet (`Bus.imei`) so the server can resolve `busId`.

**HTTPS:** Many LTE modules need extra SSL setup for `https://`. Common options: reverse proxy with HTTP on a private link, VPN, or extend this sketch using TinyGsm SSL examples and port **443**.

## Setup

1. Copy `config.h.example` → **`config.h`** and set `CELL_APN`, `SERVER_HOST`, `SERVER_PORT`, `SERVER_PATH`, `DEVICE_INGEST_SECRET`, and UART pins if your board differs.
2. Arduino IDE **Library Manager**: install **TinyGSM** (Volodymyr Shymanskyy) and **ArduinoJson** (v6+).
3. Board: **ESP32 Dev Module** (or your exact LilyGO board). Upload `lilygo_gps_telemetry.ino`.
4. Open Serial Monitor at **115200** baud for logs.

## Modem type

In `config.h`, set **`#define TINY_GSM_MODEM_SIM7000`** (or `SIM7600`, `SIM800`, etc.) to match **TinyGsm** documentation. GNSS commands target **SIM7000-class** `AT+CGNSINF`; other modules may need different AT commands for GPS.

## Pins

Defaults assume **RX 27 / TX 26** for the modem UART — **confirm against your LilyGO schematic** (some boards swap or use different GPIOs).
