/**
 * Real Node.js process metrics — CPU% is sampled from actual `process.cpuUsage()` deltas
 * (per-process, not full-machine — `os.loadavg()` always returns [0,0,0] on Windows, so a
 * genuine per-process sample is the honest signal available here). Memory and uptime come
 * straight from the runtime, no estimation involved.
 */
const os = require("os");

let lastCpuUsage = process.cpuUsage();
let lastSampleAt = Date.now();
let cpuPercent = 0;

const SAMPLE_MS = 5000;
const timer = setInterval(() => {
  const delta = process.cpuUsage(lastCpuUsage);
  const now = Date.now();
  const elapsedMs = now - lastSampleAt;
  const cpuMs = (delta.user + delta.system) / 1000;
  const cpuCount = Math.max(1, os.cpus().length);
  cpuPercent = elapsedMs > 0 ? Math.min(100, Math.round((cpuMs / elapsedMs / cpuCount) * 100)) : 0;
  lastCpuUsage = process.cpuUsage();
  lastSampleAt = now;
}, SAMPLE_MS);
timer.unref();

function getProcessMetrics() {
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.round(process.uptime()),
    cpuPercent,
    cpuCount: os.cpus().length,
    memoryMB: {
      rss: Math.round(mem.rss / 1e6),
      heapUsed: Math.round(mem.heapUsed / 1e6),
      heapTotal: Math.round(mem.heapTotal / 1e6),
    },
  };
}

module.exports = { getProcessMetrics };
