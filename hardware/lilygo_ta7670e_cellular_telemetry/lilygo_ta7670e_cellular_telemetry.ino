/**
 * LilyGO T-A7670E — cellular (SIM/GPRS) HTTPS telemetry + SMS emergency fallback, for
 * Admin_Backend (field / on-bus deployment, hardware-backup GPS source).
 *
 * GPS priority on this project: Bus Attendant phone (primary, 3s cadence, separate app) >
 * THIS DEVICE over mobile-data/HTTPS (backup, 5s cadence) > THIS DEVICE over SMS (emergency-only
 * fallback, 15s cadence, active ONLY while mobile-data telemetry is confirmed failing). The
 * backend's gpsSourceArbiter.js is what actually decides which source is "live" on the map; this
 * firmware's job is just to report faithfully and pick the best transport it can reach.
 *
 * Explicit state machine (see DeviceState below): SIM_CHECK -> NETWORK_REGISTER -> PDP_CONNECT ->
 * (first boot only) GNSS_START -> GNSS_WAIT_FIX -> TELEMETRY_SEND <-> TELEMETRY_SUCCESS /
 * TELEMETRY_FAILED -> SMS_FALLBACK (only after MOBILE_FAIL_CONFIRM_COUNT consecutive HTTPS
 * failures, i.e. NOT on the first failure) -> back to PDP_CONNECT once mobile data recovers.
 * GNSS acquisition itself is an always-on background poll independent of this state machine (once
 * past the one-time boot gate) — the pipeline states just read the latest fix.
 *
 * - GNSS from AT+CGNSSINFO — identical power-on sequence and parser to lilygo_ta7670e_wifi_telemetry
 *   (see parseCgnssinfo() below for how the CSV field layout was verified on this exact chip;
 *   heading/course (field index 13) is a NEW extraction NOT yet verified the same way — bench-check
 *   it against real direction of travel before trusting it, same discipline as the speed field).
 * - Network: AT+CGDCONT / AT+CGATT / AT+CGACT (standard 3GPP PDP context attach — high confidence,
 *   universal across cellular modems).
 * - Upload: HTTPS via the modem's OWN AT+HTTP* + AT+CSSLCFG command set (SIMCom A76XX HTTP(S)
 *   Application), NOT TinyGSM — TinyGSM's own SIM7600 driver explicitly does not support SSL
 *   ("SSL not yet supported on this module!" in its source). The modem does the TLS handshake
 *   itself in its own firmware; the ESP32 never sees raw TLS bytes. The exact AT+HTTP-family and
 *   AT+CSSLCFG sequence has NOT been confirmed against the primary SIMCom AT command manual for your specific
 *   firmware build — use DEBUG_AT_PASSTHROUGH to hand-verify it first.
 * - SMS fallback: AT+CMGF=1 (text mode) -> AT+CMGS="<number>" -> message + Ctrl+Z(0x1A), confirmed
 *   against SIMCom's official A76XX AT Command Manual (CMGF/CMGS) and LilyGO's own SendSMS.ino
 *   example for this board family. IMPORTANT: there is an open, unresolved GitHub issue
 *   (Xinyuan-LilyGO/LilyGo-Modem-Series#247, "A7670E failing SendSMS example") of AT+CMGF=1
 *   returning ERROR on a real T-A7670E board running this exact sequence — this firmware treats
 *   that as a real possibility, not a bug: it logs clearly, does not crash, does not retry more
 *   than once per SMS_CMGF_RETRY_COOLDOWN_MS, and keeps trying mobile-data telemetry regardless.
 *   DO NOT trust SMS fallback works on your unit until you have bench-verified AT+CMGF=1 actually
 *   returns OK via DEBUG_AT_PASSTHROUGH.
 *
 * Certificate verification: CSSLCFG authmode defaults to 0 (skip server cert verification) —
 * traffic is still encrypted, but the modem does not cryptographically confirm it's really talking
 * to your Pi. The real authentication is the per-device x-device-id/x-device-key credential (or the
 * legacy DEVICE_INGEST_SECRET), checked server-side on every request regardless of TLS.
 *
 * Copy config.h.example -> config.h
 * Libraries: ArduinoJson (v6+)
 *
 * Backend success: HTTP 204 (or 200/201). Set DEVICE_ID/DEVICE_KEY to match a device registered
 * via POST /api/fleet/devices (preferred) or DEVICE_INGEST_SECRET to match Admin_Backend .env.
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
#define POST_INTERVAL_MS 5000
#endif
#ifndef SMS_INTERVAL_MS
#define SMS_INTERVAL_MS 15000
#endif
#ifndef MOBILE_FAIL_CONFIRM_COUNT
#define MOBILE_FAIL_CONFIRM_COUNT 2
#endif
#ifndef PDP_FAIL_CONFIRM_COUNT
#define PDP_FAIL_CONFIRM_COUNT 2
#endif
#ifndef SMS_PDP_RECHECK_MS
#define SMS_PDP_RECHECK_MS 30000
#endif
#ifndef SMS_CMGF_RETRY_COOLDOWN_MS
#define SMS_CMGF_RETRY_COOLDOWN_MS 60000
#endif
#ifndef SMS_FAIL_ABANDON_COUNT
#define SMS_FAIL_ABANDON_COUNT 5
#endif
#ifndef SMS_RETRY_BACKOFF_MS
#define SMS_RETRY_BACKOFF_MS 30000
#endif
#ifndef TELEMETRY_BUFFER_SIZE
#define TELEMETRY_BUFFER_SIZE 20
#endif
#ifndef BUFFER_FLUSH_GAP_MS
#define BUFFER_FLUSH_GAP_MS 250
#endif
#ifndef GNSS_POLL_INTERVAL_MS
#define GNSS_POLL_INTERVAL_MS 2000
#endif
#ifndef NETWORK_REGISTER_TIMEOUT_MS
#define NETWORK_REGISTER_TIMEOUT_MS 60000
#endif
#ifndef RETRY_BACKOFF_BASE_MS
#define RETRY_BACKOFF_BASE_MS 3000
#endif
#ifndef RETRY_BACKOFF_MAX_MS
#define RETRY_BACKOFF_MAX_MS 30000
#endif
#ifndef GNSS_SPEED_FIELD_INDEX
#define GNSS_SPEED_FIELD_INDEX 12
#endif
#ifndef GNSS_COURSE_FIELD_INDEX
#define GNSS_COURSE_FIELD_INDEX 13
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
#ifndef DEVICE_ID
#define DEVICE_ID ""
#endif
#ifndef DEVICE_KEY
#define DEVICE_KEY ""
#endif
#ifndef DEVICE_INGEST_SECRET
#define DEVICE_INGEST_SECRET ""
#endif
#ifndef SMS_GATEWAY_NUMBER
#define SMS_GATEWAY_NUMBER ""
#endif
#ifndef BUS_ID_LABEL
#define BUS_ID_LABEL ""
#endif

/**
 * Declared here (top of file, ahead of every function) rather than near their first use —
 * Arduino's build system auto-generates function prototypes and inserts them right after the
 * #include lines, before anything else in the file. A function taking one of these enums as a
 * parameter would otherwise get a prototype inserted before the enum itself is visible, which
 * fails to compile ("FailureReason was not declared in this scope"). Custom types used as
 * function parameters must be declared this early in an .ino file for that reason.
 */
