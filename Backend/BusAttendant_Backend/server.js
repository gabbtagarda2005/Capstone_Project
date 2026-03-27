const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const PORT = Number(process.env.BUS_ATTENDANT_PORT || 4011);
const JWT_SECRET = String(process.env.BUS_ATTENDANT_JWT_SECRET || "change-this-secret");
const ADMIN_BACKEND_URL = String(process.env.ADMIN_BACKEND_URL || "http://127.0.0.1:4001").replace(/\/+$/, "");

const app = express();
app.use(cors());
app.use(express.json());

const passengers = [
  { id: "PAX-1001", name: "Ana Lopez", category: "regular", lastTrip: "Malaybalay → Valencia" },
  { id: "PAX-1002", name: "Jose Dela Cruz", category: "student", lastTrip: "Valencia → Maramag" },
  { id: "PAX-1003", name: "Rita Flores", category: "senior", lastTrip: "Maramag → Don Carlos" },
];

const issuedTickets = [
  {
    id: "T-9001",
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
      const to = setTimeout(() => ctrl.abort(), 10_000);
      const upstream = await fetch(`${ADMIN_BACKEND_URL}/api/auth/operator-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
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
      return res.json({
        token,
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

app.get("/api/dashboard/summary", auth, (req, res) => {
  const mine = issuedTickets.filter((t) => t.issuedBy === req.user.sub);
  const today = new Date();
  const isSameDay = (iso) => {
    const d = new Date(iso);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };
  const todayTickets = mine.filter((t) => isSameDay(t.createdAt));
  const revenue = todayTickets.reduce((sum, t) => sum + Number(t.fare || 0), 0);
  res.json({
    busNumber: req.user.busNumber || "BUK-000",
    todayTickets: todayTickets.length,
    todayRevenue: revenue,
    activePassengers: passengers.length,
    topRoute: "Malaybalay ↔ Valencia",
  });
});

app.get("/api/passengers", auth, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const filtered = q
    ? passengers.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    : passengers;
  res.json({ items: filtered });
});

app.get("/api/tickets/recent", auth, (req, res) => {
  const mine = issuedTickets
    .filter((t) => t.issuedBy === req.user.sub)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ items: mine.slice(0, 40) });
});

app.post("/api/tickets/issue", auth, (req, res) => {
  const passengerId = String(req.body?.passengerId || "").trim();
  const passengerName = String(req.body?.passengerName || "").trim();
  const from = String(req.body?.from || "").trim();
  const to = String(req.body?.to || "").trim();
  const category = String(req.body?.category || "regular").trim().toLowerCase();
  const fare = Number(req.body?.fare);
  if (!passengerId || !passengerName || !from || !to || !Number.isFinite(fare) || fare < 0) {
    return res.status(400).json({ error: "passengerId, passengerName, from, to and valid fare are required" });
  }
  const row = {
    id: `T-${Date.now()}`,
    passengerId,
    passengerName,
    from,
    to,
    category,
    fare: Math.round(fare * 100) / 100,
    issuedBy: req.user.sub,
    createdAt: new Date().toISOString(),
  };
  issuedTickets.push(row);
  res.status(201).json(row);
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

app.listen(PORT, () => {
  console.log(`Bus Attendant backend listening on http://localhost:${PORT}`);
});

