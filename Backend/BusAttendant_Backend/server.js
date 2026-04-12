const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const PORT = Number(process.env.BUS_ATTENDANT_PORT || 4011);
const JWT_SECRET = String(process.env.BUS_ATTENDANT_JWT_SECRET || "change-this-secret");
const ADMIN_BACKEND_URL = String(process.env.ADMIN_BACKEND_URL || "http://127.0.0.1:4001").replace(/\/+$/, "");

const app = express();

// Chrome/Edge: page at http://localhost:50015 calling http://127.0.0.1:4011 triggers
// Private Network Access preflight; without this header the browser blocks login (failed fetch).
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Ticket-Issuer-Token", "X-Ticket-Edit-Token"],
    exposedHeaders: ["Content-Type"],
    optionsSuccessStatus: 204,
  })
);
app.use(express.json());

const passengers = [
  { id: "PAX-1001", name: "Ana Lopez", category: "regular", lastTrip: "Malaybalay → Valencia" },
  { id: "PAX-1002", name: "Jose Dela Cruz", category: "student", lastTrip: "Valencia → Maramag" },
  { id: "PAX-1003", name: "Rita Flores", category: "senior", lastTrip: "Maramag → Don Carlos" },
];

const issuedTickets = [
  {
    id: "T-9001",
    ticketCode: "BT-9001",
    passengerId: "PAX-1001",
    passengerName: "Ana Lopez",
    from: "Malaybalay",
    to: "Valencia",
    category: "regular",
    fare: 45,
    issuedBy: "att-001",
    createdAt: new Date().toISOString(),
  },
];

function auth(req, res, next) {
  const hdr = String(req.headers.authorization || "");
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bus-attendant-backend", now: new Date().toISOString() });
});

/** Same payload as Admin — lets mobile/web clients poll via attendant port (single origin). */
app.get("/api/public/maintenance-status", (_req, res) => {
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/public/maintenance-status`, {
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/json");
      res.send(text);
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "maintenance-status proxy failed",
      });
    }
  })();
});

/** Admin command-center broadcast for attendants — same JSON as Admin_Backend. */
app.get("/api/public/broadcast/attendant", (_req, res) => {
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/public/broadcast/attendant`, {
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/json");
      res.send(text);
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "broadcast proxy failed",
      });
    }
  })();
});

/** Proxied rain advisories for hubs defined in Admin Location Management (Open-Meteo). */
app.get("/api/public/weather-advisories", (_req, res) => {
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/public/weather-advisories`, {
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/json");
      res.send(text);
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "weather-advisories proxy failed",
      });
    }
  })();
});

app.get("/api/public/company-profile", (_req, res) => {
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/public/company-profile`, {
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/json");
      res.send(text);
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "company-profile proxy failed",
      });
    }
  })();
});

