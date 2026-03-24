# MongoDB collections — roles and system flow

This document describes how Atlas collections fit together for the Bukidnon bus tracking and management system.

---

## 1. Core fleet logic

These collections manage physical assets and who is driving them.

### `buses`

Central registry: static info such as plate number, bus ID, and current status (e.g. Active / Maintenance).

### `busassignmenthistories`

Historical record of which driver was assigned to which bus on a given date. Used for accountability (reports, incidents).

---

## 2. Real-time GPS engine

Highest-traffic collections where LilyGo data lands.

### `gps_logs`

**Live** store: typically the latest coordinate per bus (or the row the map reads first) so the admin map stays fast.

### `gps_history`

**Breadcrumb** store: every ping over time, enabling route replay (yesterday, last week, etc.).

### `geofences`

Digital boundaries (circles or polygons) around stops, terminals, or regions in Bukidnon.

### `geofence_events`

Automation log: when a bus **entered** or **exited** a geofence (e.g. “at stop”). Feeds “bus is arriving” style notifications for passengers.

---

## 3. IoT and hardware management

Over-the-air (OTA) control of LilyGo devices without physical access.

### `firmware_releases`

Binaries or version metadata (e.g. v1.0.2) for C++ firmware.

### `firmware_updates`

Per-bus rollout state: which units updated successfully vs which still run older firmware.

---

## 4. Security and user access

System gatekeeping.

### `permissions`

Capability matrix: what an Admin, Driver, or Passenger may do.

### `otps`, `emailverifications`, `phoneverifications`

Layers for login, registration, and verification flows.

### `passwordresets`

Short-lived tokens for forgotten-password flows.

---

## 5. Communication and system health

### `feedbacks`

Passenger ratings or complaints tied to trips or services.

### `sms_logs`

Outbound SMS audit (e.g. OTPs, alerts) — useful for cost and delivery tracking.

### `systemsettings`

Global toggles and parameters, e.g. GPS **ping rate** (seconds between updates), maintenance mode.

---

## System flow (when a bus moves)

1. **LilyGo** sends coordinates → **`gps_logs`** (updates the live map) and **`gps_history`** (append the path).
2. **Backend** evaluates **`geofences`** → if the bus is inside a stop/zone, create a **`geofence_event`**.
3. **`geofence_event`** can trigger notifications to users (passenger-facing tables / channels).
4. If something goes wrong, **`busassignmenthistories`** ties the incident window to the **driver** assigned to that **bus**.

---

## Quick index (all names)

`busassignmenthistories`, `buses`, `emailverifications`, `feedbacks`, `firmware_releases`, `firmware_updates`, `geofence_events`, `geofences`, `gps_history`, `gps_logs`, `otps`, `passwordresets`, `permissions`, `phoneverifications`, `sms_logs`, `systemsettings`
