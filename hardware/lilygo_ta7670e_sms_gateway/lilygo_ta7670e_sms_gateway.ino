/**
 * LilyGO T-A7670E — dedicated SMS-fallback GPS RECEIVING gateway.
 *
 * This is NOT the bus tracker. It is a second, physically separate T-A7670E unit, installed at the
 * Admin_Backend server location (connected via USB), whose only job is to receive the emergency
 * GPS SMS that lilygo_ta7670e_cellular_telemetry sends when its own mobile-data telemetry fails.
 * It never talks to Admin_Backend directly — it just prints one JSON line per received SMS over
 * USB Serial; Backend/Admin_Backend/services/smsGpsReceiver.js (running on the host machine this
 * board is plugged into) reads that serial port, validates, and ingests it.
 *
 * Architecture (confirmed with the project owner — SMS is NOT routed through IPROG, an Android
 * SMS-forwarder, or the attendant phone):
 *
 *   LILYGO tracker's own SIM --SMS--> THIS gateway's SIM --USB serial--> smsGpsReceiver.js -->
 *   Admin_Backend --> MongoDB --> Socket.IO --> Admin/Passenger apps
 *
 * Reuses the exact same verified power-on sequence and AT-exchange helpers as
 * lilygo_ta7670e_cellular_telemetry (copied, not shared via a library, matching this project's own
 * existing convention of copying verified per-board code between sketches).
 *
 * SMS AT sequence — confirmed against SIMCom's official A76XX AT Command Manual (CMGF/CNMI/CMGL/
 * CMGR/CMGD) and LilyGO's own SendSMS.ino example for this board family. IMPORTANT: there is an
 * open, unresolved GitHub issue (Xinyuan-LilyGO/LilyGo-Modem-Series#247) of AT+CMGF=1 returning
 * ERROR on a real T-A7670E board — bench-verify with DEBUG_AT_PASSTHROUGH (config.h) before
 * trusting this gateway receives anything. If AT+CMGF=1 fails, this sketch logs clearly and stops
 * (rather than looping forever on a command that will never succeed) — it does not crash.
 *
 * Copy config.h.example -> config.h
 * Libraries: ArduinoJson (v6+)
 */

#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"

#ifndef SMS_POLL_INTERVAL_MS
#define SMS_POLL_INTERVAL_MS 3000
#endif
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
#ifndef DEBUG_AT_PASSTHROUGH
#define DEBUG_AT_PASSTHROUGH 0
#endif

/** Identical to lilygo_ta7670e_cellular_telemetry's powerOnModem() — verified on this exact board;
 *  do not modify without re-verifying on hardware. */
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

static void gwLog(const char *msg) {
  Serial.print(F("[gw] "));
  Serial.println(msg);
}

static void modemFlush() {
  while (ModemSerial.available()) {
    ModemSerial.read();
  }
}

