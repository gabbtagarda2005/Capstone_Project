# LilyGO automatic GPS telemetry (firmware)

This sketch runs on **ESP32 + cellular modem** boards (e.g. LilyGO T-SIM7000G). It implements the “automatic” behavior entirely in **C++**:

1. **Boot** — UART to modem, restart, read **IMEI** (`AT+CGSN`).
2. **GNSS** — Power GNSS (`AT+CGNSPWR=1`), poll **`AT+CGNSINF`** until a valid fix (lat/lon).
3. **Upload** — either:
   - **GPRS + HTTP** (`USE_WIFI_FOR_HTTPS_UPLOAD` **0**) — attach **APN**, then `POST` to your server on port **80** (typical), or  
   - **WiFi + HTTPS** (`USE_WIFI_FOR_HTTPS_UPLOAD` **1**) — ESP32 joins Wi‑Fi and uses **TLS** (typical for **ngrok** `https://…` tunnels); modem is used for GNSS only.
4. **Body** — `POST` JSON to **`/api/hardware-telemetry`** with **`imei`**, **`lat`**, **`lng`**, optional **`signal_strength`**, **`net`** (`4g` or `wifi`).
5. **Auth headers** (must match `Backend/Admin_Backend/.env`):
   - **`x-device-secret`** when `DEVICE_INGEST_SECRET` is set.
   - **`x-api-key`** when `DEVICE_INGEST_API_KEY` is set.  
   If **both** env vars are set, the device must send **both** headers (`DEVICE_INGEST_SECRET` + `DEVICE_API_KEY` in `config.h`).
6. **Self-healing** — On network/GPRS/HTTP failure, disconnect GPRS when applicable and back off (doubles `POST_INTERVAL_MS` per consecutive failure, capped at 60 s) before retry; a missing GNSS fix just retries at the normal cadence instead. Any successful POST resets the backoff.
7. **LILYGO is the backup GPS source** — the attendant phone is primary (~3 s cadence via the app). Default `POST_INTERVAL_MS` is **8 s**, matching the phone-primary/LILYGO-backup failover in `Backend/Admin_Backend/config/gpsThresholds.js`.

## WiFi vs GNSS vs cellular (accuracy)

- **Position** comes from the modem’s **GNSS** — not from which Wi‑Fi network you use for upload.
- **Cellular** (when using GPRS upload) is only for TCP; **WiFi mode** uses phone/hotspot only for HTTPS.
- Clear sky + antenna: first fix often **30–60+ s** after power-on (`GPS_WARMUP_MS`).
- Wrong position by ~km: try **`GNSS_COORDS_DDMM_FORMAT`** `0` vs `1`. Keep **`GPS_CAL_*_OFFSET` at `0`** unless you calibrated at a known point.

## Admin backend checklist (why the map might stay empty)

1. **Fleet** — In **Management → Fleet**, edit the bus and set **IMEI** to the **15-digit** value shown in Serial Monitor (`[modem] IMEI …`). It must match the modem exactly.
2. **Bus status** — Bus must **not** be **Inactive** (`/api/buses/live` drops inactive buses).
3. **Live map toggle** — Portal setting **operations deck live** (if disabled, live API returns no pins).
4. **Secrets** — `DEVICE_INGEST_SECRET` / `DEVICE_INGEST_API_KEY` in `.env` must match `config.h` on the device (both headers if both are set).
5. **URL** — `SERVER_HOST` / `SERVER_PORT` / `SERVER_PATH` must hit **Admin_Backend** (not the Vite dev server). For ngrok: host **without** `https://`, port **443**, `USE_WIFI_FOR_HTTPS_UPLOAD 1`, and WiFi credentials filled in.

## API contract

Matches `Backend/Admin_Backend/server.js` and `routes/buses.js`:

- **URL:** `POST /api/hardware-telemetry` (default `SERVER_PATH`).
- **Body:** `{ "imei": "15digits", "lat": …, "lng": …, "net": "4g"|"wifi", … }`
- **Responses:** **204** on success; **401** = bad/missing ingest headers; **404** = IMEI not registered on any bus.

## Setup

1. Copy `config.h.example` → **`config.h`** and set **APN**, **server**, **secrets**, **WiFi** (if using HTTPS upload), and UART pins if your board differs.
2. Arduino **Library Manager**: **TinyGSM**, **ArduinoJson** (v6+).
3. Board: **ESP32** variant for your LilyGO. Upload `lilygo_gps_telemetry.ino`.
4. Serial Monitor **115200** baud — confirm IMEI, fix, then `[post] server accepted` or `[https] server accepted`.

## ngrok quick profile

```c
#define USE_WIFI_FOR_HTTPS_UPLOAD 1
#define SERVER_HOST "abcd-12-34-56-78.ngrok-free.app"
#define SERVER_PORT 443
#define SERVER_PATH "/api/hardware-telemetry"
#define WIFI_SSID "…"
#define WIFI_PASS "…"
#define DEVICE_INGEST_SECRET "same-as-.env"
#define DEVICE_API_KEY "same-as-.env-if-set"
```

## Modem type

In `config.h`, set **`TINY_GSM_MODEM_SIM7000`** (or **SIM7600**, etc.) to match your module. GNSS uses **SIM7000-class** `AT+CGNSINF`.

## Pins

Defaults **RX 27 / TX 26** — confirm on your schematic.

## Alternative: bus id instead of IMEI

If you prefer **`busId`** in JSON and **`/api/buses/ping`**, use the companion sketch **`hardware/lilygo_ngrok_bus_ping`** (WiFi + HTTPS or GPRS HTTP).
