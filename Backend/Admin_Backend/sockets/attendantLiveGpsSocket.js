const jwt = require("jsonwebtoken");
const Bus = require("../models/Bus");
const { isAuthorizedAdminEmail, normalizeEmail } = require("../config/adminWhitelist");
const { ingestAttendantGps, clearAttendantLiveSession, buildOperatorBusQuery } = require("../services/attendantGpsIngest");
const { broadcastLocationUpdate, broadcastBusAttendantOffline } = require("./socket");

function ticketingUserFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    sub: payload.sub,
    role: payload.role,
    email: payload.email,
  };
}

function verifyOperatorTicketingToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(String(token).trim(), secret, { algorithms: ["HS256"] });
    const role = payload.role;
    if (role === "Admin") {
      const email = normalizeEmail(payload.email);
      if (!isAuthorizedAdminEmail(email)) return null;
    } else {
      const compact = String(role || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "");
      if (compact !== "operator" && compact !== "busattendant") return null;
    }
    return ticketingUserFromPayload(payload);
  } catch {
    return null;
  }
}

/** Per-socket flood guard for attendant_live_location — a compromised/buggy client emitting in a
 *  tight loop shouldn't be able to hammer ingestAttendantGps (DB writes + broadcast) unbounded.
 *  A real phone/device pings every few seconds; this allows a generous burst above that. */
const LOCATION_EVENT_WINDOW_MS = 10_000;
const LOCATION_EVENT_MAX_PER_WINDOW = 20;

function isLocationEventRateLimited(socket) {
  const now = Date.now();
  const hits = (socket.data.locationEventHits || []).filter((t) => now - t < LOCATION_EVENT_WINDOW_MS);
  hits.push(now);
  socket.data.locationEventHits = hits;
  return hits.length > LOCATION_EVENT_MAX_PER_WINDOW;
}

/**
 * Attendant app: authenticate with operator JWT, then emit live GPS (mirrors POST /api/buses/live-location).
 */
function attachAttendantLiveGpsSocket(io) {
  io.on("connection", (socket) => {
    socket.on("live_fleet_authenticate", async (msg, ack) => {
      const token = msg && typeof msg === "object" ? msg.token : null;
      const tu = verifyOperatorTicketingToken(token);
      if (!tu) {
        if (typeof ack === "function") ack({ ok: false, error: "Invalid or unauthorized token" });
        return;
      }
      const prevRoom = socket.data.attendantBusRoom;
      if (prevRoom) {
        socket.leave(prevRoom);
        socket.data.attendantBusRoom = null;
      }
      socket.data.ticketingUser = tu;
      socket.join("buses");
      socket.data.attendantBusRoom = null;
      try {
        const q = buildOperatorBusQuery(tu.sub);
        if (q) {
          const b = await Bus.findOne(q).select("busId").lean();
          if (b?.busId) {
            const room = `bus:${String(b.busId).trim()}`;
            socket.join(room);
            socket.data.attendantBusRoom = room;
          }
        }
      } catch {
        /* non-fatal — still on buses room */
      }
      if (typeof ack === "function") ack({ ok: true });
    });

    socket.on("attendant_live_location", async (msg, ack) => {
      const tu = socket.data.ticketingUser;
      if (!tu) {
        if (typeof ack === "function") ack({ ok: false, error: "Not authenticated; emit live_fleet_authenticate first" });
        return;
      }
      if (isLocationEventRateLimited(socket)) {
        if (typeof ack === "function") ack({ ok: false, error: "Too many location updates; slowing down", code: 429 });
        return;
      }
      const body = msg && typeof msg === "object" ? msg : {};
      const latitude = body.lat != null ? body.lat : body.latitude;
      const longitude = body.lng != null ? body.lng : body.longitude;
      const speedKph = body.speed != null ? body.speed : body.speedKph;
      const heading = body.heading;
      const forceSync = Boolean(body.forceSync || body.precisionHandshake);
      const signal = body.signal ?? body.signal_status;
      try {
        await ingestAttendantGps(io, broadcastLocationUpdate, tu, {
          latitude,
          longitude,
          speedKph,
          heading,
          forceSync,
          signal,
        });
        if (typeof ack === "function") ack({ ok: true });
      } catch (e) {
        const code = e.statusCode || 500;
        if (code >= 400 && code < 500) {
          console.warn("[gps-ingest socket]", tu?.sub, e.message || e);
        }
        if (typeof ack === "function") ack({ ok: false, error: e.message || "ingest failed", code });
      }
    });

    socket.on("attendant_logout", () => {
      const tu = socket.data.ticketingUser;
      const room = socket.data.attendantBusRoom;
      socket.data.ticketingUser = null;
      socket.data.attendantBusRoom = null;
      if (room) socket.leave(room);
      if (!tu?.sub) return;
      void clearAttendantLiveSession(io, broadcastBusAttendantOffline, tu).catch(() => {});
    });

    socket.on("disconnect", () => {
      const tu = socket.data.ticketingUser;
      const room = socket.data.attendantBusRoom;
      socket.data.ticketingUser = null;
      socket.data.attendantBusRoom = null;
      if (room) socket.leave(room);
      if (!tu?.sub) return;
      void clearAttendantLiveSession(io, broadcastBusAttendantOffline, tu).catch(() => {});
    });
  });
}

module.exports = { attachAttendantLiveGpsSocket };