enum DeviceState {
  ST_SIM_CHECK,
  ST_NETWORK_REGISTER,
  ST_PDP_CONNECT,
  ST_GNSS_START,
  ST_GNSS_WAIT_FIX,
  ST_TELEMETRY_SEND,
  ST_TELEMETRY_SUCCESS,
  ST_TELEMETRY_FAILED,
  ST_SMS_FALLBACK,
  ST_RETRY
};

/** Granular failure classification — never collapse every problem into one generic error. */
enum FailureReason {
  FAIL_NONE,
  FAIL_GNSS_UNAVAILABLE,
  FAIL_SIM_UNAVAILABLE,
  FAIL_CELL_UNAVAILABLE,
  FAIL_PDP_UNAVAILABLE,
  FAIL_HTTPS_FAILED,
  FAIL_BACKEND_UNAVAILABLE,
  FAIL_SMS_FAILED
};

/**
 * T-A7670 boards gate the modem's entire power rail behind BOARD_POWERON_PIN — without driving it
 * HIGH first, the modem is physically unpowered. Verified against LilyGO's own official example for
 * this exact board (Xinyuan-LilyGO/LilyGO-T-A76XX, examples/Network/Network.ino). Unchanged from the
 * already-working version of this sketch — do not modify without re-verifying on hardware.
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

static void gpsLog(const char *msg) {
  Serial.print(F("[GPS] "));
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

/** NMEA-style DDMM.MMMM or DDDMM.MMMM -> decimal degrees (SIMCom-style GNSS fields). */
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
 * Same layout verified on this exact chip/firmware (see hardware_ta7670e_board project memory):
 *   +CGNSSINFO: <mode>,<GPS-sats>,<GLONASS-sats>,<BeiDou-sats>,<extra>,<lat>,<N/S>,<lon>,<E/W>,
 *               <date>,<time>,<alt>,<speed>,<course>,<PDOP>,<HDOP>,<VDOP>
 * (lat at index 5, N/S at 6, lon at 7, E/W at 8, speed at 12 — these ARE verified against real
 * hardware via live NMEA comparison). Course/heading at index 13 is a NEW extraction added for
 * this sketch's failover feature and is NOT yet verified the same way — bench-check it (compare
 * against real direction of travel) before trusting it operationally.
 */
