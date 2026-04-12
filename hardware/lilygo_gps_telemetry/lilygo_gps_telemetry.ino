/**
 * LilyGO (ESP32 + cellular modem) — automatic GPS → HTTP telemetry for Admin_Backend.
 *
 * API: POST http(s)://HOST/api/hardware-telemetry
 * Body JSON: imei, lat, lng (optional: net, signal_strength, voltage)
 * Header (if DEVICE_INGEST_SECRET set on server): x-device-secret
 *
 * Library dependencies (Arduino Library Manager):
 *   - TinyGSM by Volodymyr Shymanskyy
 *   - ArduinoJson by Benoit Blanchon (v6+)
 *
 * Copy config.h.example → config.h and edit APN + server + secret.
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <math.h>

#include "config.h"
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
 * Optional calibration offsets (decimal degrees) applied to live GNSS after smoothing.
 * Keep both at 0.0 by default. If parked at your known base point
 * (8.156923, 125.124557), compute:
 *   GPS_CAL_LAT_OFFSET = baseLat - measuredLat
 *   GPS_CAL_LNG_OFFSET = baseLng - measuredLng
 */
#ifndef GPS_CAL_LAT_OFFSET
#define GPS_CAL_LAT_OFFSET 0.009223
#endif
#ifndef GPS_CAL_LNG_OFFSET
#define GPS_CAL_LNG_OFFSET -0.007843
#endif

HardwareSerial SerialAT(1);

TinyGsm modem(SerialAT);
TinyGsmClient gsmClient(modem);

String imeiCached;

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

/** SIM7000/7600: AT+CGNSINF CSV — fields: run, fix, utc, lat, lon, … */
static bool parseCgnsinfCsv(const String &rest, double &lat, double &lon) {
  String r = rest;
  r.trim();
  int idx = 0;
  String parts[20];
  int start = 0;
  for (int i = 0; i < (int)r.length() && idx < 20; i++) {
    if (r.charAt(i) == ',') {
      parts[idx++] = r.substring(start, i);
      start = i + 1;
    }
  }
  if (start < (int)r.length() && idx < 20) {
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
  return true;
}

static bool fetchGpsFix(double &lat, double &lon) {
  modem.sendAT(GF("+CGNSINF"));
  if (modem.waitResponse(3000L, GF("+CGNSINF:")) != 1) {
    return false;
  }
  String line = modem.stream.readStringUntil('\n');
  line.trim();
  bool ok = parseCgnsinfCsv(line, lat, lon);
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

/** Minimal HTTP/1.1 POST over raw TCP (works with HTTP port 80). */
static bool postTelemetry(double lat, double lng, int rssiDbm) {
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
  {
    const char *sec = DEVICE_INGEST_SECRET;
    if (sec != nullptr && sec[0] != '\0') {
      gsmClient.print(F("x-device-secret: "));
      gsmClient.print(sec);
      gsmClient.print(F("\r\n"));
    }
  }
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

  dbg("[loop] Will connect GPRS then POST every POST_INTERVAL_MS (self-healing on failure).");
}

void loop() {
  if (imeiCached.length() != 15) {
    delay(POST_INTERVAL_MS);
    return;
  }

  if (!modem.waitForNetwork(60000)) {
    dbg("[net] No network — retry…");
    delay(POST_INTERVAL_MS);
    return;
  }

  if (!waitNetReady() || !modem.isGprsConnected()) {
    modem.gprsDisconnect();
    delay(500);
    if (!connectGprs()) {
      delay(POST_INTERVAL_MS);
      return;
    }
  }

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

  int rssi = readRssi();
  if (!postTelemetry(outLat, outLon, rssi)) {
    modem.gprsDisconnect();
  }

  delay(POST_INTERVAL_MS);
}
