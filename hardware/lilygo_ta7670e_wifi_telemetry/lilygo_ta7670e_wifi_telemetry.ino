/**
 * LilyGO T-A7670E — Wi-Fi HTTP telemetry for Admin_Backend (local dev / LAN).
 *
 * - WiFi.h connects to your AP; HTTP POST to /api/buses/hardware-telemetry
 * - IMEI from modem AT+CGSN (15 digits) → JSON "imei"
 * - GNSS from AT+CGNSSINFO (SIM7670-class layout); POST only if fix + satellites >= GPS_MIN_SATS
 * - Retries every POST_INTERVAL_MS on GNSS miss, WiFi loss, or HTTP not 2xx/204
 *
 * Copy config.h.example → config.h
 * Libraries: ArduinoJson (v6+)
 *
 * Backend success: HTTP 204 (or 200/201). Match DEVICE_INGEST_SECRET to .env
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <math.h>

#include "config.h"

#ifndef DEBUG_WIFI_ONLY_POST
#define DEBUG_WIFI_ONLY_POST 0
#endif
#ifndef GNSS_RAW_DEBUG
#define GNSS_RAW_DEBUG 1
#endif

#ifndef GPS_MIN_SATS
#define GPS_MIN_SATS 4
#endif

#ifndef POST_INTERVAL_MS
#define POST_INTERVAL_MS 5000
#endif
#ifndef GNSS_SPEED_FIELD_INDEX
#define GNSS_SPEED_FIELD_INDEX 7
#endif
#ifndef GNSS_COORDS_DDMM_FORMAT
#define GNSS_COORDS_DDMM_FORMAT 0
#endif
#ifndef GPS_SMOOTH_SAMPLES
#define GPS_SMOOTH_SAMPLES 3
#endif
#ifndef GPS_SMOOTH_MAX
#define GPS_SMOOTH_MAX 8
#endif
#ifndef GNSS_ENABLE_MULTI_CONSTELLATION
#define GNSS_ENABLE_MULTI_CONSTELLATION 0
#endif

HardwareSerial ModemSerial(1);

static double gSmoothLat[GPS_SMOOTH_MAX];
static double gSmoothLon[GPS_SMOOTH_MAX];
static int gSmoothCount = 0;

static void smoothReset() {
  gSmoothCount = 0;
}

static void smoothPush(double la, double lo) {
  int cap = GPS_SMOOTH_SAMPLES;
  if (cap < 1) {
    cap = 1;
  }
  if (cap > GPS_SMOOTH_MAX) {
    cap = GPS_SMOOTH_MAX;
  }
  if (gSmoothCount < cap) {
    gSmoothLat[gSmoothCount] = la;
    gSmoothLon[gSmoothCount] = lo;
    gSmoothCount++;
  } else {
    for (int i = 0; i < cap - 1; i++) {
      gSmoothLat[i] = gSmoothLat[i + 1];
      gSmoothLon[i] = gSmoothLon[i + 1];
    }
    gSmoothLat[cap - 1] = la;
    gSmoothLon[cap - 1] = lo;
  }
}

static bool smoothAvg(double &la, double &lo) {
  if (gSmoothCount == 0) {
    return false;
  }
  double sl = 0.0;
  double so = 0.0;
  for (int i = 0; i < gSmoothCount; i++) {
    sl += gSmoothLat[i];
    so += gSmoothLon[i];
  }
  la = sl / (double)gSmoothCount;
  lo = so / (double)gSmoothCount;
  return true;
}

static String imeiCached;

static void dbg(const char *msg) {
  Serial.println(msg);
}

static void modemFlush() {
  while (ModemSerial.available()) {
    ModemSerial.read();
  }
}

/** Read modem output until OK / ERROR / timeout. */
static String modemExchange(const char *cmd, uint32_t timeoutMs) {
  modemFlush();
  ModemSerial.println(cmd);
  delay(30);
  String acc;
  const uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    while (ModemSerial.available()) {
      char c = ModemSerial.read();
      acc += c;
      if (acc.length() > 900) {
        acc.remove(0, 300);
      }
    }
    if (acc.indexOf("\r\nOK") >= 0 || acc.indexOf("\nOK") >= 0) {
      break;
    }
    if (acc.indexOf("ERROR") >= 0) {
      break;
    }
    delay(5);
  }
  return acc;
}

static bool extractImei15(String &out) {
  String r = modemExchange("AT+CGSN", 3000);
  out = "";
  for (int i = 0; i <= (int)r.length() - 15; i++) {
    bool ok = true;
    for (int j = 0; j < 15; j++) {
      char c = r.charAt(i + j);
      if (c < '0' || c > '9') {
        ok = false;
        break;
      }
    }
    if (ok) {
      out = r.substring(i, i + 15);
      return true;
    }
  }
  return false;
}