static bool parseCgnssinfo(const String &resp, double &lat, double &lon, float &speedKph, float &heading, int &sats) {
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

  heading = 0.0f;
  if (n > GNSS_COURSE_FIELD_INDEX) {
    float c = parts[GNSS_COURSE_FIELD_INDEX].toFloat();
    if (c >= 0.0f && c <= 360.0f) {
      heading = c;
    }
  }

  return true;
}

static bool gnssPowerOn() {
  String r = modemExchange("AT+CGNSSPWR=1", 5000);
  return r.indexOf("OK") >= 0 || r.indexOf("ok") >= 0;
}

static bool readGnssFix(double &lat, double &lon, float &speedKph, float &heading, int &sats) {
  String r = modemExchange("AT+CGNSSINFO", 4000);
  if (parseCgnssinfo(r, lat, lon, speedKph, heading, sats)) {
    return true;
  }
#if GNSS_RAW_DEBUG
  Serial.println(F("[gps] parse failed — raw modem reply (check CSV layout vs parseCgnssinfo):"));
  Serial.println(r);
  Serial.println();
#endif
  return false;
}

/** AT+CSQ -> +CSQ: <rssi>,<ber>; rssi 99 = unknown. dBm = -113 + 2*rssi (standard GSM 07.07 scale). */
static bool getSignalRssiDbm(int &dbmOut) {
  String r = modemExchange("AT+CSQ", 2000);
  int p = r.indexOf("+CSQ:");
  if (p < 0) return false;
  String rest = r.substring(p + 5);
  rest.trim();
  int comma = rest.indexOf(',');
  String rssiStr = comma >= 0 ? rest.substring(0, comma) : rest;
  rssiStr.trim();
  int rssi = rssiStr.toInt();
  if (rssi < 0 || rssi == 99) return false;
  dbmOut = -113 + 2 * rssi;
  return true;
}

// -----------------------------------------------------------------------------
// SIM / cellular network / PDP — each a single non-blocking-per-call attempt; the state machine in
// loop() owns retry timing so no function here blocks for more than one bounded AT exchange.
// -----------------------------------------------------------------------------
static bool simReady() {
  String r = modemExchange("AT+CPIN?", 3000);
  return r.indexOf("+CPIN: READY") >= 0;
}

static bool cellularRegistered() {
  String r = modemExchange("AT+CGREG?", 3000);
  return r.indexOf(",1") >= 0 || r.indexOf(",5") >= 0;
}

/** One attempt at PDP context activation — caller (state machine) handles retry/backoff. */
static bool pdpConnectAttempt() {
  String cgdcont = String("AT+CGDCONT=1,\"IP\",\"") + CELL_APN + "\"";
  modemExchange(cgdcont.c_str(), 2000);

  String act = modemExchange("AT+CGACT?", 3000);
  if (act.indexOf("+CGACT: 1,1") >= 0) {
    return true;
  }
  String r = modemExchange("AT+CGACT=1,1", 15000);
  return r.indexOf("OK") >= 0;
}

// -----------------------------------------------------------------------------
// HTTPS upload via the modem's own AT+HTTP*/AT+CSSLCFG engine (TinyGSM has no SSL support on this
// chip family — see file header comment). See file header for verification caveats.
// -----------------------------------------------------------------------------

/** Wait for a specific token (e.g. "DOWNLOAD", ">", or a URC prefix) in raw modem output. */
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

/** AT+HTTPDATA=<len>,<timeout> -> wait "DOWNLOAD" prompt -> write raw body bytes -> wait final OK. */
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

/** AT+HTTPACTION=<method> -> immediate OK, then async "+HTTPACTION: <method>,<code>,<len>" URC. */
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

static const char *failureReasonName(FailureReason r) {
  switch (r) {
    case FAIL_GNSS_UNAVAILABLE: return "GNSS_UNAVAILABLE";
    case FAIL_SIM_UNAVAILABLE: return "SIM_UNAVAILABLE";
    case FAIL_CELL_UNAVAILABLE: return "CELL_UNAVAILABLE";
    case FAIL_PDP_UNAVAILABLE: return "PDP_UNAVAILABLE";
    case FAIL_HTTPS_FAILED: return "HTTPS_FAILED";
    case FAIL_BACKEND_UNAVAILABLE: return "BACKEND_UNAVAILABLE";
    case FAIL_SMS_FAILED: return "SMS_FAILED";
    default: return "NONE";
  }
}

/**
 * POST one telemetry record. recordedAtIso may be "" (live send — server assigns arrival time) or
 * a GNSS-derived ISO8601 string (ring-buffer replay — preserves the fix's true original time so
 * the backend's dedup key stays meaningful).
 */
