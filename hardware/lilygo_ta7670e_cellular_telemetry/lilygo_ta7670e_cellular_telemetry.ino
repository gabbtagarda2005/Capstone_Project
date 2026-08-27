/**
 * LilyGO T-A7670E — cellular (SIM/GPRS) HTTPS telemetry for Admin_Backend (field / on-bus deployment).
 *
 * Unlike lilygo_ta7670e_wifi_telemetry (same board, same GNSS code), this sketch has NO Wi-Fi
 * dependency at all — the A7670E's own cellular radio + SIM card both (a) get a GNSS fix and
 * (b) upload it, so it works anywhere with mobile signal, not just on your dev LAN.
 *
 * - GNSS from AT+CGNSSINFO — identical power-on sequence and parser to lilygo_ta7670e_wifi_telemetry
 *   (see that sketch's parseCgnssinfo() comment for how the CSV field layout was verified on this
 *   exact chip/firmware; copied verbatim here since it's the same board).
 * - Network: AT+CGDCONT / AT+CGATT / AT+CGACT (standard 3GPP PDP context attach — high confidence,
 *   these are universal across cellular modems).
 * - Upload: HTTPS via the modem's OWN AT+HTTP* + AT+CSSLCFG command set (SIMCom A76XX HTTP(S)
 *   Application), NOT TinyGSM — TinyGSM's own SIM7600 driver explicitly does not support SSL
 *   ("SSL not yet supported on this module!" in its source). The modem does the TLS handshake
 *   itself in its own firmware; the ESP32 never sees raw TLS bytes.
 *
 * IMPORTANT — the AT+HTTP*/AT+CSSLCFG sequence below is synthesized from SIMCom's documented
 * command set plus a real practitioner report of it working on this exact chip (A7670E), but it
 * has NOT been confirmed against the primary SIMCom AT command manual for your specific firmware
 * build. Before trusting it on your bus, use DEBUG_AT_PASSTHROUGH (below) to run this exact
 * sequence by hand over Serial and watch the raw modem replies — the same technique that caught
 * the CGNSSINFO field-index bug in the Wi-Fi sketch. If a command errors, the modem's ERROR
 * reply plus AT+CSSLCFG=? / AT+HTTPPARA=? (list current params) usually tells you the fix.
 *
 * Certificate verification: CSSLCFG authmode defaults to 0 (skip server cert verification) —
 * traffic is still encrypted (protects against passive eavesdropping on the mobile network), but
 * the modem does not cryptographically confirm it's really talking to your Pi (vulnerable to an
 * on-path MITM). This mirrors the same trade-off already made (and documented) in
 * lilygo_ngrok_bus_ping's WiFiClientSecure().setInsecure() dev path. The real authentication here
 * is DEVICE_INGEST_SECRET (x-device-secret header), checked server-side on every request
 * regardless of TLS. To get real cert validation, set SSL_VERIFY_SERVER_CERT 1 in config.h and
 * upload your CA cert to the modem's filesystem first (AT+CSSLCFG="cacert",... needs a file
 * already written via AT+FSCREATE/AT+FSWRITE) — out of scope for this sketch as shipped.
 *
 * Copy config.h.example → config.h
 * Libraries: ArduinoJson (v6+)
 *
 * Backend success: HTTP 204 (or 200/201). Match DEVICE_INGEST_SECRET to .env.
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <math.h>

#include "config.h"

#ifndef DEBUG_CELLULAR_ONLY_POST
#define DEBUG_CELLULAR_ONLY_POST 0
#endif
#ifndef GNSS_RAW_DEBUG
#define GNSS_RAW_DEBUG 1
#endif

#ifndef GPS_MIN_SATS
#define GPS_MIN_SATS 4
#endif