static int splitCsv(const String &data, String *parts, int maxParts) {
  int idx = 0;
  int start = 0;
  for (int i = 0; i < (int)data.length() && idx < maxParts; i++) {
    if (data.charAt(i) == ',') {
      parts[idx++] = data.substring(start, i);
      start = i + 1;
    }
  }
  if (start < (int)data.length() && idx < maxParts) {
    parts[idx++] = data.substring(start);
  }
  for (int i = 0; i < idx; i++) {
    parts[i].trim();
  }
  return idx;
}

/** NMEA-style DDMM.MMMM or DDDMM.MMMM → decimal degrees (SIMCom-style GNSS fields). */
static double dmToDecimalDegrees(double dm) {
  double a = fabs(dm);
  int deg = (int)(a / 100.0);
  double min = a - (double)deg * 100.0;
  if (deg < 0 || deg > 180 || min < 0.0 || min >= 60.0) {
    return dm;
  }
  double dec = (double)deg + min / 60.0;
  return dm < 0.0 ? -dec : dec;
}

/**
 * Typical SIM7670 / A7670: +CGNSSINFO: <mode>,<sats>,<lat>,<NS>,<lon>,<EW>,<alt>,<speed>,...
 * If your modem prints a different layout, adjust indices in config or parsing below.
 */
static bool parseCgnssinfo(const String &resp, double &lat, double &lon, float &speedKph, int &sats) {
  int p = resp.indexOf("+CGNSSINFO:");
  if (p < 0) {
    return false;
  }
  int lineEnd = resp.indexOf('\n', p);
  String line = lineEnd > p ? resp.substring(p, lineEnd) : resp.substring(p);
  line.trim();

  int colon = line.indexOf(':');
  if (colon < 0) {
    return false;
  }
  String payload = line.substring(colon + 1);
  payload.trim();

  String parts[20];
  int n = splitCsv(payload, parts, 20);
  if (n < 8) {
    return false;
  }

  sats = parts[1].toInt();
  if (sats < GPS_MIN_SATS) {
    return false;
  }

  double latv = parts[2].toDouble();
  double lonv = parts[4].toDouble();
#if GNSS_COORDS_DDMM_FORMAT
  latv = dmToDecimalDegrees(latv);
  lonv = dmToDecimalDegrees(lonv);
#endif
  String ns = parts[3];
  String ew = parts[5];
  ns.toUpperCase();
  ew.toUpperCase();

  if (ns == "S") {
    latv = -fabs(latv);
  } else if (ns == "N") {
    latv = fabs(latv);
  } else {
    return false;
  }
  if (ew == "W") {
    lonv = -fabs(lonv);
  } else if (ew == "E") {
    lonv = fabs(lonv);
  } else {
    return false;
  }

  if (latv < -90.0 || latv > 90.0 || lonv < -180.0 || lonv > 180.0) {
    return false;
  }
  if (fabs(latv) < 1e-5 && fabs(lonv) < 1e-5) {
    return false;
  }

  lat = latv;
  lon = lonv;

  float spd = 0.0f;
  if (n > GNSS_SPEED_FIELD_INDEX) {
    spd = parts[GNSS_SPEED_FIELD_INDEX].toFloat();
  }
#if GNSS_SPEED_FIELD_IS_MPS
  speedKph = spd * 3.6f;
#else
  speedKph = spd;
#endif
  if (speedKph < 0.0f) {
    speedKph = 0.0f;
  }
  return true;
}

static bool gnssPowerOn() {
  String r = modemExchange("AT+CGNSSPWR=1", 5000);
  return r.indexOf("OK") >= 0 || r.indexOf("ok") >= 0;
}

static bool readGnssFix(double &lat, double &lon, float &speedKph, int &sats) {
  String r = modemExchange("AT+CGNSSINFO", 4000);
  if (parseCgnssinfo(r, lat, lon, speedKph, sats)) {
    return true;
  }
#if GNSS_RAW_DEBUG
  Serial.println(F("[gps] parse failed — raw modem reply (check CSV layout vs parseCgnssinfo):"));
  Serial.println(r);
  Serial.println();
#endif
  return false;
}

static bool wifiEnsure() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  dbg("[wifi] connecting…");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 60000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    dbg("[wifi] failed — will retry");
    return false;
  }
  Serial.print("[wifi] IP ");
  Serial.println(WiFi.localIP());
  return true;
}

