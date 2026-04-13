require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || "*";
const corsList =
  corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim());

app.use(
  cors({
    origin: corsList,
  })
);
app.use(express.json());

const PassengerTerminalAffinity = require("./models/PassengerTerminalAffinity");

const io = new Server(server, {
  cors: { origin: corsList },
});

io.on("connection", (socket) => {
  socket.emit("connected", { ok: true });
});

/** Default map center: Malaybalay, Bukidnon */
const DEFAULT_MAP = {
  center: { lat: 8.158, lng: 125.1236 },
  zoom: 11,
  label: "Malaybalay · Bukidnon",
};

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "passenger-api",
    mongo:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.get("/api/passenger/map-config", (_req, res) => {
  res.json({
    ...DEFAULT_MAP,
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
});

/**
 * Log nearest terminal coverage id when a passenger enables location (no coordinates persisted).
 */
app.post("/api/passenger/terminal-affinity", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(204).send();
    }
    const id = String(req.body?.coverageId || "").trim();
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      return res.status(400).json({ error: "Invalid coverageId" });
    }
    await PassengerTerminalAffinity.findOneAndUpdate(
      { coverageId: id },
      { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } },
      { upsert: true, new: true }
    );
    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** Legacy stub — passenger web uses Admin live-board + broadcast via fetchPassengerNotificationFeed. */
app.get("/api/passenger/notifications", (_req, res) => {
  res.json({ items: [] });
});

/** Proxy selected Admin routes so the web app can use VITE_PASSENGER_API_URL only (avoids CORS and wrong-port 404s). */
const ADMIN_BACKEND_URL = (process.env.ADMIN_BACKEND_URL || "http://localhost:4001").replace(/\/$/, "");

async function proxyAdminPublic(req, res) {
  try {
    const pathWithQuery = req.originalUrl || req.url;
    const url = `${ADMIN_BACKEND_URL}${pathWithQuery}`;
    const method = req.method;
    const headers = { Accept: "application/json" };
    const init = { method, headers };
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(req.body ?? {});
    }
    const r = await fetch(url, init);
    const text = await r.text();
    res.status(r.status);
    const ct = r.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: e.message || "Admin backend unavailable" });
  }
}

app.get("/api/public/operations-deck", proxyAdminPublic);
app.get("/api/public/company-profile", proxyAdminPublic);
app.get("/api/public/fleet-buses", proxyAdminPublic);
app.get("/api/public/live-board", proxyAdminPublic);
app.get("/api/public/command-feed", proxyAdminPublic);
app.get("/api/public/deployed-points", proxyAdminPublic);
app.post("/api/public/fare-quote", proxyAdminPublic);
app.post("/api/public/passenger-feedback", proxyAdminPublic);
app.post("/api/public/passenger-lost-item", proxyAdminPublic);
app.get("/api/buses/live", proxyAdminPublic);

function startHttp() {
  const port = Number(process.env.PORT) || 4000;
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use (EADDRINUSE).`);
      console.error("  Fix: stop the other app, or use another port.");
      console.error("  Different port (PowerShell):  $env:PORT=4005; node server.js");
      console.error("  Different port (CMD):          set PORT=4005 && node server.js");
      console.error("  Find PID (Windows):          netstat -ano | findstr :" + port);
      console.error("  Stop process:                taskkill /PID <pid> /F");
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, () => {
    console.log(`Passenger API listening on http://localhost:${port}`);
  });
}

const uri = process.env.MONGODB_URI;
if (uri) {
  mongoose
    .connect(uri)
    .then(() => {
      console.log("MongoDB connected (passenger-api)");
      startHttp();
    })
    .catch((err) => {
      console.error("MongoDB connection failed:", err.message);
      console.warn("Starting without MongoDB — health will show disconnected.");
      startHttp();
    });
} else {
  console.warn(
    "MONGODB_URI not set — passenger API running without MongoDB (OK for local demo)"
  );
  startHttp();
}