app.post("/api/auth/operator-login", (req, res) => {
  (async () => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      // Validate credentials against Admin backend so only admin-added attendants can sign in.
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 22_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/auth/operator-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        if (upstream.status === 503 && payload && payload.maintenance === true) {
          return res.status(503).json(payload);
        }
        return res.status(upstream.status || 401).json({
          error: payload?.error || "Invalid credentials",
        });
      }

      const user = payload?.user || {};
      const userId = String(user.id || user.operatorId || email);
      const role = String(user.role || "Operator");
      const firstName = String(user.firstName || "").trim();
      const lastName = String(user.lastName || "").trim();
      const busNumber = String(user.busNumber || "").trim() || "BUK-000";

      const token = jwt.sign(
        {
          sub: userId,
          email,
          role,
          busNumber,
          displayName: `${firstName} ${lastName}`.trim() || email,
        },
        JWT_SECRET,
        { expiresIn: "12h" }
      );
      const adminOperatorJwt =
        typeof payload?.token === "string" && payload.token.trim().length > 0 ? payload.token.trim() : null;
      if (!adminOperatorJwt) {
        return res.status(502).json({
          error:
            "Admin operator-login returned no JWT. The attendant app cannot sync GPS without it — check Admin_Backend is running and POST /api/auth/operator-login returns a `token` field.",
        });
      }

      return res.json({
        token,
        ticketingToken: adminOperatorJwt,
        user: {
          id: userId,
          firstName,
          lastName,
          email,
          role,
          busNumber,
        },
      });
    } catch (e) {
      return res.status(502).json({
        error: `Could not validate login with admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "upstream auth failed",
      });
    }
  })();
});

function proxyJsonToAdmin(reqPath, req, res) {
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 25_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}${reqPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {}),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        res.send(text);
      } else {
        try {
          const j = JSON.parse(text);
          res.json(j);
        } catch {
          res.json({ error: text || "Upstream error", status: upstream.status });
        }
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "proxy failed",
      });
    }
  })();
}

app.post("/api/auth/operator-forgot-password", (req, res) => {
  proxyJsonToAdmin("/api/auth/operator-forgot-password", req, res);
});

app.post("/api/auth/operator-forgot-email", (req, res) => {
  proxyJsonToAdmin("/api/auth/operator-forgot-email", req, res);
});

app.post("/api/auth/operator-forgot-password-otp", (req, res) => {
  proxyJsonToAdmin("/api/auth/operator-forgot-password-otp", req, res);
});

app.post("/api/auth/operator-verify-reset-otp", (req, res) => {
  proxyJsonToAdmin("/api/auth/operator-verify-reset-otp", req, res);
});

app.post("/api/auth/operator-reset-password-token", (req, res) => {
  proxyJsonToAdmin("/api/auth/operator-reset-password-token", req, res);
});

app.post("/api/auth/operator-reset-password", (req, res) => {
  proxyJsonToAdmin("/api/auth/operator-reset-password", req, res);
});

async function fetchAdminRecentTicketItems(opTok) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 18_000);
  try {
    const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/tickets/recent/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${opTok}` },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const text = await upstream.text();
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      return [];
    }
    if (!upstream.ok) return [];
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    clearTimeout(to);
    return [];
  }
}

app.get("/api/dashboard/summary", auth, (req, res) => {
  (async () => {
    const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
    const sub = String(req.user?.sub || "");
    const today = new Date();
    const isSameDay = (iso) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return false;
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    };

    let items = [];
    if (opTok) {
      items = await fetchAdminRecentTicketItems(opTok);
    }
    if (!items.length) {
      items = issuedTickets
        .filter((t) => String(t.issuedBy) === sub)
        .map((t) => ({
          from: t.from,
          to: t.to,
          fare: t.fare,
          passengerId: t.passengerId,
          createdAt: t.createdAt,
        }));
    }

    const todayItems = items.filter((t) => isSameDay(t.createdAt));
    const todayRevenue = todayItems.reduce((sum, t) => sum + Number(t.fare || 0), 0);

    const paxIds = new Set();
    for (const t of todayItems) {
      const id = String(t.passengerId || "").trim();
      if (id) paxIds.add(id);
    }
    const activePassengers = paxIds.size > 0 ? paxIds.size : todayItems.length;

    const countRoutes = (list) => {
      const m = new Map();
      for (const t of list) {
        const a = String(t.from || "").trim();
        const b = String(t.to || "").trim();
        if (!a && !b) continue;
        const k = `${a} → ${b}`;
        m.set(k, (m.get(k) || 0) + 1);
      }
      return m;
    };

    let topRoute = "—";
    let best = 0;
    const todayRoutes = countRoutes(todayItems);
    for (const [k, c] of todayRoutes) {
      if (c > best) {
        best = c;
        topRoute = k;
      }
    }
    if (best === 0 && items.length) {
      const allRoutes = countRoutes(items);
      for (const [k, c] of allRoutes) {
        if (c > best) {
          best = c;
          topRoute = k;
        }
      }
    }
    if (topRoute === "—") topRoute = "No routes yet";

    res.json({
      busNumber: req.user.busNumber || "BUK-000",
      todayTickets: todayItems.length,
      todayRevenue,
      activePassengers,
      topRoute,
    });
  })().catch((e) => res.status(500).json({ error: e.message || "dashboard summary failed" }));
});

