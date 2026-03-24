require("dotenv").config();
const { applyPublicDnsForMongo } = require("./config/mongoDns");
applyPublicDnsForMongo();

const http = require("http");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const { registerSocketHandlers } = require("./sockets/socket");
const { createBusesRouter } = require("./routes/buses");
const { createReportsRouter } = require("./routes/reports");
const { startProximityWorker } = require("./services/proximityWorker");
const { getMysqlPool, isMysqlConfigured, pingMysql } = require("./db/mysqlPool");
const { createAuthTicketingRouter } = require("./routes/authTicketing");
const { createOperatorsTicketingRouter } = require("./routes/operatorsTicketing");
const { createTicketsTicketingRouter } = require("./routes/ticketsTicketing");
const { createLocationsTicketingRouter } = require("./routes/locationsTicketing");

const app = express();
const server = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || "*";
const corsOptions = {
  origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
};

app.use(cors(corsOptions));
app.use(express.json());

const io = new Server(server, { cors: corsOptions });
registerSocketHandlers(io);

app.get("/health", async (_req, res) => {
  let mysql = "disabled";
  if (isMysqlConfigured()) {
    mysql = (await pingMysql()) ? "connected" : "error";
  }
  res.json({
    ok: true,
    service: "admin-api",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    mysqlTicketing: mysql,
    adminLogin: isMysqlConfigured() ? "mysql(bus_operators)" : "mongodb(portal_users)",
  });
});

app.use("/api/buses", createBusesRouter(io));
app.use("/api/reports", createReportsRouter());

app.use("/api/auth", createAuthTicketingRouter());
app.use("/api/operators", createOperatorsTicketingRouter());
app.use("/api/tickets", createTicketsTicketingRouter());
app.use("/api/locations", createLocationsTicketingRouter());

if (isMysqlConfigured()) {
  getMysqlPool();
  console.log("MySQL ticketing pool initialized");
} else {
  console.warn("MYSQL_* not set — ticketing REST (/api/auth, /api/operators, …) will return 503 until configured");
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGODB_URI — copy .env.example to .env and set your Atlas URI.");
  process.exit(1);
}

mongoose
  .connect(uri, { serverSelectionTimeoutMS: 30_000 })
  .then(() => {
    console.log("MongoDB connected (admin-api)");
    const stopProximity = startProximityWorker(io);

    const port = Number(process.env.PORT) || 4001;
    server.listen(port, () => {
      console.log(`admin-api listening on http://localhost:${port}`);
      console.log(`  GET  /api/buses/live`);
      console.log(`  POST /api/buses/ping`);
    });

    const shutdown = () => {
      stopProximity();
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