static bool httpPostTelemetry(double lat, double lon, float speedKph) {
  if (imeiCached.length() != 15) {
    return false;
  }

  StaticJsonDocument<384> doc;
  doc["imei"] = imeiCached;
  doc["lat"] = round(lat * 1.0e7) / 1.0e7;
  doc["lng"] = round(lon * 1.0e7) / 1.0e7;
  doc["speedKph"] = speedKph;
  doc["net"] = "wifi";

  String payload;
  payload.reserve(320);
  if (serializeJson(doc, payload) == 0) {
    return false;
  }

  String url = String("http://") + SERVER_HOST + ":" + String(SERVER_PORT) + SERVER_PATH;
  Serial.print(F("[http] POST "));
  Serial.println(url);

  HTTPClient http;
  http.setTimeout(20000);
  if (!http.begin(url)) {
    dbg("[http] begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  {
    const char *sec = DEVICE_INGEST_SECRET;
    if (sec != nullptr && sec[0] != '\0') {
      http.addHeader("x-device-secret", sec);
    }
  }

  int code = http.POST(payload);
  Serial.print(F("HTTP response code: "));
  Serial.println(code);
  if (code > 0) {
    String resp = http.getString();
    if (resp.length() > 0) {
      Serial.print(F("[http] body: "));
      Serial.println(resp);
    }
    if (code == 401) {
      dbg("[hint] 401 = x-device-secret mismatch or DEVICE_INGEST_SECRET set on server but not in config.h");
    }
    if (code == 404) {
      dbg("[hint] 404 = IMEI not in Fleet — add this IMEI to the bus in Admin");
    }
    if (code == 400) {
      dbg("[hint] 400 = missing lat/lng or imei in JSON");
    }
  } else {
    Serial.print(F("[http] request failed: "));
    Serial.println(http.errorToString(code));
    dbg("[hint] -1 = no TCP (wrong IP/port, firewall, or server not running)");
  }
  http.end();

  return code == 200 || code == 201 || code == 204;
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  dbg("");
  dbg("=== LilyGO T-A7670E Wi-Fi telemetry ===");

  ModemSerial.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(800);
  modemExchange("AT", 800);
  modemExchange("ATE0", 800);

  if (!extractImei15(imeiCached)) {
    dbg("[fatal] Could not read 15-digit IMEI (AT+CGSN). Check UART pins.");
  } else {
    Serial.print("[modem] IMEI ");
    Serial.println(imeiCached);
  }

  if (!gnssPowerOn()) {
    dbg("[gps] CGNSSPWR may have failed — still trying reads.");
  }
#if GNSS_ENABLE_MULTI_CONSTELLATION
  dbg("[gps] GNSS multi-constellation (AT+CGNSSMODE=3)…");
  modemExchange("AT+CGNSSMODE=3", 3000);
#endif
  delay(GNSS_WARMUP_MS);

  dbg("[loop] POST interval (ms): ");
  Serial.println(POST_INTERVAL_MS);
}

void loop() {
  if (imeiCached.length() != 15) {
    delay(POST_INTERVAL_MS);
    return;
  }

  if (!wifiEnsure()) {
    delay(POST_INTERVAL_MS);
    return;
  }

  double lat = 0.0;
  double lon = 0.0;
  float speedKph = 0.0f;
  int sats = 0;
  double outLat = 0.0;
  double outLon = 0.0;

#if DEBUG_WIFI_ONLY_POST
  lat = TEST_LAT;
  lon = TEST_LON;
  speedKph = 0.0f;
  sats = 99;
  outLat = lat;
  outLon = lon;
  Serial.println(F("[debug] DEBUG_WIFI_ONLY_POST — skipping GNSS, using TEST_LAT/TEST_LON"));
#else
  if (!readGnssFix(lat, lon, speedKph, sats)) {
    smoothReset();
    Serial.print(F("[gps] waiting for fix (need >= "));
    Serial.print(GPS_MIN_SATS);
    Serial.println(F(" sats) — go outside / lower GPS_MIN_SATS in config.h / enable DEBUG_WIFI_ONLY_POST"));
    delay(POST_INTERVAL_MS);
    return;
  }

  smoothPush(lat, lon);
  outLat = lat;
  outLon = lon;
  if (!smoothAvg(outLat, outLon)) {
    outLat = lat;
    outLon = lon;
  }

  Serial.print(F("[gps] raw sats="));
  Serial.print(sats);
  Serial.print(F(" lat="));
  Serial.print(lat, 7);
  Serial.print(F(" lon="));
  Serial.print(lon, 7);
  Serial.print(F(" | smooth("));
  Serial.print(GPS_SMOOTH_SAMPLES);
  Serial.print(F(") lat="));
  Serial.print(outLat, 7);
  Serial.print(F(" lon="));
  Serial.println(outLon, 7);
#endif

  if (!httpPostTelemetry(outLat, outLon, speedKph)) {
    dbg("[http] will retry");
  }

  delay(POST_INTERVAL_MS);
}
