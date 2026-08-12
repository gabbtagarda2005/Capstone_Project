/**
 * LilyGO (ESP32 + cellular modem) — automatic GPS → HTTP(S) telemetry for Admin_Backend.
 *
 * API: POST …/api/hardware-telemetry (or SERVER_PATH)
 * Body JSON: imei, lat, lng (optional: net, signal_strength, voltage)
 * Headers (match Admin_Backend .env):
 *   - x-device-secret  → DEVICE_INGEST_SECRET
 *   - x-api-key        → DEVICE_INGEST_API_KEY (when set on server, required on device too)
 *
 * Upload modes (config.h):
 *   - USE_WIFI_FOR_HTTPS_UPLOAD 0 — GPRS + plain HTTP (port 80 typical)
 *   - USE_WIFI_FOR_HTTPS_UPLOAD 1 — ESP32 WiFi + TLS (ngrok https, port 443); modem used for GNSS only
 *
 * Library dependencies (Arduino Library Manager):
 *   - TinyGSM by Volodymyr Shymanskyy
 *   - ArduinoJson by Benoit Blanchon (v6+)
 *
 * Copy config.h.example → config.h and edit APN + server + secrets.
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <math.h>

#include "config.h"

#ifndef USE_WIFI_FOR_HTTPS_UPLOAD
#define USE_WIFI_FOR_HTTPS_UPLOAD 0
#endif

#if USE_WIFI_FOR_HTTPS_UPLOAD
#include <WiFi.h>
#include <WiFiClientSecure.h>
#endif

#ifndef DEVICE_API_KEY
#define DEVICE_API_KEY ""
#endif
#if __has_include(<TinyGsmClient.h>)
#include <TinyGsmClient.h>
#elif __has_include(<TinyGSM.h>)
#include <TinyGSM.h>
#else
#error "TinyGSM library not found. Install 'TinyGSM by Volodymyr Shymanskyy' via Library Manager."
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
/**
 * Keep GNSS live. Use hard pin only for diagnostics.
 */
#ifndef GPS_FORCE_LOCK
#define GPS_FORCE_LOCK 0
#endif
#ifndef GPS_FORCE_LAT
#define GPS_FORCE_LAT 8.156923
#endif
#ifndef GPS_FORCE_LNG
#define GPS_FORCE_LNG 125.124557
#endif
/**
 * Optional calibration offsets (decimal degrees) applied after smoothing.
 * Default 0 — set only after you measure a *known* survey point vs reported fix.
 * Wrong offsets here cause a fixed position error everywhere (often mistaken for "WiFi" issues).
 */
#ifndef GPS_CAL_LAT_OFFSET
#define GPS_CAL_LAT_OFFSET 0.0
#endif
#ifndef GPS_CAL_LNG_OFFSET
#define GPS_CAL_LNG_OFFSET 0.0
#endif
/**
 * Optional fix-quality gate (SIM7000 AT+CGNSINF). 0 = skip that check.
 * Stricter values reduce uploads when GNSS is weak (multipath, indoor, bad sky view).
 */
#ifndef GPS_MIN_SATELLITES_USED
#define GPS_MIN_SATELLITES_USED 0
#endif
#ifndef GPS_MAX_HDOP
#define GPS_MAX_HDOP 0.0f
#endif

HardwareSerial SerialAT(1);

TinyGsm modem(SerialAT);
TinyGsmClient gsmClient(modem);

String imeiCached;

/** Backoff on consecutive network/GPS/HTTP failures (network reg, GPRS connect, or POST) — caps
 *  retry spacing instead of hammering the modem forever at a fixed interval. Resets to 0 on any
 *  successful telemetry POST. Bounded (MAX_BACKOFF_MS), so the loop is never "stuck": it always
 *  comes back around and retries, just less often after repeated failures. */
static uint8_t gConsecutiveFailures = 0;
static const unsigned long MAX_BACKOFF_MS = 60000;

static unsigned long backoffDelayMs() {
  unsigned long shift = gConsecutiveFailures < 4 ? gConsecutiveFailures : 4; // cap growth at 16x
  unsigned long delayMs = (unsigned long)POST_INTERVAL_MS << shift;
  return delayMs < MAX_BACKOFF_MS ? delayMs : MAX_BACKOFF_MS;
}

static void onTelemetryFailure(const char *reason) {
  if (gConsecutiveFailures < 250) {
    gConsecutiveFailures++;
  }
  Serial.print(F("[retry] "));
  Serial.print(reason);
  Serial.print(F(" — backing off "));
  Serial.print(backoffDelayMs());
  Serial.println(F(" ms"));
}

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

