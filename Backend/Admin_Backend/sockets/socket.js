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
  });
}

function broadcastLocationUpdate(io, payload) {
  io.to("buses").emit("locationUpdate", payload);
  io.emit("locationUpdate", payload);
}

module.exports = { registerSocketHandlers, broadcastLocationUpdate };
