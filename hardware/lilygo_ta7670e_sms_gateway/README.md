# LilyGO T-A7670E — SMS-fallback GPS receiving gateway

This is **not** a bus tracker. It's a second, physically separate T-A7670E board whose only job is
to receive the emergency GPS SMS that `lilygo_ta7670e_cellular_telemetry` sends when its own
mobile-data telemetry fails, and hand it off to Admin_Backend.

## Why a dedicated receiving modem

Per the project's explicit architecture decision: the backend server cannot receive a cellular SMS
by itself. SMS is **not** routed through IPROG (Admin_Backend's outbound-only SMS service), an
Android SMS-forwarding app, or the attendant's phone. Instead:

```
LILYGO tracker's own SIM --SMS--> THIS gateway's SIM --USB serial--> smsGpsReceiver.js (on the
Admin_Backend host) --> Admin_Backend --> MongoDB --> Socket.IO --> Admin/Passenger apps
```

This board reuses the exact same verified power-on sequence as `lilygo_ta7670e_cellular_telemetry`
(same board family, same pins) — copied, not shared via a library, matching this project's existing
convention of copying verified per-board code between sketches.

## ⚠️ Verify before trusting

The `AT+CMGF=1` → `AT+CNMI` → `AT+CMGL="REC UNREAD"` → `AT+CMGR` → `AT+CMGD` sequence is confirmed
against SIMCom's official A76XX AT Command Manual and LilyGO's own `SendSMS.ino` example for this
board family — but there is an **open, unresolved GitHub issue**
(`Xinyuan-LilyGO/LilyGo-Modem-Series#247`, "A7670E failing SendSMS example") of `AT+CMGF=1`
returning `ERROR` on a real T-A7670E board running this exact sequence.

Before trusting this gateway in the field:

1. Set `DEBUG_AT_PASSTHROUGH 1` in `config.h`, flash, open Serial at 115200.
2. By hand, run: `AT+CMGF=1` → `AT+CPMS="ME","ME","ME"` → `AT+CNMI=2,1,0,0,0` → send a real test
   SMS to this board's SIM from another phone → `AT+CMGL="REC UNREAD"` → `AT+CMGR=<index>` →
   `AT+CMGD=<index>`, watching each raw reply.
3. If `AT+CMGF=1` errors, this is a confirmed hardware/firmware limitation on your unit — report it
   rather than assuming the gateway works. If it succeeds, confirm the `AT+CMGR` reply's quoted-field
   layout matches what `parseCmgr()` in the `.ino` expects (sender is the **second** quoted field,
   the SMS-center timestamp is the third) before trusting the automated loop.
4. Set `DEBUG_AT_PASSTHROUGH` back to `0`.

If `AT+CMGF=1` fails, the automated sketch (as shipped) logs the failure clearly and halts rather
than looping forever on a command that will never succeed — it will not silently pretend to work.

## Behaviour

1. Power-on + AT bring-up (identical to the tracker sketch).
2. `AT+CMGF=1` (text mode) — halts with a clear error if this fails (see above).
3. `AT+CPMS="ME","ME","ME"` — logs storage capacity.
4. `AT+CNMI=2,1,0,0,0` — defense-in-depth new-message indication; the primary mechanism is the poll
   loop below, not this URC.
5. Every `SMS_POLL_INTERVAL_MS` (default 3000ms): `AT+CMGL="REC UNREAD"` → for each message index:
   `AT+CMGR=<index>` to read sender + body, print one `SMSRX {json}` line over USB Serial, then
   `AT+CMGD=<index>` to delete it (prevents storage exhaustion and reprocessing).

## Line protocol (what the host reads)

One line per received SMS, over the same USB-serial connection used to flash/monitor this board:

```
SMSRX {"sender":"+639171234567","body":"BTGPS|BUS-001|7.864321|125.045678|42.5|87|2026-09-08T02:15:30Z","modemTimestamp":"26/09/08,10:15:32+32","rssi":-91}
```

Any other line (e.g. `[gw] ...` diagnostics) is not `SMSRX`-prefixed and is ignored by the host
parser.

## Setup

1. Copy `config.h.example` → `config.h`.
2. Insert a SIM with an active number and SMS capability. This SIM's number is what you register on
   each tracker unit's `SMS_GATEWAY_NUMBER` config field.
3. Arduino Library Manager: **ArduinoJson** (v6+).
4. Board: ESP32 (your LilyGO T-A7670E variant).
5. Flash, open Serial at 115200, confirm IMEI and `AT+CMGF=1 OK`.
6. Plug this board's USB into the machine running Admin_Backend, note the serial port path (e.g.
   `COM5` on Windows, `/dev/ttyUSB0` on Linux/Pi), set `SMS_GATEWAY_SERIAL_PORT` in
   `Backend/Admin_Backend/.env` to that path.
7. Register each tracker's SMS sender number against its `IngestDevice` row (its OWN SIM's E.164
   number) via `PATCH /api/fleet/devices/:deviceId { "smsSenderNumber": "+63..." }` — this is the
   allowlist `services/smsGpsReceiver.js` checks; an SMS from an unregistered number is rejected.

## Physical install

Keep this board powered and connected wherever Admin_Backend actually runs (a Windows PC during
local dev, or the Raspberry Pi in production per `deploy/raspberry-pi/README.md`) — if it's
unplugged or the process restarts and can't reopen the serial port, `smsGpsReceiver.js` retries
every 10s and logs clearly; it never crashes the server.
