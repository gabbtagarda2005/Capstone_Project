# Distributed IoT architecture — how the pieces talk

The system is a **distributed IoT ecosystem**: the **bus (hardware)**, the **brains (services)**, and the **users (apps)** exchange data over HTTP and WebSockets.

---

## 1. `services/` — the brains

Node.js / Express APIs: data, rules, and security — no UI.

| Service | Role |
|---------|------|
| **admin-api** | Fleet + GPS ingest, geofence / proximity hooks, anomalies, **Socket.io** for live map movement. Primary receiver for LilyGo pings. |
| **operator-api** | Bus attendant: ticketing validation, check-ins, passenger counts (to be wired). |
| **user-api** | Lighter passenger-facing API: accounts, favorites, feedback (to be wired or merged as you prefer). |

---

## 2. `apps/` — the faces

| App | Role |
|-----|------|
| **admin-portal** (React) | Talks to **admin-api**; Google Maps shows **`gps_logs`** as moving markers; subscribes to Socket.io. |
| **passenger-web** (React/Vite) | ETAs, routes; may download operator APK link. |
| **operator-mobile** (Flutter) | Talks to **operator-api**; QR / manual boarding. |

---

## 3. `hardware/` & `shared/`

| Path | Role |
|------|------|
| **hardware/** | LilyGo C++ firmware; sends GPS **pings** to **admin-api**. |
| **shared/scripts/** | Operational tools (e.g. backup / restore). |

---

## 4. admin-api file map

| Path | Purpose |
|------|---------|
| `models/Bus.js`, `Driver.js` | Mongoose rules for MongoDB documents (plate as string, etc.). |
| `models/GpsLog.js`, `models/GpsHistory.js` | Live row vs breadcrumb history. |
| `routes/buses.js` | HTTP for **GET /api/buses/live**, **POST /api/buses/ping** (device ingest). |
| `routes/reports.js` | Report / anomaly endpoints (extend with aggregations). |
| `services/webPushService.js` | Push when bus is near a stop (FCM / Web Push — stub). |
| `services/proximityWorker.js` | Periodic geofence checks (stub interval; add `geofences` queries). |
| `sockets/socket.js` | **locationUpdate** broadcast after each successful ping. |
| `middleware/firebaseAuth.js` | Optional Firebase token verification when configured. |
| `.env` | `MONGODB_URI`, `PORT`, `CORS_ORIGIN`, `DEVICE_INGEST_SECRET`, etc. |

---

## 5. Data flow (one ping)

1. **Ping** — LilyGo POSTs to **admin-api** → `routes/buses.js` (`POST /api/buses/ping`).
2. **Save** — Upsert **`gps_logs`**, append **`gps_history`** in MongoDB.
3. **Check** — `proximityWorker` (when implemented) tests against **`geofences`** → **`geofence_events`**.
4. **Broadcast** — `sockets/socket.js` emits **`locationUpdate`** to **admin-portal** and **passenger-web**.
5. **View** — React clients move the bus icon on the map without refresh.

---

## 6. First step to wake the stack

```bash
cd Backend/Admin_Backend
copy .env.example .env
# Set MONGODB_URI (and optional DEVICE_INGEST_SECRET)

npm install
npm run dev
```

Health: `GET http://localhost:4001/health`  
Live map data: `GET http://localhost:4001/api/buses/live`

See also: [`mongodb-collections.md`](mongodb-collections.md).