static bool httpsPostTelemetry(double lat, double lon, float speedKph, float heading, const String &recordedAtIso, FailureReason &failOut) {
  failOut = FAIL_NONE;
  if (imeiCached.length() != 15) {
    failOut = FAIL_HTTPS_FAILED;
    return false;
  }

  int rssiDbm;
  bool haveRssi = getSignalRssiDbm(rssiDbm);

  StaticJsonDocument<512> doc;
  doc["imei"] = imeiCached;
  if (strlen(DEVICE_ID) > 0) doc["deviceId"] = DEVICE_ID;
  doc["lat"] = round(lat * 1.0e7) / 1.0e7;
  doc["lng"] = round(lon * 1.0e7) / 1.0e7;
  doc["speedKph"] = speedKph;
  doc["heading"] = (int)round(heading);
  doc["net"] = "cellular";
  if (haveRssi) doc["signal_strength"] = rssiDbm;
  doc["voltage"] = nullptr;  // no verified battery-ADC pin on this board — send null, not a guess
  if (recordedAtIso.length() > 0) doc["recordedAt"] = recordedAtIso;
  doc["source"] = "hardware";
  doc["transport"] = "cellular";

  String payload;
  payload.reserve(384);
  if (serializeJson(doc, payload) == 0) {
    failOut = FAIL_HTTPS_FAILED;
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
    failOut = FAIL_HTTPS_FAILED;
    return false;
  }

  modemExchange("AT+HTTPPARA=\"CID\",1", 1000);
  modemExchange("AT+HTTPPARA=\"SSL\",1,0", 1000);  // enable SSL for this session, bound to ctx 0
  {
    String sni = String("AT+HTTPPARA=\"SNI\",\"") + SERVER_HOST + "\"";
    modemExchange(sni.c_str(), 1000);
  }
  // Auth is appended as a URL query string, not only sent via USERDATA below — confirmed on a real
  // T-A7670E-FASE unit (firmware A011B07A7670M7_F) that AT+HTTPPARA="USERDATA",... errors
  // unconditionally on that build (as do "CID"/"SSL"/"SNI" above — harmless no-ops, this sketch
  // tolerates them failing), so a header-only credential would silently never reach the server on
  // that hardware. The query string is the one channel every AT+HTTP engine variant seen so far
  // accepts, since "URL" is the one AT+HTTPPARA key that has always worked. Query values here are
  // hex/opaque tokens (crypto.randomBytes(...).toString("hex")) with no characters needing escaping.
  {
    String qs;
    if (strlen(DEVICE_ID) > 0 && strlen(DEVICE_KEY) > 0) {
      qs = String("device_id=") + DEVICE_ID + "&device_key=" + DEVICE_KEY;
    } else if (strlen(DEVICE_INGEST_SECRET) > 0) {
      qs = String("device_secret=") + DEVICE_INGEST_SECRET;
    }
    String url = String("AT+HTTPPARA=\"URL\",\"") + (SERVER_USE_TLS ? "https://" : "http://") + SERVER_HOST;
    if ((SERVER_USE_TLS && SERVER_PORT != 443) || (!SERVER_USE_TLS && SERVER_PORT != 80)) {
      url += ":" + String(SERVER_PORT);
    }
    url += String(SERVER_PATH);
    if (qs.length() > 0) {
      url += "?" + qs;
    }
    url += "\"";
    modemExchange(url.c_str(), 2000);
  }
  modemExchange("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);
  {
    // Best-effort header attempt too, for modem firmware where USERDATA actually works (cleaner
    // than a query string) — harmless no-op on firmware where it errors, per the comment above.
    String userdata;
    if (strlen(DEVICE_ID) > 0 && strlen(DEVICE_KEY) > 0) {
      userdata = String("x-device-id: ") + DEVICE_ID + "\r\nx-device-key: " + DEVICE_KEY + "\r\n";
    } else if (strlen(DEVICE_INGEST_SECRET) > 0) {
      userdata = String("x-device-secret: ") + DEVICE_INGEST_SECRET + "\r\n";
    }
    if (userdata.length() > 0) {
      String hdr = String("AT+HTTPPARA=\"USERDATA\",\"") + userdata + "\"";
      modemExchange(hdr.c_str(), 1000);
    }
  }

  if (!httpSendBody(payload, 10000)) {
    modemExchange("AT+HTTPTERM", 1000);
    failOut = FAIL_HTTPS_FAILED;
    return false;
  }

  int code = 0;
  bool gotResponse = httpAction(1 /* POST */, code);
  modemExchange("AT+HTTPTERM", 1000);

  if (!gotResponse) {
    dbg("[https] request failed (no response / timeout)");
    failOut = FAIL_BACKEND_UNAVAILABLE;
    return false;
  }

  Serial.print(F("HTTP response code: "));
  Serial.println(code);
  if (code == 401) {
    dbg("[hint] 401 = device credential mismatch — verify DEVICE_ID/DEVICE_KEY or DEVICE_INGEST_SECRET.");
  }
  if (code == 404) {
    dbg("[hint] 404 = IMEI not in Fleet — add this IMEI to the bus in Admin");
  }
  if (code == 400) {
    dbg("[hint] 400 = missing lat/lng or imei in JSON");
  }
  if (code == 0) {
    dbg("[hint] 0 = TCP/TLS connect failed — check SERVER_HOST/PORT reachable, SSL authmode, SNI");
    failOut = FAIL_HTTPS_FAILED;
    return false;
  }

  if (code == 200 || code == 201 || code == 204) {
    return true;
  }
  failOut = code >= 500 ? FAIL_BACKEND_UNAVAILABLE : FAIL_HTTPS_FAILED;
  return false;
}

// -----------------------------------------------------------------------------
// SMS emergency fallback — see file header for the AT+CMGF=1 risk (GitHub #247) this is designed
// around. Text mode is confirmed at most once per SMS_CMGF_RETRY_COOLDOWN_MS so a modem firmware
// that doesn't support it doesn't get hammered every SMS_FALLBACK cycle.
// -----------------------------------------------------------------------------
static bool gSmsTextModeConfirmed = false;
static uint32_t gLastCmgfAttemptMs = 0;

static bool smsEnsureTextMode() {
  if (gSmsTextModeConfirmed) return true;
  uint32_t now = millis();
  if (gLastCmgfAttemptMs != 0 && now - gLastCmgfAttemptMs < SMS_CMGF_RETRY_COOLDOWN_MS) {
    return false;  // still in cooldown from a previous failed attempt
  }
  gLastCmgfAttemptMs = now;
  String r = modemExchange("AT+CMGF=1", 3000);
  if (r.indexOf("OK") >= 0) {
    gSmsTextModeConfirmed = true;
    return true;
  }
  Serial.println(
      F("[fw][ERROR][SMS_FAILED] AT+CMGF=1 returned ERROR — SMS text mode not supported by this "
        "modem firmware build (see Xinyuan-LilyGO/LilyGo-Modem-Series#247). SMS fallback disabled "
        "this cycle; will retry text-mode set again after cooldown."));
  return false;
}

/** AT+CMGS="<number>" -> wait "&gt;" prompt -> write body + Ctrl+Z -> wait "+CMGS:". */
static bool sendGpsSms(double lat, double lon, float speedKph, float heading, const String &recordedAtIso) {
  if (!smsEnsureTextMode()) {
    return false;
  }
  if (strlen(SMS_GATEWAY_NUMBER) == 0 || strlen(BUS_ID_LABEL) == 0) {
    dbg("[fw][ERROR][SMS_FAILED] SMS_GATEWAY_NUMBER or BUS_ID_LABEL not configured");
    return false;
  }

  String body = String("BTGPS|") + BUS_ID_LABEL + "|" + String(lat, 6) + "|" + String(lon, 6) + "|" +
                String(speedKph, 1) + "|" + String((int)round(heading)) + "|" +
                (recordedAtIso.length() > 0 ? recordedAtIso : String("unknown"));

  modemFlush();
  ModemSerial.print("AT+CMGS=\"");
  ModemSerial.print(SMS_GATEWAY_NUMBER);
  ModemSerial.println("\"");

  if (!waitForToken(">", 5000, nullptr)) {
    dbg("[fw][ERROR][SMS_FAILED] no CMGS prompt — aborting without sending Ctrl+Z");
    return false;
  }

  modemFlush();
  ModemSerial.print(body);
  ModemSerial.write((uint8_t)0x1A);  // Ctrl+Z terminates and sends the message

  String reply;
  bool ok = waitForToken("+CMGS:", 15000, &reply);
  if (!ok) {
    dbg("[fw][ERROR][SMS_FAILED] AT+CMGS did not confirm");
    return false;
  }
  gpsLog("SMS GPS sent");
  return true;
}

// -----------------------------------------------------------------------------
// Local store-and-forward ring buffer — fixes buffered here when a live HTTPS send fails, flushed
// oldest-first once mobile-data telemetry is restored. recordedAtIso is built from the GNSS
// module's own UTC date/time fields, giving buffered records a real wall-clock timestamp (no NTP
// needed) so the backend's dedup key (deviceId + recordedAt + lat + lon + source) stays meaningful
// even for a replayed record. No separate idempotency id is added — that key is already unique.
// -----------------------------------------------------------------------------
struct BufferedFix {
  double lat;
  double lon;
  float speedKph;
  float heading;
  String recordedAtIso;
};
static BufferedFix telemetryBuffer[TELEMETRY_BUFFER_SIZE];
static int bufHead = 0;
static int bufCount = 0;

static void bufferPush(double lat, double lon, float speedKph, float heading, const String &recordedAtIso) {
  int writeIdx = (bufHead + bufCount) % TELEMETRY_BUFFER_SIZE;
  if (bufCount == TELEMETRY_BUFFER_SIZE) {
    // Full — overwrite the oldest entry (true ring behavior) and advance head.
    writeIdx = bufHead;
    bufHead = (bufHead + 1) % TELEMETRY_BUFFER_SIZE;
  } else {
    bufCount++;
  }
  telemetryBuffer[writeIdx] = { lat, lon, speedKph, heading, recordedAtIso };
}

/** Drains the buffer oldest-first via live HTTPS sends. Stops (keeping remaining entries) on the
 *  first failure so a still-flaky connection doesn't burn through the whole buffer as failures. */
static void bufferFlush() {
  while (bufCount > 0) {
    BufferedFix &f = telemetryBuffer[bufHead];
    FailureReason fr;
    bool ok = httpsPostTelemetry(f.lat, f.lon, f.speedKph, f.heading, f.recordedAtIso, fr);
    if (!ok) {
      dbg("[fw] buffer flush stopped early — HTTPS send failed, will retry remaining entries later");
      return;
    }
    bufHead = (bufHead + 1) % TELEMETRY_BUFFER_SIZE;
    bufCount--;
    delay(BUFFER_FLUSH_GAP_MS);
  }
}

// -----------------------------------------------------------------------------
// Connectivity/telemetry state machine. GNSS acquisition (below) runs independently once past the
// one-time boot gate (GNSS_START/GNSS_WAIT_FIX) — every other state just reads the latest fix.
// -----------------------------------------------------------------------------
static DeviceState gState = ST_SIM_CHECK;
static DeviceState gRetryTarget = ST_SIM_CHECK;
static DeviceState gRetryBackoffTarget = ST_SIM_CHECK;
static uint32_t gRetryBackoffMs = RETRY_BACKOFF_BASE_MS;
static uint32_t gRetryDeadlineMs = 0;

static bool gGnssStarted = false;   // one-time GNSS_START gate passed
static bool gHasFix = false;
static double gLat = 0.0, gLon = 0.0;
static float gSpeedKph = 0.0f, gHeading = 0.0f;
static int gSats = 0;
static uint32_t gLastGnssPollMs = 0;

static uint32_t gLastTelemetrySendMs = 0;
static int gMobileFailConsecutive = 0;
static int gPdpFailConsecutive = 0;
static FailureReason gLastFailReason = FAIL_NONE;

static uint32_t gLastSmsSendMs = 0;
static uint32_t gLastSmsPdpRecheckMs = 0;
static int gSmsFailConsecutive = 0;

static void enterRetry(DeviceState target) {
  if (gRetryBackoffTarget != target) {
    gRetryBackoffTarget = target;
    gRetryBackoffMs = RETRY_BACKOFF_BASE_MS;
  } else {
    gRetryBackoffMs = min((uint32_t)(gRetryBackoffMs * 2), (uint32_t)RETRY_BACKOFF_MAX_MS);
  }
  gRetryTarget = target;
  gRetryDeadlineMs = millis() + gRetryBackoffMs;
  gState = ST_RETRY;
}

static void resetRetryBackoff(DeviceState succeededTarget) {
  if (gRetryBackoffTarget == succeededTarget) {
    gRetryBackoffMs = RETRY_BACKOFF_BASE_MS;
  }
}

/** Background GNSS poll — independent of connectivity state, runs every GNSS_POLL_INTERVAL_MS once
 *  gGnssStarted is true. Never fabricates coordinates: gHasFix only goes true on a real parsed fix. */
static void maybeUpdateGnssFix() {
  if (!gGnssStarted) return;
  uint32_t now = millis();
  if (now - gLastGnssPollMs < GNSS_POLL_INTERVAL_MS) return;
  gLastGnssPollMs = now;

#if DEBUG_CELLULAR_ONLY_POST
  // Test cellular + HTTPS + IMEI only, skipping real GNSS — uses TEST_LAT/TEST_LON from config.h.
  gLat = TEST_LAT;
  gLon = TEST_LON;
  gSpeedKph = 0.0f;
  gHeading = 0.0f;
  gSats = 99;
  gHasFix = true;
  Serial.println(F("[debug] DEBUG_CELLULAR_ONLY_POST — using TEST_LAT/TEST_LON instead of real GNSS"));
  return;
#endif

  double lat, lon;
  float speedKph, heading;
  int sats;
  if (readGnssFix(lat, lon, speedKph, heading, sats)) {
    smoothPush(lat, lon);
    double outLat = lat, outLon = lon;
    smoothAvg(outLat, outLon);
    gLat = outLat;
    gLon = outLon;
    gSpeedKph = speedKph;
    gHeading = heading;
    gSats = sats;
    gHasFix = true;
  } else {
    smoothReset();
    gHasFix = false;
    Serial.print(F("[gps] waiting for fix (need >= "));
    Serial.print(GPS_MIN_SATS);
    Serial.println(F(" sats)"));
  }
}

/** Builds a GNSS-derived ISO8601 UTC timestamp from +CGNSSINFO's <date>(ddmmyy)/<time>(hhmmss.s)
 *  fields per SIMCom's documented convention — UNVERIFIED against this exact firmware's raw reply
 *  (only lat/lon/N-S/E-W/speed were confirmed via live comparison). If parsing looks implausible,
 *  returns "" rather than fabricating a timestamp — callers then omit recordedAt from the payload
 *  and let the backend assign server-arrival time instead. */
static String buildGnssTimestampIso() {
  String r = modemExchange("AT+CGNSSINFO", 3000);
  int p = r.indexOf("+CGNSSINFO:");
  if (p < 0) return "";
  int lineEnd = r.indexOf('\n', p);
  String line = lineEnd > p ? r.substring(p, lineEnd) : r.substring(p);
  int colon = line.indexOf(':');
  if (colon < 0) return "";
  String payload = line.substring(colon + 1);
  payload.trim();
  String parts[20];
  int n = splitCsv(payload, parts, 20);
  if (n <= 10) return "";
  String dateStr = parts[9];   // ddmmyy
  String timeStr = parts[10];  // hhmmss.s
  if (dateStr.length() != 6 || timeStr.length() < 6) return "";
  for (int i = 0; i < 6; i++) {
    if (!isDigit(dateStr.charAt(i)) || !isDigit(timeStr.charAt(i))) return "";
  }
  int dd = dateStr.substring(0, 2).toInt();
  int mm = dateStr.substring(2, 4).toInt();
  int yy = dateStr.substring(4, 6).toInt();
  int hh = timeStr.substring(0, 2).toInt();
  int mi = timeStr.substring(2, 4).toInt();
  int ss = timeStr.substring(4, 6).toInt();
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || hh > 23 || mi > 59 || ss > 59) return "";
  char buf[26];
  snprintf(buf, sizeof(buf), "20%02d-%02d-%02dT%02d:%02d:%02dZ", yy, mm, dd, hh, mi, ss);
  return String(buf);
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  dbg("");
  dbg("=== LilyGO T-A7670E cellular (SIM) HTTPS telemetry + SMS fallback ===");

  dbg("[modem] power-on sequence (BOARD_POWERON_PIN/RESET/PWRKEY)...");
  powerOnModem();

  ModemSerial.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(800);

  dbg("[modem] waiting for AT response...");
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

#if DEBUG_AT_PASSTHROUGH
  /**
   * Raw bidirectional bridge between USB Serial and the modem UART — use this to hand-verify the
   * HTTPS AT sequence (AT+CSSLCFG, AT+HTTPPARA, AT+HTTPACTION) and the SMS sequence (AT+CMGF,
   * AT+CMGS) against your real modem firmware before trusting the automated state machine below —
   * the same technique that caught the CGNSSINFO field-index bug on this board.
   */
  dbg("[debug] AT PASSTHROUGH MODE — type/send raw AT commands directly to the modem now.");
  while (true) {
    while (Serial.available()) {
      ModemSerial.write((uint8_t)Serial.read());
    }
    while (ModemSerial.available()) {
      Serial.write((uint8_t)ModemSerial.read());
    }
  }
#endif

  gState = ST_SIM_CHECK;
}

