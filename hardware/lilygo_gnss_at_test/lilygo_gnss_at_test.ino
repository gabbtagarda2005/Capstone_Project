/*
 * LilyGO (A7670E / SIM7670-class modem) — GPS / GNSS test for Arduino IDE
 *
 * What it does:
 *   - Opens Serial Monitor @ 115200 (USB debug)
 *   - Talks to the cellular modem on UART (GNSS is inside the modem on many LilyGO boards)
 *   - Sends AT+CGNSSPWR=1 then repeats AT+CGNSSINFO every 2 seconds
 *   - Prints everything the modem sends back
 *
 * Success: you see +CGNSSINFO: ... with real lat/lon (not 0.000000) after going outside with sky view.
 *
 * If you see nothing: wrong UART RX/TX pins for YOUR board — change MODEM_RX / MODEM_TX below.
 * Some boards use 26/27 or 5/4 — check your LilyGO schematic.
 */

// ---------------------------------------------------------------------------
// Match these to YOUR board (ESP32 ↔ A7670E UART)
// ---------------------------------------------------------------------------
#define MODEM_RX_PIN 32
#define MODEM_TX_PIN 33
#define MODEM_BAUD 115200

#include <Arduino.h>

HardwareSerial ModemSerial(1);

static void modemFlush() {
  while (ModemSerial.available()) {
    ModemSerial.read();
  }
}

/** Send AT command and copy modem reply to USB Serial until timeout. */
static void sendAtAndPrint(const char *cmd, uint32_t waitMs) {
  modemFlush();
  Serial.println();
  Serial.print(F(">> "));
  Serial.println(cmd);

  ModemSerial.print(cmd);
  ModemSerial.print("\r\n");

  uint32_t t0 = millis();
  while (millis() - t0 < waitMs) {
    while (ModemSerial.available()) {
      Serial.write(ModemSerial.read());
    }
    delay(2);
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println(F("\n\n========== LilyGO GNSS modem test =========="));
  Serial.print(F("Baud: 115200 | Pins RX="));
  Serial.print(MODEM_RX_PIN);
  Serial.print(F(" TX="));
  Serial.print(MODEM_TX_PIN);
  Serial.println(F("\n(If garbled or silent, fix RX/TX in the sketch.)\n"));

  ModemSerial.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(800);

  sendAtAndPrint("AT", 800);
  sendAtAndPrint("ATE0", 800);

  Serial.println(F("--- IMEI (AT+CGSN) — register this in Admin Fleet ---"));
  sendAtAndPrint("AT+CGSN", 2000);

  Serial.println(F("--- Power GNSS (AT+CGNSSPWR=1) ---"));
  sendAtAndPrint("AT+CGNSSPWR=1", 3000);

  Serial.println(F("\nWaiting 15s for first satellite search (go near a window or outside)...\n"));
  delay(15000);
}

void loop() {
  Serial.println(F("---------- AT+CGNSSINFO ----------"));
  sendAtAndPrint("AT+CGNSSINFO", 4000);

  Serial.println(F("---------- AT+CSQ (signal) ----------"));
  sendAtAndPrint("AT+CSQ", 2000);

  Serial.println(F("\nNext read in 2 seconds...\n"));
  delay(2000);
}
