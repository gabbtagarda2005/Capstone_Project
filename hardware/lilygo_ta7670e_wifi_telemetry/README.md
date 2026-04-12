# LilyGO T-A7670E — Wi-Fi telemetry (local Admin API)

Firmware uses **ESP32 Wi-Fi** for HTTP and the **A7670E modem UART** only for **AT+CGSN** (IMEI) and **AT+CGNSSINFO** (GNSS). This matches local development against `http://YOUR_PC_IP:PORT/api/buses/hardware-telemetry`.

## Behaviour

1. **Wi-Fi** — Connects with `WiFi.h`; reconnects automatically if the link drops (loop never gives up).
2. **Modem** — `ATE0`, `AT+CGNSSPWR=1`, then polls **`AT+CGNSSINFO`**.
3. **Healthy fix** — Parses a **SIM7670-style** `+CGNSSINFO:` CSV (see sketch). Sends only when **`satellites >= GPS_MIN_SATS`** (default **3** in `config.h.example`).
4. **POST** — JSON: `imei`, `lat`, `lng`, `speedKph`, `net: "wifi"`. Header **`x-device-secret`** if set in `config.h` (must match `DEVICE_INGEST_SECRET` in Admin `.env`).
5. **HTTP** — Prints **`HTTP response code:`** to Serial (expect **204** from this backend; 200/201 also treated as success). Any other code → wait **`POST_INTERVAL_MS`** (default 5 s) and retry.
6. **Cadence** — Waits **`POST_INTERVAL_MS`** after each attempt (no fix, Wi-Fi down, or bad HTTP).

## Backend

- Path: **`POST /api/buses/hardware-telemetry`** (same ingest as `/api/hardware-telemetry` on the root app).
- Success: **`204 No Content`** (empty body).
- Register the **15-digit IMEI** on the bus in Fleet — must match exactly.

Set **`SERVER_PORT`** to your Node port (e.g. **4001** if Admin runs on 4001, or **5000** if you proxy that way).

## Setup

1. Copy **`config.h.example`** → **`config.h`** — Wi-Fi, IP, port, path, secret, modem UART pins.
2. Arduino Library Manager: **ArduinoJson** (v6+).
3. Board: **ESP32** (your LilyGO variant).
4. Open Serial **115200** — confirm IMEI line, then **`HTTP response code: 204`** when the server accepts the packet.

## GNSS CSV layout

The parser assumes fields like: **mode, satellite_count, lat, N/S, lon, E/W, …, speed …**  
If your modem prints a different `+CGNSSINFO` layout, open Serial, copy one line, and adjust **`parseCgnssinfo()`** / **`GNSS_SPEED_FIELD_INDEX`** in `config.h`.

## Location accuracy

- **Module GNSS** is often **~3–15 m** in good sky view (not survey-grade). Indoors, under metal, or with a weak antenna, error can be **much** larger.
- **`GPS_SMOOTH_SAMPLES`** (default **4**) — Running average of the last N fixes before each POST. Cuts random jitter; slightly lags sharp turns. Set **`1`** to disable.
- **`GPS_MIN_SATS`** — Higher (e.g. **5–6**) can improve geometry when the sky is open; lower (e.g. **3**) if you rarely get a fix.
- **`GNSS_ENABLE_MULTI_CONSTELLATION`** — Sends **`AT+CGNSSMODE=3`** after power-on (GPS+GLONASS+Galileo+BDS on many SIM7670 builds). Set **`0`** if your modem returns **ERROR** for that command.
- **Wrong format** — Set **`GNSS_COORDS_DDMM_FORMAT`** to **`1`** if the pin is **km** off (DDMM vs decimal).
- **Compare** — Serial prints **raw** and **smooth** lat/lon (7 decimals). Check against **Google Maps** at the same spot.
- **PowerShell tests** with fixed `lat`/`lng` only prove the API, not live GPS accuracy.

## LAN / Windows

Allow inbound TCP on your chosen port in **Windows Firewall** when the LilyGO posts to your PC’s IP. Use a **Private** Wi-Fi profile for discovery. The phone hotspot and PC must be on the same subnet as **`SERVER_HOST`**.

## Power / RF

Use a stable **5 V** supply for TX bursts; place the **GPS antenna** with sky view; disable SIM **PIN** lock.