static void dbg(const char *msg) {
  Serial.println(msg);
}

/** TinyGsm registration: 1 = home, 5 = roaming (typical). */
static bool waitNetReady() {
  int st = modem.getRegistrationStatus();
  if (st != 1 && st != 5) {
    return false;
  }
  return modem.isGprsConnected();
}

static bool connectGprs() {
  dbg("[net] GPRS connect…");
  if (!modem.gprsConnect(CELL_APN, CELL_APN_USER, CELL_APN_PASS)) {
    dbg("[net] GPRS failed");
    return false;
  }
  dbg("[net] GPRS OK");
  return true;
}

static String readImei() {
  String imei = modem.getIMEI();
  imei.trim();
  String out;
  for (unsigned i = 0; i < imei.length(); i++) {
    char c = imei.charAt(i);
    if (c >= '0' && c <= '9') out += c;
  }
  if (out.length() != 15) {
    return "";
  }
  return out;
}

/** NMEA-style DDMM.MMMM / DDDMM.MMMM → decimal degrees. */
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
 * SIM7000/7600: AT+CGNSINF CSV — run, fix, utc, lat, lon, alt, sog, cog, fixmode, res, hdop, pdop, vdop, res,
 * sat_in_view, sat_used, …
 */
static bool parseCgnsinfCsv(const String &rest, double &lat, double &lon, int *satUsedOut, float *hdopOut) {
  if (satUsedOut) {
    *satUsedOut = -1;
  }
  if (hdopOut) {
    *hdopOut = -1.0f;
  }
  String r = rest;
  r.trim();
  int idx = 0;
  String parts[22];
  int start = 0;
  for (int i = 0; i < (int)r.length() && idx < 22; i++) {
    if (r.charAt(i) == ',') {
      parts[idx++] = r.substring(start, i);
      start = i + 1;
    }
  }
  if (start < (int)r.length() && idx < 22) {
    parts[idx++] = r.substring(start);
  }
  for (int i = 0; i < idx; i++) {
    parts[i].trim();
  }
  if (idx < 5) return false;
  if (parts[1].length() == 0 || parts[1].toInt() != 1) return false;
  lat = parts[3].toDouble();
  lon = parts[4].toDouble();
#if GNSS_COORDS_DDMM_FORMAT
  lat = dmToDecimalDegrees(lat);
  lon = dmToDecimalDegrees(lon);
#endif
  if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) return false;
  if (fabs(lat) < 1e-6 && fabs(lon) < 1e-6) return false;
  if (idx > 10 && parts[10].length() > 0 && hdopOut) {
    *hdopOut = parts[10].toFloat();
  }
  if (idx > 15 && parts[15].length() > 0 && satUsedOut) {
    *satUsedOut = parts[15].toInt();
  }
  return true;
}

static bool fixMeetsQuality(int satUsed, float hdop) {
  if (GPS_MIN_SATELLITES_USED > 0) {
    if (satUsed < 0 || satUsed < GPS_MIN_SATELLITES_USED) {
      return false;
    }
  }
  if (GPS_MAX_HDOP > 0.0f) {
    if (hdop < 0.0f || hdop > GPS_MAX_HDOP) {
      return false;
    }
  }
  return true;
}

static bool fetchGpsFix(double &lat, double &lon) {
  modem.sendAT(GF("+CGNSINF"));
  if (modem.waitResponse(3000L, GF("+CGNSINF:")) != 1) {
    return false;
  }
  String line = modem.stream.readStringUntil('\n');
  line.trim();
  int satUsed = -1;
  float hdop = -1.0f;
  bool ok = parseCgnsinfCsv(line, lat, lon, &satUsed, &hdop);
  if (ok && !fixMeetsQuality(satUsed, hdop)) {
    ok = false;
  }
  modem.waitResponse();
  return ok;
}

static bool powerOnGnss() {
  modem.sendAT(GF("+CGNSPWR=1"));
  if (modem.waitResponse() != 1) {
    dbg("[gps] CGNSPWR=1 failed");
    return false;
  }
  delay(GPS_WARMUP_MS);
  return true;
}

/** Match Backend deviceIngestAuth: optional x-api-key + x-device-secret. */
static void printDeviceIngestHeaders(Print &out) {
  const char *ak = DEVICE_API_KEY;
  const char *ds = DEVICE_INGEST_SECRET;
  if (ak != nullptr && ak[0] != '\0') {
    out.print(F("x-api-key: "));
    out.print(ak);
    out.print(F("\r\n"));
  }
  if (ds != nullptr && ds[0] != '\0') {
    out.print(F("x-device-secret: "));
    out.print(ds);
    out.print(F("\r\n"));
  }
}

