# Capstone — Bukidnon Bus Tracking & Management

Monorepo layout for client apps, APIs, shared assets, and LilyGo firmware.

## Folder map

| Path | Role |
|------|------|
| `Frontend/Admin_Frontend` | Admin dashboard (Vite + React): landing → login → dashboard; calls `admin-api` |
| `Frontend/Passenger_Frontend` | Passenger marketing + trip search UI (Vite + React, port **5174**) |
| `apps/operator-mobile` | Operator mobile (e.g. Flutter): ticketing / field tools |
| `Backend/Admin_Backend` | **Brain:** MongoDB (GPS) + **MySQL (ticketing)** + JWT admin auth + Socket.io (Node `admin-api`) |
| `services/operator-api` | Operator ticketing API (placeholder) |
| `services/user-api` | Optional lightweight passenger API (add if you split from admin-api) |
| `shared/docs` | Architecture & API notes |
| `shared/scripts` | Backup, restore, deployment helpers |
| `hardware` | LilyGo GPS firmware (C++) |

## Data flow (real-time tracking)

Full IoT map: **[`shared/docs/distributed-iot-architecture.md`](shared/docs/distributed-iot-architecture.md)**.

1. **LilyGo** POSTs GPS payloads to **`admin-api`** (`POST /api/buses/ping`).
2. **admin-api** upserts **`gps_logs`**, appends **`gps_history`** in **MongoDB Atlas**.
3. **proximityWorker** (stub) will evaluate **geofences**; **webPushService** (stub) can notify passengers.
4. **Socket.io** emits **`locationUpdate`** to **admin-portal** and **passenger-web**.
5. **Frontends** move the bus icon on Google Maps without a full refresh.

## Ticketing & admin (SQL)

Relational tables (`bus_operators`, `tickets`, `login_logs`, `locations`), foreign keys, and example “View operator” queries: **[`shared/docs/relational-ticketing-schema.md`](shared/docs/relational-ticketing-schema.md)**.

**Admin UI rebuild** (dashboard stats, passenger table, filters, operator cards, View page, SQL notes): **[`shared/docs/admin-panel-rebuild.md`](shared/docs/admin-panel-rebuild.md)**.

**Run admin UI:** `cd Frontend/Admin_Frontend && copy .env.example .env && npm install && npm run dev` (port 5173). Flow: **/** landing → **Go to login** → **/login** → **/dashboard** (JWT).

**Run passenger app:** `cd Frontend/Passenger_Frontend && npm install && npm run dev` (port **5174**). **`/`** = DgenKit-style landing + trip search; **`/dashboard`** = passenger module grid, metrics, live updates panel (demo data; wire to APIs).

**Admin login (pick one):**

- **MongoDB only** (no MySQL): set `MONGODB_URI` + `JWT_SECRET` in `Backend/Admin_Backend/.env`. Do **not** set `MYSQL_HOST`. Run `node Backend/Admin_Backend/scripts/seed-admin-mongo.js your@email.com YourPassword` (whitelist email). Login uses collection **`portal_users`**.
- **MySQL ticketing:** set `MYSQL_*`, `JWT_SECRET`, import [`Backend/Admin_Backend/sql/ticketing-schema.sql`](Backend/Admin_Backend/sql/ticketing-schema.sql) and [`Backend/Admin_Backend/sql/admin_password_resets.sql`](Backend/Admin_Backend/sql/admin_password_resets.sql), then `node Backend/Admin_Backend/scripts/seed-admin.js your@email.com YourPassword`. If `MYSQL_*` is set, login uses **`bus_operators`** (MySQL takes priority).

**Admin login whitelist** (enforced on login, JWT routes, and forgot-password): only `2301108330@student.buksu.edu.ph` and `bukidnonbuscompany2025@gmail.com` — see [`Backend/Admin_Backend/config/adminWhitelist.js`](Backend/Admin_Backend/config/adminWhitelist.js). Seed one of these emails so password checks succeed.

- Admin creates operator accounts; operator issues tickets with **`issued_by_operator_id`** + **`issued_by_name`** (avoids “N/A” in lists).
- **`locations`** feeds start/destination dropdowns; **`created_at`** + **`fare`** power filters and revenue totals.
- **Theme**: light/dark; ensure placeholder and dropdown contrast in both themes.

## MongoDB collections (your Atlas database)

Detailed roles, groupings (fleet, GPS, IoT, security, comms), and end-to-end flow: **[`shared/docs/mongodb-collections.md`](shared/docs/mongodb-collections.md)**.

Point `MONGODB_URI` at the database that contains these collections (see `Backend/Admin_Backend/.env.example`).

## Run admin-api (wake the GPS + map pipeline)

```bash
cd Backend/Admin_Backend
copy .env.example .env
# Edit .env: MONGODB_URI, MYSQL_*, JWT_SECRET; optional DEVICE_INGEST_SECRET

npm install
npm run dev
```

- Health: `GET http://localhost:4001/health` (shows `mysqlTicketing`: connected | disabled | error)
- Live positions: `GET http://localhost:4001/api/buses/live`
- Device ping: `POST http://localhost:4001/api/buses/ping` with JSON `{ "busId": "BUS-01", "latitude": 8.15, "longitude": 125.12 }`
- Admin auth: `POST /api/auth/login` · Operators CRUD: `/api/operators` · Tickets: `/api/tickets`, `/api/tickets/stats` · Locations: `/api/locations`

## Run everything locally (Windows)

From the project root, double-click **`shared/scripts/start-all.bat`** or run:

`powershell -ExecutionPolicy Bypass -File shared/scripts/start-all.ps1`

That installs npm dependencies (if needed) and opens **three** windows: **admin-api** (4001), **Admin_Frontend** (5173), **Passenger_Frontend** (5174). Requires **Node.js** on your PATH.

## Optional

- `docker-compose.yml` — add when you containerize services and apps.