/** Same helper as the tracker sketch — send a command, accumulate reply until OK/ERROR/timeout. */
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
      if (acc.length() > 4000) {
        acc.remove(0, 1000);
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

/** Parses every "+CMGL: <index>,..." header line in an AT+CMGL="REC UNREAD" reply into a list of
 *  message indices — UNVERIFIED against this exact firmware's raw reply (standard 3GPP TS 27.005
 *  text-mode format; bench-verify via DEBUG_AT_PASSTHROUGH, see file header). */
static int parseCmglIndices(const String &resp, int *indices, int maxIndices) {
  int count = 0;
  int pos = 0;
  while (count < maxIndices) {
    int p = resp.indexOf("+CMGL:", pos);
    if (p < 0) break;
    int lineEnd = resp.indexOf('\n', p);
    String line = lineEnd > p ? resp.substring(p, lineEnd) : resp.substring(p);
    int colon = line.indexOf(':');
    String rest = colon >= 0 ? line.substring(colon + 1) : "";
    rest.trim();
    int comma = rest.indexOf(',');
    String idxStr = comma >= 0 ? rest.substring(0, comma) : rest;
    idxStr.trim();
    int idx = idxStr.toInt();
    if (idxStr.length() > 0) {
      indices[count++] = idx;
    }
    pos = lineEnd > p ? lineEnd + 1 : p + 6;
  }
  return count;
}

/**
 * Parses an AT+CMGR=<index> reply: header line "+CMGR: "REC UNREAD","<oa>",,"<scts>"" followed by
 * the message body, up to the trailing OK — UNVERIFIED against this exact firmware's raw reply
 * (standard 3GPP TS 27.005 text-mode format; bench-verify via DEBUG_AT_PASSTHROUGH).
 */
static bool parseCmgr(const String &resp, String &senderOut, String &bodyOut, String &scTimestampOut) {
  int p = resp.indexOf("+CMGR:");
  if (p < 0) return false;
  int lineEnd = resp.indexOf('\n', p);
  String headerLine = lineEnd > p ? resp.substring(p, lineEnd) : resp.substring(p);

  int q1 = headerLine.indexOf('"');
  int q1e = q1 >= 0 ? headerLine.indexOf('"', q1 + 1) : -1;
  int q2 = q1e >= 0 ? headerLine.indexOf('"', q1e + 1) : -1;
  int q2e = q2 >= 0 ? headerLine.indexOf('"', q2 + 1) : -1;
  int q3 = q2e >= 0 ? headerLine.indexOf('"', q2e + 1) : -1;
  int q3e = q3 >= 0 ? headerLine.indexOf('"', q3 + 1) : -1;
  if (q2 < 0 || q2e < 0) return false;
  senderOut = headerLine.substring(q2 + 1, q2e);
  scTimestampOut = (q3 >= 0 && q3e >= 0) ? headerLine.substring(q3 + 1, q3e) : "";

  int bodyStart = lineEnd >= 0 ? lineEnd + 1 : resp.length();
  String rest = resp.substring(bodyStart);
  int bodyEnd = rest.indexOf("\r\nOK");
  if (bodyEnd < 0) bodyEnd = rest.indexOf("\nOK");
  if (bodyEnd < 0) bodyEnd = rest.length();
  String body = rest.substring(0, bodyEnd);
  body.trim();
  bodyOut = body;
  return senderOut.length() > 0 && bodyOut.length() > 0;
}

/** Emits one line the host's smsGpsReceiver.js parses: "SMSRX {json}". Uses ArduinoJson to escape
 *  the sender/body/timestamp strings safely rather than hand-building JSON. */
static void emitSmsRxLine(const String &sender, const String &body, const String &scTimestamp, bool haveRssi, int rssiDbm) {
  StaticJsonDocument<512> doc;
  doc["sender"] = sender;
  doc["body"] = body;
  if (scTimestamp.length() > 0) doc["modemTimestamp"] = scTimestamp;
  if (haveRssi) doc["rssi"] = rssiDbm;
  Serial.print("SMSRX ");
  serializeJson(doc, Serial);
  Serial.println();
}

static bool gSmsTextModeReady = false;

void setup() {
  Serial.begin(115200);
  delay(1200);
  gwLog("");
  gwLog("=== LilyGO T-A7670E SMS-fallback GPS receiving gateway ===");

  gwLog("power-on sequence (BOARD_POWERON_PIN/RESET/PWRKEY)...");
  powerOnModem();

  ModemSerial.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(800);

  gwLog("waiting for AT response...");
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
  if (!modemReady) {
    gwLog("no AT response after 20s — check UART pins, modem power, baud rate. Halting.");
    while (true) delay(1000);
  }
  modemExchange("ATE0", 800);

  String imei;
  if (extractImei15(imei)) {
    Serial.print(F("[gw] gateway modem IMEI "));
    Serial.println(imei);
  }

#if DEBUG_AT_PASSTHROUGH
  gwLog("AT PASSTHROUGH MODE — type/send raw AT commands directly to the modem now.");
  gwLog("e.g. AT+CMGF=1  then  AT+CPMS=\"ME\",\"ME\",\"ME\"  then  AT+CNMI=2,1,0,0,0  then AT+CMGL=\"REC UNREAD\"");
  while (true) {
    while (Serial.available()) {
      ModemSerial.write((uint8_t)Serial.read());
    }
    while (ModemSerial.available()) {
      Serial.write((uint8_t)ModemSerial.read());
    }
  }
#endif

  String cmgf = modemExchange("AT+CMGF=1", 3000);
  if (cmgf.indexOf("OK") < 0) {
    gwLog("[ERROR][SMS_UNAVAILABLE] AT+CMGF=1 returned ERROR — this modem firmware build does not");
    gwLog("accept SMS text mode (see Xinyuan-LilyGO/LilyGo-Modem-Series#247). This gateway cannot");
    gwLog("receive SMS-fallback GPS on this hardware. Halting (not looping forever on a dead command).");
    while (true) delay(1000);
  }
  gSmsTextModeReady = true;
  gwLog("AT+CMGF=1 OK — SMS text mode confirmed");

  String cpms = modemExchange("AT+CPMS=\"ME\",\"ME\",\"ME\"", 3000);
  Serial.print(F("[gw] AT+CPMS reply: "));
  Serial.println(cpms);

  modemExchange("AT+CNMI=2,1,0,0,0", 2000);  // defense-in-depth URC config; primary path is the poll loop below

  gwLog("listening for inbound SMS (polling every SMS_POLL_INTERVAL_MS)...");
}

void loop() {
  if (!gSmsTextModeReady) {
    delay(1000);
    return;
  }
  static uint32_t lastPollMs = 0;
  uint32_t now = millis();
  if (now - lastPollMs < SMS_POLL_INTERVAL_MS) {
    return;
  }
  lastPollMs = now;

  String listResp = modemExchange("AT+CMGL=\"REC UNREAD\"", 5000);
  int indices[10];
  int n = parseCmglIndices(listResp, indices, 10);
  for (int i = 0; i < n; i++) {
    String cmd = String("AT+CMGR=") + indices[i];
    String r = modemExchange(cmd.c_str(), 3000);
    String sender, body, scTimestamp;
    if (parseCmgr(r, sender, body, scTimestamp)) {
      int rssiDbm;
      bool haveRssi = getSignalRssiDbm(rssiDbm);
      emitSmsRxLine(sender, body, scTimestamp, haveRssi, rssiDbm);
    } else {
      gwLog("AT+CMGR reply did not parse (unexpected format) — raw reply follows:");
      Serial.println(r);
    }
    // Delete regardless of parse success — a malformed/rejected message must not accumulate in
    // modem storage forever (AT+CPMS capacity is small).
    String delCmd = String("AT+CMGD=") + indices[i];
    modemExchange(delCmd.c_str(), 3000);
  }
}
