/**
 * In-memory ring buffer of real backend events (Mongo connection state, JSON parse errors,
 * uncaught route errors, and health-check state transitions). Not a persisted log — resets on
 * restart — but every entry reflects something that actually happened, never a placeholder.
 */
const MAX_EVENTS = 200;

/** @type {Array<{id:string, timestamp:string, level:"info"|"warn"|"error"|"critical", service:string, message:string}>} */
const events = [];

function logSystemEvent({ level, service, message }) {
  const entry = {
    id: `evt-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    timestamp: new Date().toISOString(),
    level: ["info", "warn", "error", "critical"].includes(level) ? level : "info",
    service: String(service || "System").slice(0, 60),
    message: String(message || "").slice(0, 500),
  };
  events.unshift(entry);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  return entry;
}

function getSystemEvents({ level, service, limit } = {}) {
  let out = events;
  if (level && level !== "all") out = out.filter((e) => e.level === level);
  if (service && service !== "all") out = out.filter((e) => e.service.toLowerCase() === String(service).toLowerCase());
  const n = Number(limit);
  return out.slice(0, Number.isFinite(n) && n > 0 ? n : 100);
}

module.exports = { logSystemEvent, getSystemEvents };
