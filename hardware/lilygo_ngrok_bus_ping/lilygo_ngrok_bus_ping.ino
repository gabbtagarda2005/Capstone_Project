/**
 * LilyGO ESP32 + SIM7600 (or SIM7000-class) — GNSS fix → POST /api/buses/ping (JSON).
 *
 * Why WiFi option: ngrok free tunnels are HTTPS. ESP32 WiFiClientSecure handles TLS easily;
 * many LTE modems need extra SSL setup for HTTPS. For *field-only* GPRS, point SERVER_HOST
 * at an HTTP endpoint (port 80) or use a VPS reverse proxy.
 *
 * Backend: Admin_Backend already updates MongoDB + Socket.io via ingestDeviceGps.
 *
 * Libraries: TinyGSM, ArduinoJson (v6+). ESP32 core includes WiFi / WiFiClientSecure.
 *
 * Copy config.h.example → config.h
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <math.h>

#include "config.h"

#if __has_include(<TinyGsmClient.h>)
#include <TinyGsmClient.h>
#elif __has_include(<TinyGSM.h>)
#include <TinyGSM.h>
#else
#error "Install TinyGSM (Volodymyr Shymanskyy) via Library Manager."
#endif

#ifndef GNSS_COORDS_DDMM_FORMAT
#define GNSS_COORDS_DDMM_FORMAT 0
#endif

HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
TinyGsmClient gsmClient(modem);

static double dmToDecimalDegrees(double dm) {
  double a = fabs(dm);
  int deg = (int)(a / 100.0);
  double min = a - (double)deg * 100.0;
  if (deg < 0 || deg > 180 || min < 0.0 || min >= 60.0) return dm;
  double dec = (double)deg + min / 60.0;
  return dm < 0.0 ? -dec : dec;
}

static bool parseCgnsinfCsv(const String &rest, double &lat, double &lon) {
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
  if (start < (int)r.length() && idx < 22) parts[idx++] = r.substring(start);
  for (int i = 0; i < idx; i++) parts[i].trim();
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
  if (modem.waitResponse(3000L, GF("+CGNSINF:")) != 1) return false;
  String line = modem.stream.readStringUntil('\n');
  line.trim();
  bool ok = parseCgnsinfCsv(line, lat, lon);
  modem.waitResponse();
  return ok;
}

static bool powerOnGnss() {
  modem.sendAT(GF("+CGNSPWR=1"));
  if (modem.waitResponse() != 1) return false;
  delay(GPS_WARMUP_MS);
  return true;
}

#if !USE_WIFI_FOR_HTTPS_UPLOAD
static bool connectGprs() {
  if (!modem.gprsConnect(CELL_APN, CELL_APN_USER, CELL_APN_PASS)) return false;
  return true;
}
#endif

static void dbg(const char *m) { Serial.println(m); }

/** HTTPS POST via ESP32 WiFi (recommended for ngrok https://… tunnels). */
static bool postPingWifiSecure(double lat, double lng) {
  if (WiFi.status() != WL_CONNECTED) {
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
  }

  WiFiClientSecure client;
  client.setInsecure();  // dev: skip CA verify (ngrok public cert rotates)

  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    dbg("[https] connect failed");
    return false;
  }

  StaticJsonDocument<256> doc;
  doc["busId"] = BUS_ID;
  doc["lat"] = round(lat * 1.0e7) / 1.0e7;
  doc["lng"] = round(lng * 1.0e7) / 1.0e7;

  char body[200];
  size_t n = serializeJson(doc, body, sizeof(body));
  if (n == 0 || n >= sizeof(body)) return false;

  client.print(F("POST "));
  client.print(SERVER_PATH);
  client.print(F(" HTTP/1.1\r\nHost: "));
  client.print(SERVER_HOST);
  client.print(F("\r\nContent-Type: application/json\r\nConnection: close\r\n"));
  client.print(F("ngrok-skip-browser-warning: true\r\n"));
  {
    const char *ak = DEVICE_API_KEY;
    const char *ds = DEVICE_SECRET;
    if (ak != nullptr && ak[0] != '\0') {
      client.print(F("x-api-key: "));
      client.print(ak);
      client.print(F("\r\n"));
    }
    if (ds != nullptr && ds[0] != '\0') {
      client.print(F("x-device-secret: "));
      client.print(ds);
      client.print(F("\r\n"));
    }
  }
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
      if (head.length() > 12 && head.indexOf("\r\n\r\n") >= 0) break;
      if (head.length() > 600) break;
    }
    if (head.indexOf("\r\n\r\n") >= 0) break;
    delay(2);
  }
  while (client.available()) client.read();
  client.stop();

  if (head.indexOf("204") >= 0 || head.indexOf("200") >= 0) {
    dbg("[https] accepted");
    return true;
  }
  dbg("[https] unexpected response");
  Serial.println(head.substring(0, min((int)head.length(), 280)));
  return false;
}

