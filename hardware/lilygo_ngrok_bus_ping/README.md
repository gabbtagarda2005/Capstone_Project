# LilyGO → ngrok → Admin `/api/buses/ping`

This sketch sends **`{"busId":"…","lat":…,"lng":…}`** every **15 s** to your **Admin_Backend** so **MongoDB** + **Socket.io** update the live map (same pipeline as `/api/buses/hardware-telemetry` with `imei`).

## Backend (already in this repo)

- **`POST /api/buses/ping`** — `busId` **or** registered `imei`, plus **`latitude`/`longitude`** or **`lat`/`lng`**.
- **Auth (set in `Backend/Admin_Backend/.env`):**
  - `DEVICE_INGEST_SECRET` → header **`x-device-secret`**
  - `DEVICE_INGEST_API_KEY` → header **`x-api-key`** (or `x-ingest-api-key`)
  - If **both** are set, the board must send **both** headers.
- **Maintenance mode:** hardware paths stay allowed so buses keep reporting.

## ngrok + HTTPS

Public ngrok URLs are usually **`https://`**. ESP32 **`WiFiClientSecure`** can do TLS in software.

**Recommended dev setup (`USE_WIFI_FOR_HTTPS_UPLOAD 1`):**

1. Laptop runs **Admin_Backend** on **port 4001** and **ngrok** `http 4001`.
2. LilyGO joins the **same WiFi** (home or phone hotspot).
3. Modem still powers **GNSS**; **upload** goes over **WiFi → ngrok → laptop**.

Header **`ngrok-skip-browser-warning: true`** is sent so ngrok does not return the browser interstitial HTML to the device.

## Field-only GPRS (no WiFi)

Set **`USE_WIFI_FOR_HTTPS_UPLOAD 0`** and point **`SERVER_HOST` / `SERVER_PORT`** at an endpoint that speaks **plain HTTP on port 80** (e.g. a VPS reverse proxy, or port-forwarded public IP). **HTTPS on port 443 over GPRS** needs extra modem SSL setup and is not included here.

## Config

1. Copy **`config.h.example` → `config.h`**.
2. Set **`BUS_ID`** to a bus that exists in **Fleet**.
3. Set **`SERVER_HOST`** to your ngrok host (no `https://`).
4. Fill **`WIFI_SSID` / `WIFI_PASS`** when using WiFi upload.
5. Set **`DEVICE_API_KEY` / `DEVICE_SECRET`** to match `.env` (or leave `""` only on a trusted LAN).

## Libraries

- **TinyGSM**
- **ArduinoJson** v6+
- Board: **ESP32** (LilyGO T-SIM7600 / similar)

## SIM800

SIM800 GNSS AT commands differ; this sketch targets **SIM7600 / SIM7000-class** `+CGNSINF`. For SIM800-only boards, use a SIM800 GNSS example or IMEI-based **`/api/hardware-telemetry`** sketch under `../lilygo_gps_telemetry/`.