#ifndef POST_INTERVAL_MS
#define POST_INTERVAL_MS 8000
#endif
#ifndef GNSS_SPEED_FIELD_INDEX
#define GNSS_SPEED_FIELD_INDEX 12
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
#define GNSS_ENABLE_MULTI_CONSTELLATION 1
#endif
#ifndef SSL_VERIFY_SERVER_CERT
#define SSL_VERIFY_SERVER_CERT 0
#endif

/**
 * T-A7670 boards gate the modem's entire power rail behind BOARD_POWERON_PIN — without driving it
 * HIGH first, the modem is physically unpowered. Identical to lilygo_ta7670e_wifi_telemetry;
 * verified against LilyGO's own official example for this exact board
 * (Xinyuan-LilyGO/LilyGO-T-A76XX, examples/Network/Network.ino).
 */
#ifndef BOARD_POWERON_PIN
#define BOARD_POWERON_PIN 12
#endif
#ifndef BOARD_PWRKEY_PIN
#define BOARD_PWRKEY_PIN 4
#endif
#ifndef MODEM_RESET_PIN
#define MODEM_RESET_PIN 5
#endif
#ifndef MODEM_RESET_LEVEL
#define MODEM_RESET_LEVEL HIGH
#endif
#ifndef MODEM_DTR_PIN
#define MODEM_DTR_PIN 25
#endif
#ifndef MODEM_POWERON_PULSE_WIDTH_MS
#define MODEM_POWERON_PULSE_WIDTH_MS 100
#endif

static void powerOnModem() {
  pinMode(BOARD_POWERON_PIN, OUTPUT);
  digitalWrite(BOARD_POWERON_PIN, HIGH);

  pinMode(MODEM_RESET_PIN, OUTPUT);
  digitalWrite(MODEM_RESET_PIN, !MODEM_RESET_LEVEL);
  delay(100);
  digitalWrite(MODEM_RESET_PIN, MODEM_RESET_LEVEL);
  delay(2600);
  digitalWrite(MODEM_RESET_PIN, !MODEM_RESET_LEVEL);

  pinMode(MODEM_DTR_PIN, OUTPUT);
  digitalWrite(MODEM_DTR_PIN, LOW);

  pinMode(BOARD_PWRKEY_PIN, OUTPUT);
  digitalWrite(BOARD_PWRKEY_PIN, LOW);
  delay(100);
  digitalWrite(BOARD_PWRKEY_PIN, HIGH);
  delay(MODEM_POWERON_PULSE_WIDTH_MS);
  digitalWrite(BOARD_PWRKEY_PIN, LOW);
}

HardwareSerial ModemSerial(1);

static double gSmoothLat[GPS_SMOOTH_MAX];
static double gSmoothLon[GPS_SMOOTH_MAX];
static int gSmoothCount = 0;

static void smoothReset() {
  gSmoothCount = 0;
}