/** Plain HTTP POST over GPRS (use SERVER_PORT 80 and a host that serves HTTP). */
static bool postPingGsmHttp(double lat, double lng) {
  if (!gsmClient.connect(SERVER_HOST, SERVER_PORT)) {
    dbg("[gsm http] tcp fail");
    return false;
  }

  StaticJsonDocument<256> doc;
  doc["busId"] = BUS_ID;
  doc["lat"] = round(lat * 1.0e7) / 1.0e7;
  doc["lng"] = round(lng * 1.0e7) / 1.0e7;

  char body[200];
  size_t n = serializeJson(doc, body, sizeof(body));

  gsmClient.print(F("POST "));
  gsmClient.print(SERVER_PATH);
  gsmClient.print(F(" HTTP/1.1\r\nHost: "));
  gsmClient.print(SERVER_HOST);
  gsmClient.print(F("\r\nContent-Type: application/json\r\nConnection: close\r\n"));
  {
    const char *ak = DEVICE_API_KEY;
    const char *ds = DEVICE_SECRET;
    if (ak != nullptr && ak[0] != '\0') {
      gsmClient.print(F("x-api-key: "));
      gsmClient.print(ak);
      gsmClient.print(F("\r\n"));
    }
    if (ds != nullptr && ds[0] != '\0') {
      gsmClient.print(F("x-device-secret: "));
      gsmClient.print(ds);
      gsmClient.print(F("\r\n"));
    }
  }
  gsmClient.print(F("Content-Length: "));
  gsmClient.print((unsigned)n);
  gsmClient.print(F("\r\n\r\n"));
  gsmClient.write((const uint8_t *)body, n);

  delay(100);
  String head;
  for (int i = 0; i < 120 && gsmClient.available(); i++) head += (char)gsmClient.read();
  unsigned long t0 = millis();
  while (gsmClient.connected() && millis() - t0 < 20000) {
    while (gsmClient.available()) gsmClient.read();
    delay(10);
  }
  gsmClient.stop();

  if (head.indexOf("204") >= 0 || head.indexOf("200") >= 0) {
    dbg("[gsm http] accepted");
    return true;
  }
  dbg("[gsm http] error");
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  dbg("=== LilyGO → /api/buses/ping (ngrok / Admin) ===");

  SerialAT.begin(MODEM_UART_BAUD, SERIAL_8N1, MODEM_UART_RX, MODEM_UART_TX);
  delay(400);
  modem.restart();
  delay(2000);
  dbg(modem.getModemInfo().c_str());

  if (!powerOnGnss()) dbg("[gps] CGNSPWR warning");

#if USE_WIFI_FOR_HTTPS_UPLOAD
  dbg("[mode] Upload: WiFi + HTTPS (ESP32 TLS) — modem used for GNSS only here.");
#else
  dbg("[mode] Upload: GPRS HTTP — set SERVER_PORT 80 unless your modem does SSL.");
#endif
}

void loop() {
  if (!modem.waitForNetwork(90000)) {
    dbg("[net] cellular not registered — retry");
    delay(POST_INTERVAL_MS);
    return;
  }

  double lat = 0, lon = 0;
  unsigned long w = 0;
  while (w < MAX_GPS_WAIT_MS) {
    if (fetchGpsFix(lat, lon)) break;
    delay(2000);
    w += 2000;
  }
  if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
    dbg("[gps] no fix");
    delay(POST_INTERVAL_MS);
    return;
  }

#if USE_WIFI_FOR_HTTPS_UPLOAD
  postPingWifiSecure(lat, lon);
#else
  if (!modem.isGprsConnected()) {
    modem.gprsDisconnect();
    delay(300);
    if (!connectGprs()) {
      dbg("[gprs] connect failed");
      delay(POST_INTERVAL_MS);
      return;
    }
  }
  if (!postPingGsmHttp(lat, lon)) modem.gprsDisconnect();
#endif

  delay(POST_INTERVAL_MS);
}