#if USE_WIFI_FOR_HTTPS_UPLOAD
static bool ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  dbg("[wifi] connecting…");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 45000) {
    delay(400);
  }
  if (WiFi.status() != WL_CONNECTED) {
    dbg("[wifi] failed");
    return false;
  }
  dbg("[wifi] OK");
  return true;
}

/** HTTPS POST via ESP32 (ngrok / TLS reverse proxy). Modem used for GNSS only. */
static bool postTelemetryWifiSecure(double lat, double lng) {
  if (imeiCached.length() != 15) {
    dbg("[post] IMEI invalid");
    return false;
  }
  if (!ensureWifiConnected()) {
    return false;
  }

  StaticJsonDocument<384> doc;
  doc["imei"] = imeiCached;
  doc["lat"] = round(lat * 1.0e7) / 1.0e7;
  doc["lng"] = round(lng * 1.0e7) / 1.0e7;
  doc["net"] = "wifi";
  {
    int r = WiFi.RSSI();
    if (r != 0 && r > -127) {
      doc["signal_strength"] = r;
    }
  }

  char body[320];
  size_t n = serializeJson(doc, body, sizeof(body));
  if (n == 0 || n >= sizeof(body)) {
    dbg("[post] JSON too large");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    dbg("[https] connect failed");
    return false;
  }

  client.print(F("POST "));
  client.print(SERVER_PATH);
  client.print(F(" HTTP/1.1\r\nHost: "));
  client.print(SERVER_HOST);
  client.print(F("\r\nContent-Type: application/json\r\nConnection: close\r\n"));
  client.print(F("ngrok-skip-browser-warning: true\r\n"));
  printDeviceIngestHeaders(client);
  client.print(F("Content-Length: "));
  client.print((unsigned)n);
  client.print(F("\r\n\r\n"));
  client.write((const uint8_t *)body, n);

  unsigned long t1 = millis();
  String head;
  while (client.connected() && millis() - t1 < 20000) {
    while (client.available()) {
      char c = (char)client.read();
      head += c;
      if (head.length() > 12 && head.indexOf("\r\n\r\n") >= 0) {
        break;
      }
      if (head.length() > 600) {
        break;
      }
    }
    if (head.indexOf("\r\n\r\n") >= 0) {
      break;
    }
    delay(2);
  }
  while (client.available()) {
    client.read();
  }
  client.stop();

  if (head.indexOf("204") >= 0 || head.indexOf("200") >= 0) {
    dbg("[https] server accepted");
    return true;
  }
  dbg("[https] unexpected response");
  Serial.println(head.substring(0, min((int)head.length(), 280)));
  return false;
}
#endif

/** Minimal HTTP/1.1 POST over raw TCP (GPRS, HTTP port 80 typical). */
static bool postTelemetryGprs(double lat, double lng, int rssiDbm) {
  if (imeiCached.length() != 15) {
    dbg("[post] IMEI invalid");
    return false;
  }

  StaticJsonDocument<384> doc;
  doc["imei"] = imeiCached;
  doc["lat"] = round(lat * 1.0e7) / 1.0e7;
  doc["lng"] = round(lng * 1.0e7) / 1.0e7;
  doc["net"] = "4g";
  if (rssiDbm != 0) doc["signal_strength"] = rssiDbm;

  char body[320];
  size_t n = serializeJson(doc, body, sizeof(body));
  if (n == 0 || n >= sizeof(body)) {
    dbg("[post] JSON too large");
    return false;
  }

  if (!gsmClient.connect(SERVER_HOST, SERVER_PORT)) {
    dbg("[post] TCP connect failed");
    return false;
  }

  gsmClient.print(F("POST "));
  gsmClient.print(SERVER_PATH);
  gsmClient.print(F(" HTTP/1.1\r\nHost: "));
  gsmClient.print(SERVER_HOST);
  gsmClient.print(F("\r\nContent-Type: application/json\r\nConnection: close\r\n"));
  printDeviceIngestHeaders(gsmClient);
  gsmClient.print(F("Content-Length: "));
  gsmClient.print((unsigned)n);
  gsmClient.print(F("\r\n\r\n"));
  gsmClient.write((const uint8_t *)body, n);

  delay(80);
  String head;
  for (int i = 0; i < 96 && gsmClient.available(); i++) {
    head += (char)gsmClient.read();
  }
  unsigned long t0 = millis();
  while (gsmClient.connected() && millis() - t0 < 20000) {
    while (gsmClient.available()) {
      gsmClient.read();
    }
    delay(10);
  }
  gsmClient.stop();
  if (head.indexOf("204") < 0 && head.indexOf("200") < 0) {
    dbg("[post] HTTP error (expected 204)");
    Serial.println(head.substring(0, min((int)head.length(), 280)));
    return false;
  }
  dbg("[post] server accepted (204/200)");
  return true;
}