app.get("/api/passengers", auth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const filtered = q
    ? passengers.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    : passengers;
  res.json({ items: filtered });
});

app.get("/api/meta/deployed-points", auth, (req, res) => {
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/public/deployed-points`, {
        method: "GET",
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        if (upstream.status === 503 && payload && payload.maintenance === true) {
          return res.status(503).json(payload);
        }
        return res.status(upstream.status || 502).json({
          error: payload?.error || "Could not load deployed points",
        });
      }
      const rawItems = Array.isArray(payload?.items) ? payload.items : [];
      const items = rawItems
        .map((x) => {
          const locationName = String(x.locationName || "").trim();
          const terminalName = String(x.terminalName || "").trim();
          const name = terminalName || locationName;
          if (!name && !locationName) return null;
          const stops = Array.isArray(x.stops)
            ? x.stops
                .map((s) => ({
                  name: String(s?.name || "").trim(),
                  sequence: Number.isFinite(Number(s?.sequence)) ? Number(s.sequence) : 0,
                  latitude: Number(s?.latitude),
                  longitude: Number(s?.longitude),
                  geofenceRadiusM: Number.isFinite(Number(s?.geofenceRadiusM)) ? Number(s.geofenceRadiusM) : 100,
                }))
                .filter((s) => s.name && Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
                .sort((a, b) => a.sequence - b.sequence)
            : [];
          const t = x.terminal;
          let terminal = null;
          if (t && String(t.name || "").trim()) {
            const lat = Number(t.latitude);
            const lng = Number(t.longitude);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              terminal = {
                name: String(t.name || "").trim(),
                latitude: lat,
                longitude: lng,
                geofenceRadiusM: Number.isFinite(Number(t.geofenceRadiusM)) ? Number(t.geofenceRadiusM) : 500,
              };
            }
          }
          const corridorGeofences = Array.isArray(x.corridorGeofences)
            ? x.corridorGeofences
                .map((g) => ({
                  kind: String(g?.kind || "").trim(),
                  name: String(g?.name || "").trim(),
                  latitude: Number(g?.latitude),
                  longitude: Number(g?.longitude),
                  radiusM: Number.isFinite(Number(g?.radiusM)) ? Number(g.radiusM) : 100,
                  sequence: Number.isFinite(Number(g?.sequence)) ? Number(g.sequence) : undefined,
                }))
                .filter((g) => g.name && Number.isFinite(g.latitude) && Number.isFinite(g.longitude))
            : [];
          return {
            id: String(x.id || name || locationName),
            name: name || locationName,
            locationName,
            terminalName,
            pointType: String(x.pointType || "terminal"),
            updatedAt: x.updatedAt || null,
            terminal,
            stops,
            corridorGeofences,
          };
        })
        .filter(Boolean);
      return res.json({ items });
    } catch (e) {
      return res.status(502).json({
        error: `Could not load deployed points from admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "upstream request failed",
      });
    }
  })();
});