void loop() {
  maybeUpdateGnssFix();

  switch (gState) {
    case ST_SIM_CHECK: {
      if (imeiCached.length() != 15) {
        // Never got a usable AT response in setup() — nothing to do until a manual reset.
        delay(1000);
        return;
      }
      if (simReady()) {
        resetRetryBackoff(ST_SIM_CHECK);
        gState = ST_NETWORK_REGISTER;
      } else {
        Serial.println(F("[fw][ERROR][SIM_UNAVAILABLE] AT+CPIN? did not report READY — check SIM inserted / PIN lock"));
        enterRetry(ST_SIM_CHECK);
      }
      break;
    }

    case ST_NETWORK_REGISTER: {
      static uint32_t registerStartMs = 0;
      if (registerStartMs == 0) registerStartMs = millis();
      if (cellularRegistered()) {
        registerStartMs = 0;
        resetRetryBackoff(ST_NETWORK_REGISTER);
        gState = ST_PDP_CONNECT;
      } else if (millis() - registerStartMs > NETWORK_REGISTER_TIMEOUT_MS) {
        registerStartMs = 0;
        Serial.println(F("[fw][ERROR][CELL_UNAVAILABLE] not registered after timeout — check SIM, antenna, signal"));
        enterRetry(ST_NETWORK_REGISTER);
      } else {
        delay(1000);  // bounded wait, still returns to loop() promptly relative to other cadences
      }
      break;
    }

    case ST_PDP_CONNECT: {
      if (pdpConnectAttempt()) {
        gPdpFailConsecutive = 0;
        resetRetryBackoff(ST_PDP_CONNECT);
        gState = gGnssStarted ? ST_TELEMETRY_SEND : ST_GNSS_START;
      } else {
        gPdpFailConsecutive++;
        Serial.println(F("[fw][ERROR][PDP_UNAVAILABLE] AT+CGACT=1,1 failed — check CELL_APN matches your SIM's carrier"));
        if (gPdpFailConsecutive >= PDP_FAIL_CONFIRM_COUNT && gGnssStarted) {
          gState = ST_SMS_FALLBACK;
        } else {
          enterRetry(ST_PDP_CONNECT);
        }
      }
      break;
    }

    case ST_GNSS_START: {
      dbg("[gps] GNSS power-on + multi-constellation...");
      if (!gnssPowerOn()) {
        dbg("[gps] CGNSSPWR may have failed — still trying reads.");
      }
#if GNSS_ENABLE_MULTI_CONSTELLATION
      modemExchange("AT+CGNSSMODE=3", 3000);
#endif
      gGnssStarted = true;
      gLastGnssPollMs = 0;  // poll immediately on the next maybeUpdateGnssFix() call
      gState = ST_GNSS_WAIT_FIX;
      break;
    }

    case ST_GNSS_WAIT_FIX: {
      if (gHasFix) {
        gState = ST_TELEMETRY_SEND;
      } else {
        delay(200);  // maybeUpdateGnssFix() at the top of loop() governs actual poll cadence
      }
      break;
    }

    case ST_TELEMETRY_SEND: {
      uint32_t now = millis();
      if (now - gLastTelemetrySendMs < POST_INTERVAL_MS) {
        delay(50);
        return;
      }
      gLastTelemetrySendMs = now;

      if (!gHasFix) {
        Serial.println(F("[fw][WARN][GNSS_UNAVAILABLE] NO GPS FIX — skipping telemetry send"));
        return;
      }

      String recordedAtIso = buildGnssTimestampIso();
      FailureReason fr;
      bool ok = httpsPostTelemetry(gLat, gLon, gSpeedKph, gHeading, recordedAtIso, fr);
      if (ok) {
        gState = ST_TELEMETRY_SUCCESS;
      } else {
        gLastFailReason = fr;
        bufferPush(gLat, gLon, gSpeedKph, gHeading, recordedAtIso);
        gState = ST_TELEMETRY_FAILED;
      }
      break;
    }

    case ST_TELEMETRY_SUCCESS: {
      bool wasRecovering = gMobileFailConsecutive > 0 || gSmsFailConsecutive > 0;
      if (wasRecovering) {
        gpsLog("Hardware mobile telemetry restored");
      }
      gMobileFailConsecutive = 0;
      gSmsFailConsecutive = 0;
      resetRetryBackoff(ST_TELEMETRY_SEND);
      if (bufCount > 0) {
        dbg("[fw] flushing buffered telemetry...");
        bufferFlush();
      }
      gState = ST_TELEMETRY_SEND;
      break;
    }

    case ST_TELEMETRY_FAILED: {
      Serial.print(F("[fw][ERROR]["));
      Serial.print(failureReasonName(gLastFailReason));
      Serial.println(F("] telemetry send failed"));
      gMobileFailConsecutive++;
      if (gMobileFailConsecutive == 1) {
        gpsLog("Mobile telemetry failed");
      }
      if (gMobileFailConsecutive >= MOBILE_FAIL_CONFIRM_COUNT) {
        gState = ST_SMS_FALLBACK;
      } else {
        enterRetry(ST_TELEMETRY_SEND);
      }
      break;
    }

    case ST_SMS_FALLBACK: {
      static bool announced = false;
      if (!announced) {
        gpsLog("SMS fallback ACTIVATED");
        announced = true;
      }
      uint32_t now = millis();

      // Background PDP recheck — does not interrupt the SMS cadence below.
      if (now - gLastSmsPdpRecheckMs >= SMS_PDP_RECHECK_MS) {
        gLastSmsPdpRecheckMs = now;
        if (pdpConnectAttempt()) {
          announced = false;
          gMobileFailConsecutive = 0;
          gPdpFailConsecutive = 0;
          gpsLog("SMS fallback stopped");
          gState = ST_TELEMETRY_SEND;
          return;
        }
      }

      uint32_t smsIntervalMs = gSmsFailConsecutive >= SMS_FAIL_ABANDON_COUNT ? SMS_RETRY_BACKOFF_MS : SMS_INTERVAL_MS;
      if (now - gLastSmsSendMs < smsIntervalMs) {
        delay(50);
        return;
      }
      gLastSmsSendMs = now;

      if (!gHasFix) {
        Serial.println(F("[fw][WARN][GNSS_UNAVAILABLE] NO GPS FIX — skipping SMS fallback send"));
        return;
      }

      String recordedAtIso = buildGnssTimestampIso();
      // Never send both mobile-data and SMS at once: this state only sends via sendGpsSms(), and
      // ST_TELEMETRY_SEND is only re-entered once this state exits (single gState variable).
      bool ok = sendGpsSms(gLat, gLon, gSpeedKph, gHeading, recordedAtIso);
      if (ok) {
        gSmsFailConsecutive = 0;
      } else {
        gSmsFailConsecutive++;
      }
      break;
    }

    case ST_RETRY: {
      if (millis() >= gRetryDeadlineMs) {
        gState = gRetryTarget;
      } else {
        delay(100);
      }
      break;
    }
  }
}