static int readRssi() {
  modem.sendAT(GF("+CSQ"));
  if (modem.waitResponse(2000, GF("+CSQ:")) != 1) {
    return 0;
  }
  String s = modem.stream.readStringUntil('\n');
  s.trim();
  int comma = s.indexOf(',');
  if (comma < 0) return 0;
  int raw = s.substring(0, comma).toInt();
  if (raw == 99 || raw < 0) return 0;
  return -113 + raw * 2;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  dbg("");
  dbg("=== LilyGO GPS telemetry ===");

  SerialAT.begin(MODEM_UART_BAUD, SERIAL_8N1, MODEM_UART_RX, MODEM_UART_TX);
  delay(500);

  dbg("[modem] restart…");
  modem.restart();
  delay(2000);

  String modemInfo = modem.getModemInfo();
  dbg(("[modem] " + modemInfo).c_str());

  imeiCached = readImei();
  if (imeiCached.length() != 15) {
    dbg("[fatal] Could not read 15-digit IMEI — register modem in Fleet with AT+CGSN.");
  } else {
    dbg(("[modem] IMEI " + imeiCached).c_str());
  }

  if (!powerOnGnss()) {
    dbg("[gps] GNSS power-on failed — check SIM7000 GNSS support / antenna.");
  }

#if USE_WIFI_FOR_HTTPS_UPLOAD
  dbg("[loop] Upload: WiFi+HTTPS — GPRS data not required; cellular registration still needed for some modems.");
#else
  dbg("[loop] Upload: GPRS HTTP — connect APN then POST every POST_INTERVAL_MS (self-healing on failure).");
#endif
}

void loop() {
  if (imeiCached.length() != 15) {
    delay(POST_INTERVAL_MS);
    return;
  }

  if (!modem.waitForNetwork(60000)) {
    onTelemetryFailure("[net] No network");
    delay(backoffDelayMs());
    return;
  }

#if !USE_WIFI_FOR_HTTPS_UPLOAD
  if (!waitNetReady() || !modem.isGprsConnected()) {
    modem.gprsDisconnect();
    delay(500);
    if (!connectGprs()) {
      onTelemetryFailure("[gprs] connect failed");
      delay(backoffDelayMs());
      return;
    }
  }
#endif

  unsigned long gpsWait = 0;
  double lat = 0, lon = 0;
  while (gpsWait < MAX_GPS_WAIT_MS) {
    if (fetchGpsFix(lat, lon)) {
      break;
    }
    delay(2000);
    gpsWait += 2000;
  }

  if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
    smoothReset();
    // No GNSS fix is not a network/server failure — keep the normal cadence so the antenna gets
    // another chance quickly instead of backing off (backoff is for connectivity failures).
    dbg("[gps] No fix yet — retry…");
    delay(POST_INTERVAL_MS);
    return;
  }

  smoothPush(lat, lon);
  double outLat = lat;
  double outLon = lon;
  if (!smoothAvg(outLat, outLon)) {
    outLat = lat;
    outLon = lon;
  }
#if GPS_FORCE_LOCK
  outLat = GPS_FORCE_LAT;
  outLon = GPS_FORCE_LNG;
#else
  outLat += GPS_CAL_LAT_OFFSET;
  outLon += GPS_CAL_LNG_OFFSET;
#endif

#if USE_WIFI_FOR_HTTPS_UPLOAD
  bool posted = postTelemetryWifiSecure(outLat, outLon);
  if (!posted) {
    dbg("[post] WiFi upload failed");
  }
#else
  int rssi = readRssi();
  bool posted = postTelemetryGprs(outLat, outLon, rssi);
  if (!posted) {
    modem.gprsDisconnect();
  }
#endif

  if (posted) {
    gConsecutiveFailures = 0;
    delay(POST_INTERVAL_MS);
  } else {
    onTelemetryFailure("[post] upload failed");
    delay(backoffDelayMs());
  }
}