static void smoothPush(double la, double lo) {
  int cap = GPS_SMOOTH_SAMPLES;
  if (cap < 1) cap = 1;
  if (cap > GPS_SMOOTH_MAX) cap = GPS_SMOOTH_MAX;
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
  if (gSmoothCount == 0) return false;
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
      if (acc.length() > 1200) {
        acc.remove(0, 400);
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
 * Same layout verified on this exact chip/firmware in lilygo_ta7670e_wifi_telemetry:
 *   +CGNSSINFO: <mode>,<GPS-sats>,<GLONASS-sats>,<BeiDou-sats>,<extra>,<lat>,<N/S>,<lon>,<E/W>,
 *               <date>,<time>,<alt>,<speed>,<course>,<PDOP>,<HDOP>,<VDOP>
 * (lat at index 5, N/S at 6, lon at 7, E/W at 8, speed at 12 — NOT the simpler
 * <mode>,<sats>,<lat>,<NS>,<lon>,<EW>,... layout some SIMCom docs show).
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
  if (n < 9) {
    return false;
  }

  sats = parts[1].toInt();
  if (sats < GPS_MIN_SATS) {
    return false;
  }

  double latv = parts[5].toDouble();
  double lonv = parts[7].toDouble();
#if GNSS_COORDS_DDMM_FORMAT
  latv = dmToDecimalDegrees(latv);
  lonv = dmToDecimalDegrees(lonv);
#endif
  String ns = parts[6];
  String ew = parts[8];
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

// -----------------------------------------------------------------------------
// Cellular network attach — standard 3GPP PDP context commands, not chip-specific.
// -----------------------------------------------------------------------------
static bool cellularRegistered() {
  String r = modemExchange("AT+CGREG?", 3000);
  return r.indexOf(",1") >= 0 || r.indexOf(",5") >= 0;
}

static bool cellularEnsure() {
  if (!cellularRegistered()) {
    dbg("[cell] waiting for network registration…");
    modemExchange("AT+CGATT=1", 10000);
    uint32_t t0 = millis();
    while (!cellularRegistered() && millis() - t0 < 60000) {
      delay(1000);
      Serial.print(".");
    }
    Serial.println();
    if (!cellularRegistered()) {
      dbg("[cell] not registered — check SIM inserted, PIN lock disabled, and antenna.");
      return false;
    }
  }

  String cgdcont = String("AT+CGDCONT=1,\"IP\",\"") + CELL_APN + "\"";
  modemExchange(cgdcont.c_str(), 2000);

  String act = modemExchange("AT+CGACT?", 3000);
  if (act.indexOf("+CGACT: 1,1") < 0) {
    dbg("[cell] activating PDP context…");
    String r = modemExchange("AT+CGACT=1,1", 15000);
    if (r.indexOf("OK") < 0) {
      dbg("[cell] AT+CGACT=1,1 failed — check CELL_APN in config.h matches your SIM's carrier.");
      return false;
    }
  }
  return true;
}

// -----------------------------------------------------------------------------
// HTTPS upload via the modem's own AT+HTTP*/AT+CSSLCFG engine (TinyGSM has no SSL support on
// this chip family — see file header comment). See file header for verification caveats.
// -----------------------------------------------------------------------------

/** Wait for a specific token (e.g. "DOWNLOAD" or a URC prefix) in raw modem output. */
static bool waitForToken(const char *token, uint32_t timeoutMs, String *out) {
  String acc;
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    while (ModemSerial.available()) {
      acc += (char)ModemSerial.read();
    }
    if (acc.indexOf(token) >= 0) {
      if (out) *out = acc;
      return true;
    }
    if (acc.indexOf("ERROR") >= 0) {
      if (out) *out = acc;
      return false;
    }
    delay(5);
  }
  if (out) *out = acc;
  return false;
}

/** AT+HTTPDATA=<len>,<timeout> → wait "DOWNLOAD" prompt → write raw body bytes → wait final OK. */
static bool httpSendBody(const String &body, uint32_t timeoutMs) {
  modemFlush();
  ModemSerial.print("AT+HTTPDATA=");
  ModemSerial.print(body.length());
  ModemSerial.print(",");
  ModemSerial.println(timeoutMs);

  if (!waitForToken("DOWNLOAD", 5000, nullptr)) {
    dbg("[https] AT+HTTPDATA did not prompt DOWNLOAD");
    return false;
  }
  modemFlush();
  ModemSerial.print(body);

  String r;
  bool ok = waitForToken("OK", timeoutMs, &r);
  if (!ok) {
    dbg("[https] AT+HTTPDATA body write did not get OK");
  }
  return ok;
}

/** AT+HTTPACTION=<method> → immediate OK, then async "+HTTPACTION: <method>,<code>,<len>" URC. */
static bool httpAction(int method, int &statusCode) {
  modemFlush();
  ModemSerial.print("AT+HTTPACTION=");
  ModemSerial.println(method);

  if (!waitForToken("OK", 3000, nullptr)) {
    dbg("[https] AT+HTTPACTION not accepted");
    return false;
  }

  String urc;
  if (!waitForToken("+HTTPACTION:", 30000, &urc)) {
    dbg("[https] no +HTTPACTION response (timeout waiting for request to complete)");
    return false;
  }
  int p = urc.indexOf("+HTTPACTION:");
  int colon = urc.indexOf(':', p);
  String rest = urc.substring(colon + 1);
  String parts[3];
  int n = splitCsv(rest, parts, 3);
  if (n < 2) {
    return false;
  }
  statusCode = parts[1].toInt();
  return true;
}

static bool httpsPostTelemetry(double lat, double lon, float speedKph) {
  if (imeiCached.length() != 15) {
    return false;
  }

  StaticJsonDocument<384> doc;
  doc["imei"] = imeiCached;
  doc["lat"] = round(lat * 1.0e7) / 1.0e7;
  doc["lng"] = round(lon * 1.0e7) / 1.0e7;
  doc["speedKph"] = speedKph;
  doc["net"] = "cellular";

  String payload;
  payload.reserve(320);
  if (serializeJson(doc, payload) == 0) {
    return false;
  }

  modemExchange("AT+HTTPTERM", 1000);  // clean slate in case a prior attempt left a session open

  modemExchange("AT+CSSLCFG=\"sslversion\",0,4", 1000);  // ctx 0, all TLS versions
  {
    String authmode = String("AT+CSSLCFG=\"authmode\",0,") + (SSL_VERIFY_SERVER_CERT ? "1" : "0");
    modemExchange(authmode.c_str(), 1000);
  }

  String r = modemExchange("AT+HTTPINIT", 3000);
  if (r.indexOf("OK") < 0) {
    dbg("[https] AT+HTTPINIT failed");
    return false;
  }

  modemExchange("AT+HTTPPARA=\"CID\",1", 1000);
  modemExchange("AT+HTTPPARA=\"SSL\",1,0", 1000);  // enable SSL for this session, bound to ctx 0
  {
    String sni = String("AT+HTTPPARA=\"SNI\",\"") + SERVER_HOST + "\"";
    modemExchange(sni.c_str(), 1000);
  }
  {
    String url = String("AT+HTTPPARA=\"URL\",\"https://") + SERVER_HOST;
    if (SERVER_PORT != 443) {
      url += ":" + String(SERVER_PORT);
    }
    url += String(SERVER_PATH) + "\"";
    modemExchange(url.c_str(), 2000);
  }
  modemExchange("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);
  {
    const char *sec = DEVICE_INGEST_SECRET;
    if (sec != nullptr && sec[0] != '\0') {
      String hdr = String("AT+HTTPPARA=\"USERDATA\",\"x-device-secret: ") + sec + "\r\n\"";
      modemExchange(hdr.c_str(), 1000);
    }
  }

  if (!httpSendBody(payload, 10000)) {
    modemExchange("AT+HTTPTERM", 1000);
    return false;
  }

  int code = 0;
  bool gotResponse = httpAction(1 /* POST */, code);
  modemExchange("AT+HTTPTERM", 1000);

  if (!gotResponse) {
    dbg("[https] request failed (no response / timeout)");
    return false;
  }

  Serial.print(F("HTTP response code: "));
  Serial.println(code);
  if (code == 401) {
    dbg("[hint] 401 = x-device-secret mismatch, or AT+HTTPPARA=\"USERDATA\" header wasn't accepted by "
        "this modem firmware — verify with DEBUG_AT_PASSTHROUGH.");
  }
  if (code == 404) {
    dbg("[hint] 404 = IMEI not in Fleet — add this IMEI to the bus in Admin");
  }
  if (code == 400) {
    dbg("[hint] 400 = missing lat/lng or imei in JSON");
  }
  if (code == 0) {
    dbg("[hint] 0 = TCP/TLS connect failed — check SERVER_HOST/PORT reachable, SSL authmode, SNI");
  }

  return code == 200 || code == 201 || code == 204;
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  dbg("");
  dbg("=== LilyGO T-A7670E cellular (SIM) HTTPS telemetry ===");

  dbg("[modem] power-on sequence (BOARD_POWERON_PIN/RESET/PWRKEY)…");
  powerOnModem();

  ModemSerial.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(800);

  dbg("[modem] waiting for AT response…");
  bool modemReady = false;
  const uint32_t MODEM_AT_RETRY_WINDOW_MS = 20000;
  uint32_t atWaitStart = millis();
  while (millis() - atWaitStart < MODEM_AT_RETRY_WINDOW_MS) {
    String r = modemExchange("AT", 800);
    if (r.indexOf("OK") >= 0) {
      modemReady = true;
      break;
    }
    Serial.print(".");
    delay(500);
  }
  Serial.println();
  if (modemReady) {
    dbg("[modem] AT OK");
    modemExchange("ATE0", 800);
  } else {
    dbg("[modem] no AT response after 20s — check UART pins (MODEM_RX_PIN/MODEM_TX_PIN in "
        "config.h), modem power, and baud rate.");
  }

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

#if DEBUG_AT_PASSTHROUGH
  /**
   * Raw bidirectional bridge between USB Serial and the modem UART — modem is already powered on
   * and GNSS-enabled at this point, but instead of running the telemetry loop, every byte typed
   * into Serial Monitor goes straight to the modem and every byte the modem sends comes straight
   * back. Use this to hand-verify the HTTPS AT sequence in httpsPostTelemetry() (AT+CSSLCFG,
   * AT+HTTPPARA, AT+HTTPACTION, etc.) against your real modem firmware before trusting it in the
   * automated loop() — the same technique that caught the CGNSSINFO field-index bug on this board.
   */
  dbg("[debug] AT PASSTHROUGH MODE — type/send raw AT commands directly to the modem now.");
  dbg("[debug] e.g. AT+CGDCONT=1,\"IP\",\"internet\"  then  AT+CGACT=1,1  then try the AT+HTTP* sequence by hand.");
  while (true) {
    while (Serial.available()) {
      ModemSerial.write((uint8_t)Serial.read());
    }
    while (ModemSerial.available()) {
      Serial.write((uint8_t)ModemSerial.read());
    }
  }
#endif

  dbg("[loop] POST interval (ms): ");
  Serial.println(POST_INTERVAL_MS);
}

void loop() {
  if (imeiCached.length() != 15) {
    dbg("[modem] still no IMEI (never got a usable AT response in setup) — reset the board (RST) "
        "to retry modem init; this loop iteration otherwise does nothing.");
    delay(POST_INTERVAL_MS);
    return;
  }

  if (!cellularEnsure()) {
    delay(POST_INTERVAL_MS);
    return;
  }

  double lat = 0.0;
  double lon = 0.0;
  float speedKph = 0.0f;
  int sats = 0;
  double outLat = 0.0;
  double outLon = 0.0;

#if DEBUG_CELLULAR_ONLY_POST
  lat = TEST_LAT;
  lon = TEST_LON;
  speedKph = 0.0f;
  sats = 99;
  outLat = lat;
  outLon = lon;
  Serial.println(F("[debug] DEBUG_CELLULAR_ONLY_POST — skipping GNSS, using TEST_LAT/TEST_LON"));
#else
  if (!readGnssFix(lat, lon, speedKph, sats)) {
    smoothReset();
    Serial.print(F("[gps] waiting for fix (need >= "));
    Serial.print(GPS_MIN_SATS);
    Serial.println(F(" sats) — go outside / lower GPS_MIN_SATS in config.h / enable DEBUG_CELLULAR_ONLY_POST"));
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

  if (!httpsPostTelemetry(outLat, outLon, speedKph)) {
    dbg("[https] will retry");
  }

  delay(POST_INTERVAL_MS);
}
