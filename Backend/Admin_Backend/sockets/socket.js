/** @type {null | (() => Promise<unknown>)} */
let getLiveBoardPayload = null;

function setLiveBoardSnapshotProvider(fn) {
  getLiveBoardPayload = typeof fn === "function" ? fn : null;
}

/**
 * Live wire: push map updates without refresh.
 * Client: socket.on('locationUpdate', (payload) => ...)
 */
function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    socket.emit("connected", { service: "admin-api" });
    socket.on("subscribe:buses", () => {
      socket.join("buses");
    });
    socket.on("subscribe:liveBoard", async () => {
      socket.join("liveBoard");
      if (getLiveBoardPayload) {
        try {
          const payload = await getLiveBoardPayload();
          socket.emit("liveBoardSnapshot", payload);
        } catch {
          /* ignore */
        }
      }
    });
  });
}

/** Command Center / View Location: canonical live envelope for fleet HUD + pulsing markers */
function broadcastBusLocationUpdate(io, payload) {
  const bus_id = payload.busId != null ? String(payload.busId) : "";
  const lat = Number(payload.latitude);
  const lng = Number(payload.longitude);
  if (!bus_id || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const recordedAt = payload.recordedAt || new Date().toISOString();
  const crew = payload.attendantName != null ? String(payload.attendantName) : null;
  const speed =
    payload.speedKph != null && Number.isFinite(Number(payload.speedKph)) ? Number(payload.speedKph) : null;
  const sig =
    payload.signal != null && ["strong", "weak", "offline"].includes(String(payload.signal))
      ? String(payload.signal)
      : null;
  const src = payload.source != null ? String(payload.source) : null;
  const srcFlag = payload.sourceFlag != null ? String(payload.sourceFlag) : src === "hardware" ? "hardware" : "mobile";
  const net = payload.net != null ? String(payload.net) : null;
  const sigStrength =
    payload.signalStrength != null && Number.isFinite(Number(payload.signalStrength))
      ? Number(payload.signalStrength)
      : null;
  const voltage =
    payload.voltage != null && Number.isFinite(Number(payload.voltage))
      ? Number(payload.voltage)
      : null;
  const envelope = {
    bus_id,
    lat,
    lng,
    speed,
    attendantName: crew,
    crew,
    status: "Active",
    recordedAt,
    ...(src ? { source: src } : {}),
    ...(srcFlag ? { sourceFlag: srcFlag } : {}),
    ...(net ? { net } : {}),
    ...(sigStrength != null ? { signalStrength: sigStrength } : {}),
    ...(voltage != null ? { voltage } : {}),
    ...(payload.etaMinutes != null && Number.isFinite(Number(payload.etaMinutes))
      ? { etaMinutes: Number(payload.etaMinutes) }
      : {}),
    ...(payload.etaTargetIso ? { etaTargetIso: String(payload.etaTargetIso) } : {}),
    ...(payload.nextTerminal ? { nextTerminal: String(payload.nextTerminal) } : {}),
    ...(payload.trafficDelay === true ? { trafficDelay: true } : {}),
    ...(payload.forceSync ? { forceSync: true } : {}),
    ...(sig ? { signal: sig } : {}),
  };
  io.to("buses").emit("bus_location_update", envelope);
  io.emit("bus_location_update", envelope);
}

function broadcastBusTerminalArrival(io, payload) {
  if (!io || !payload?.bus_id) return;
  io.to("buses").emit("bus_terminal_arrival", payload);
  io.emit("bus_terminal_arrival", payload);
}

function broadcastBusAttendantOffline(io, busId) {
  const bus_id = busId != null ? String(busId).trim() : "";
  if (!bus_id) return;
  const envelope = { bus_id, status: "Stationary", online: false };
  io.to("buses").emit("bus_attendant_offline", envelope);
  io.emit("bus_attendant_offline", envelope);
}

function broadcastLocationUpdate(io, payload) {
  io.to("buses").emit("locationUpdate", payload);
  io.emit("locationUpdate", payload);
  const ts = payload.recordedAt || new Date().toISOString();
  const locSig =
    payload.signal != null && ["strong", "weak", "offline"].includes(String(payload.signal))
      ? String(payload.signal)
      : null;
  const locAlt = {
    attendant_id: payload.attendantSub != null ? String(payload.attendantSub) : null,
    busId: payload.busId != null ? String(payload.busId) : null,
    lat: Number(payload.latitude),
    lng: Number(payload.longitude),
    timestamp: ts,
    speedKph: payload.speedKph != null && Number.isFinite(Number(payload.speedKph)) ? Number(payload.speedKph) : null,
    attendantName: payload.attendantName != null ? String(payload.attendantName) : null,
    source: payload.source != null ? String(payload.source) : null,
    sourceFlag:
      payload.sourceFlag != null
        ? String(payload.sourceFlag)
        : payload.source != null && String(payload.source) === "hardware"
          ? "hardware"
          : "mobile",
    net: payload.net != null ? String(payload.net) : null,
    signalStrength:
      payload.signalStrength != null && Number.isFinite(Number(payload.signalStrength))
        ? Number(payload.signalStrength)
        : null,
    voltage:
      payload.voltage != null && Number.isFinite(Number(payload.voltage))
        ? Number(payload.voltage)
        : null,
    etaMinutes:
      payload.etaMinutes != null && Number.isFinite(Number(payload.etaMinutes))
        ? Number(payload.etaMinutes)
        : null,
    etaTargetIso: payload.etaTargetIso ? String(payload.etaTargetIso) : null,
    nextTerminal: payload.nextTerminal ? String(payload.nextTerminal) : null,
    trafficDelay: payload.trafficDelay === true,
    ...(locSig ? { signal: locSig } : {}),
  };
  if (Number.isFinite(locAlt.lat) && Number.isFinite(locAlt.lng) && locAlt.busId) {
    io.to("buses").emit("location_update", locAlt);
    io.emit("location_update", locAlt);
  }
  broadcastBusLocationUpdate(io, payload);
}

/** Super Admin / Command Center: attendant SOS, incidents, etc. */
function broadcastCommandAlert(io, payload) {
  io.emit("commandAlert", payload);
  io.to("buses").emit("commandAlert", payload);
}

/** Passenger live departures board — admin dispatch changes push here */
function broadcastLiveBoard(io, payload) {
  io.to("liveBoard").emit("liveBoardSnapshot", payload);
}

module.exports = {
  registerSocketHandlers,
  setLiveBoardSnapshotProvider,
  broadcastLocationUpdate,
  broadcastBusLocationUpdate,
  broadcastBusTerminalArrival,
  broadcastBusAttendantOffline,
  broadcastCommandAlert,
  broadcastLiveBoard,
};