function proxyTicketingToAdmin(req, res, { method, adminPath, jsonBody }) {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  if (!opTok) {
    return res.status(400).json({
      error: "X-Ticket-Issuer-Token required — sign out and sign in again to refresh your session.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 35_000);
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opTok}`,
      };
      const editTok = String(req.headers["x-ticket-edit-token"] || "").trim();
      if (editTok) headers["X-Ticket-Edit-Token"] = editTok;
      const opts = {
        method,
        headers,
        signal: ctrl.signal,
      };
      if (jsonBody != null && method !== "GET" && method !== "HEAD") {
        opts.body = JSON.stringify(jsonBody);
      }
      const upstream = await fetch(`${ADMIN_BACKEND_URL}${adminPath}`, opts);
      clearTimeout(to);
      const text = await upstream.text();
      let upstreamJson = null;
      try {
        upstreamJson = text ? JSON.parse(text) : null;
      } catch {
        upstreamJson = null;
      }

      const upstreamErr = typeof upstreamJson?.error === "string" ? upstreamJson.error.toLowerCase() : "";
      // Admin often returns HTTP 200 + { ticketingDisabled: true, items: [] } when MySQL is off; only POST issue used to return 501.
      // Without this branch, tickets are stored locally on issue but GET /recent/me stays empty.
      const ticketingDisabled =
        upstreamJson?.ticketingDisabled === true ||
        ((upstream.status === 503 || upstream.status === 501) &&
          (upstreamErr.includes("mysql") ||
            upstreamErr.includes("ticketing") ||
            upstreamErr.includes("mongo-only")));

      // Mongo-only environments: keep attendant ticket flow working with local fallback storage.
      if (ticketingDisabled && method === "POST" && adminPath === "/api/tickets/issue") {
        const b = jsonBody || {};
        const idNum = Date.now();
        const local = {
          id: String(idNum),
          ticketCode: `TKT-${idNum}`,
          passengerId: String(b.passengerId || "").trim(),
          passengerName: String(b.passengerName || "").trim() || "Walk-in Passenger",
          from: String(b.startLocation || "").trim(),
          to: String(b.destination || "").trim(),
          category: String(b.passengerCategory || "regular").trim().toLowerCase(),
          fare: Number(b.fare || 0),
          issuedBy: String(req.user?.sub || "att-local"),
          busNumber: String(b.busNumber || req.user?.busNumber || "").trim() || null,
          createdAt: new Date().toISOString(),
        };
        issuedTickets.unshift(local);
        return res.status(201).json(local);
      }

      if (ticketingDisabled && method === "GET" && adminPath === "/api/tickets/recent/me") {
        const mine = issuedTickets.filter((t) => String(t.issuedBy) === String(req.user?.sub || ""));
        return res.json({
          items: mine.slice(0, 60).map((t) => ({
            id: String(t.id),
            ticketCode: String(t.ticketCode || `TKT-${t.id}`),
            passengerId: String(t.passengerId || ""),
            passengerName: String(t.passengerName || "Passenger"),
            from: String(t.from || ""),
            to: String(t.to || ""),
            category: String(t.category || "regular"),
            fare: Number(t.fare || 0),
            busNumber: t.busNumber || null,
            createdAt: t.createdAt || null,
          })),
        });
      }

      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.send(text || JSON.stringify(upstreamJson || {}));
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.send(text);
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "ticketing proxy failed",
      });
    }
  })();
}

app.get("/api/tickets/recent", auth, (req, res) => {
  proxyTicketingToAdmin(req, res, { method: "GET", adminPath: "/api/tickets/recent/me", jsonBody: null });
});

app.post("/api/fares/quote", auth, (req, res) => {
  proxyTicketingToAdmin(req, res, {
    method: "POST",
    adminPath: "/api/fares/quote",
    jsonBody: req.body || {},
  });
});

app.post("/api/tickets/issue", auth, (req, res) => {
  const b = req.body || {};
  const passengerId = String(b.passengerId || "").trim();
  const passengerName = String(b.passengerName || "").trim();
  const from = String(b.from || b.startLocation || "").trim();
  const to = String(b.to || b.destination || "").trim();
  const category = String(b.category || b.passengerCategory || "regular").trim().toLowerCase();
  const fare = Number(b.fare);
  const busNumber = b.busNumber != null && String(b.busNumber).trim() ? String(b.busNumber).trim() : undefined;
  if (!passengerId || !passengerName || !from || !to || !Number.isFinite(fare) || fare < 0) {
    return res.status(400).json({ error: "passengerId, passengerName, from, to and valid fare are required" });
  }
  const adminBody = {
    passengerId,
    passengerName,
    startLocation: from,
    destination: to,
    fare,
    passengerCategory: category,
    issuedByName: b.issuedByName,
    busNumber,
  };
  proxyTicketingToAdmin(req, res, { method: "POST", adminPath: "/api/tickets/issue", jsonBody: adminBody });
});

app.post("/api/tickets/verify-edit-pin", auth, (req, res) => {
  proxyTicketingToAdmin(req, res, { method: "POST", adminPath: "/api/tickets/verify-edit-pin", jsonBody: req.body || {} });
});

app.patch("/api/tickets/:id", auth, (req, res) => {
  const id = encodeURIComponent(String(req.params.id || ""));
  proxyTicketingToAdmin(req, res, { method: "PATCH", adminPath: `/api/tickets/${id}`, jsonBody: req.body || {} });
});

app.get("/api/profile/me", auth, (req, res) => {
  const display = String(req.user.displayName || "").trim();
  const first = display ? display.split(" ")[0] : "Bus";
  const last = display ? display.split(" ").slice(1).join(" ") : "Attendant";
  res.json({
    id: String(req.user.sub || ""),
    firstName: first,
    lastName: last,
    email: String(req.user.email || ""),
    role: String(req.user.role || "Bus Attendant"),
    busNumber: String(req.user.busNumber || "BUK-000"),
    phone: "0991-577-4040",
  });
});

/**
 * Source-of-truth profile for attendant HUD (proxied from Admin backend).
 * Requires `X-Ticket-Issuer-Token` which is the operator JWT returned on login as `ticketingToken`.
 */
app.get("/api/staff-profile", auth, (req, res) => {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  if (!opTok) {
    return res.status(400).json({
      error: "X-Ticket-Issuer-Token required — sign out and sign in again to refresh your session.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/staff-profile`, {
        method: "GET",
        headers: { Authorization: `Bearer ${opTok}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.send(text);
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ error: text || "Upstream error", status: upstream.status });
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "proxy failed",
      });
    }
  })();
});

app.get("/api/staff-shift-summary", auth, (req, res) => {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  if (!opTok) {
    return res.status(400).json({
      error: "X-Ticket-Issuer-Token required — sign out and sign in again to refresh your session.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/staff-shift-summary`, {
        method: "GET",
        headers: { Authorization: `Bearer ${opTok}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.send(text);
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ error: text || "Upstream error", status: upstream.status });
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "proxy failed",
      });
    }
  })();
});

app.get("/api/staff-eta", auth, (req, res) => {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  if (!opTok) {
    return res.status(400).json({
      error: "X-Ticket-Issuer-Token required — sign out and sign in again to refresh your session.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/staff-eta`, {
        method: "GET",
        headers: { Authorization: `Bearer ${opTok}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.send(text);
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ error: text || "Upstream error", status: upstream.status });
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "proxy failed",
      });
    }
  })();
});

/** Proxies to Admin with operator JWT (X-Ticket-Issuer-Token) — see login response `ticketingToken`. */
app.get("/api/bus-assignment", auth, (req, res) => {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  if (!opTok) {
    return res.status(400).json({
      error: "X-Ticket-Issuer-Token required — sign out and sign in again to refresh your session.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/buses/assignment/me`, {
        method: "GET",
        headers: { Authorization: `Bearer ${opTok}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.send(text);
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ error: text || "Upstream error", status: upstream.status });
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "proxy failed",
      });
    }
  })();
});

/**
 * Staff profile + assigned bus (Command Center live fleet). Spec: GET /api/staff/profile.
 * Merges local JWT claims with Admin assignment when X-Ticket-Issuer-Token is present.
 */
app.get("/api/staff/profile", auth, (req, res) => {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  const display = String(req.user.displayName || "").trim();
  const parts = display.split(/\s+/).filter(Boolean);
  const staff = {
    id: String(req.user.sub || ""),
    email: String(req.user.email || ""),
    role: String(req.user.role || "Operator"),
    busNumber: String(req.user.busNumber || "BUK-000"),
    firstName: parts.length ? parts[0] : "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
    displayName: display || String(req.user.email || ""),
  };
  if (!opTok) {
    return res.status(200).json({
      staff,
      assignment: { assigned: false, bus: null },
      bus_id: null,
      warning: "X-Ticket-Issuer-Token missing — sign in again for assignment + live fleet socket.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/buses/assignment/me`, {
        method: "GET",
        headers: { Authorization: `Bearer ${opTok}` },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const payload = await upstream.json().catch(() => ({}));
      const assigned = !!payload?.assigned;
      const bus = payload?.bus ?? null;
      const bus_id = bus?.busId != null ? String(bus.busId) : null;
      res.status(200).json({
        staff,
        assignment: { assigned, bus },
        bus_id,
      });
    } catch (e) {
      res.status(502).json({
        staff,
        assignment: { assigned: false, bus: null },
        bus_id: null,
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "assignment fetch failed",
      });
    }
  })();
});

function proxyAttendantGpsToAdmin(adminPath, req, res) {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  if (!opTok) {
    return res.status(400).json({
      error: "X-Ticket-Issuer-Token required — sign out and sign in again.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}${adminPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opTok}`,
        },
        body: JSON.stringify(req.body || {}),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      if (upstream.status === 204) {
        return res.end();
      }
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.send(text);
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ error: text || "Upstream error", status: upstream.status });
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "proxy failed",
      });
    }
  })();
}

app.post("/api/bus-attendant-ping", auth, (req, res) => {
  proxyAttendantGpsToAdmin("/api/buses/attendant-ping", req, res);
});

/** Product alias — same payload as bus-attendant-ping → Admin `/api/buses/live-location`. */
app.post("/api/live-location", auth, (req, res) => {
  proxyAttendantGpsToAdmin("/api/buses/live-location", req, res);
});

app.post("/api/live-location/batch", auth, (req, res) => {
  proxyAttendantGpsToAdmin("/api/buses/live-location/batch", req, res);
});

/** End shift / sign-out — removes attendant's bus from Admin live map (gps_logs). */
app.post("/api/live-session/end", auth, (req, res) => {
  proxyAttendantGpsToAdmin("/api/buses/live-session/end", req, res);
});

function proxyPostToAdminAttendant(path, req, res) {
  const opTok = String(req.headers["x-ticket-issuer-token"] || "").trim();
  if (!opTok) {
    return res.status(400).json({
      error: "X-Ticket-Issuer-Token required — sign out and sign in again.",
    });
  }
  (async () => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 22_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opTok}`,
        },
        body: JSON.stringify(req.body || {}),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const text = await upstream.text();
      res.status(upstream.status);
      if (upstream.status === 204) {
        return res.end();
      }
      const ct = upstream.headers.get("content-type");
      if (ct && ct.includes("application/json")) {
        res.setHeader("Content-Type", "application/json");
        return res.send(text);
      }
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.json({ error: text || "Upstream error", status: upstream.status });
      }
    } catch (e) {
      res.status(502).json({
        error: `Could not reach admin backend (${ADMIN_BACKEND_URL})`,
        detail: e.message || "proxy failed",
      });
    }
  })();
}

app.post("/api/bus-attendant-sos", auth, (req, res) => {
  proxyPostToAdminAttendant("/api/buses/attendant-sos", req, res);
});

app.post("/api/bus-attendant-incident", auth, (req, res) => {
  proxyPostToAdminAttendant("/api/buses/attendant-incident", req, res);
});

app.use("/api", (req, res) => {
  const sub = String(req.path || "").replace(/\/+$/, "") || "/";
  if (req.method === "POST" && sub === "/fares/quote") {
    return res.status(503).json({
      error:
        "Fare quote is not available on this Bus Attendant API process. Another (older) service may be bound to this port — stop it and restart Backend/BusAttendant_Backend/server.js from the current project, then retry.",
    });
  }
  res.status(404).json({
    error: `Unknown route ${req.method} ${req.originalUrl} on bus attendant API.`,
  });
});

app.listen(PORT, () => {
  console.log(`Bus Attendant backend listening on http://localhost:${PORT} (admin: ${ADMIN_BACKEND_URL})`);
  console.log(`  POST /api/auth/operator-forgot-password-otp → admin`);
  console.log(`  POST /api/fares/quote → admin (ticket-issuer JWT)`);
});

