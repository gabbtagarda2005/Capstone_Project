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
const { logMailerBoot, isOtpEmailConfigured } = require("./services/mailer");
const { createOperatorsTicketingRouter } = require("./routes/operatorsTicketing");
const { createTicketsTicketingRouter } = require("./routes/ticketsTicketing");
const { createLocationsTicketingRouter } = require("./routes/locationsTicketing");
const { createCorridorRoutesRouter } = require("./routes/corridorRoutes");
const { createFaresRouter } = require("./routes/fares");
const { createSecurityLogsRouter } = require("./routes/securityLogs");
const { createDriversRouter } = require("./routes/drivers");
const { createDriversSignupRouter } = require("./routes/driversSignup");
const { createAttendantsSignupRouter } = require("./routes/attendantsSignup");
const { createAdminPortalRouter } = require("./routes/adminPortal");
const { adminAuditLogger } = require("./middleware/adminAuditLogger");
const { enforceAdminRbac } = require("./middleware/enforceAdminRbac");
const { seedRbacAssignments } = require("./services/adminRbac");

const app = express();
const server = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || "*";
const corsOptions = {
  origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((s) => s.trim()),
};

app.use(cors(corsOptions));
app.use(express.json());
app.use((err, _req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }
  return next(err);
});
app.use(adminAuditLogger);

const io = new Server(server, { cors: corsOptions });
registerSocketHandlers(io);

app.get("/health", async (_req, res) => {
  let mysql = "disabled";
  if (isMysqlConfigured()) {
    mysql = (await pingMysql()) ? "connected" : "error";
  }
  const { getFirebaseRtdbHealth } = require("./config/firebaseAdmin");
  let firebaseRtdb = "disabled";
  try {
    firebaseRtdb = await getFirebaseRtdbHealth();
  } catch {
    firebaseRtdb = "error";
  }
  res.json({
    ok: true,
    service: "admin-api",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    mysqlTicketing: mysql,
    firebaseRtdb,
    adminLogin: isMysqlConfigured() ? "mysql(bus_operators)" : "mongodb(portal_users)",
    otpEmailConfigured: isOtpEmailConfigured(),
    driverSignupBase: "/api/driver-signup",
  });
});

app.use("/api/buses", createBusesRouter(io));
/* Driver OTP signup: dedicated prefix + same router on /api/drivers for backward compatibility */
const driverSignupRouter = createDriversSignupRouter();
app.use("/api/driver-signup", driverSignupRouter);
app.use("/api/drivers", driverSignupRouter);
app.use("/api/drivers", createDriversRouter());
app.use("/api/attendants", createAttendantsSignupRouter());
app.use("/api/reports", createReportsRouter());

app.use("/api/auth", createAuthTicketingRouter());
app.use("/api/admin", createAdminPortalRouter());
app.use("/api/operators", createOperatorsTicketingRouter());
app.use("/api/tickets", createTicketsTicketingRouter());
app.use("/api/locations", createLocationsTicketingRouter());
app.use("/api/corridor-routes", createCorridorRoutesRouter());
app.use("/api/fares", createFaresRouter());
app.use("/api/security/logs", createSecurityLogsRouter());

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
  .then(async () => {
    console.log("MongoDB connected (admin-api)");
    try {
      await seedRbacAssignments();
    } catch (e) {
      console.warn("RBAC seed:", e.message);
    }
    const stopProximity = startProximityWorker(io);

    const port = Number(process.env.PORT) || 4001;
    server.listen(port, () => {
      logMailerBoot();
    console.log(`admin-api listening on http://localhost:${port}`);
      console.log(`  GET  /api/buses/live`);
      console.log(`  POST /api/buses/ping`);
      console.log(`  POST /api/tickets/issue (operator JWT)`);
      console.log(`  POST /api/attendants/verify-email | verify-otp | save-attendant`);
      console.log(`  POST /api/driver-signup/verify-email | verify-otp | save-driver (also under /api/drivers/…)`);
      console.log(`  GET  /api/drivers/verified | GET /api/attendants/verified`);
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
