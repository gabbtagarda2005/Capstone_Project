/**
 * Real, measured per-route request stats — count, average response time, error count — kept
 * in memory since process start. No synthetic numbers: a route with no traffic yet simply
 * doesn't appear until something actually calls it.
 */
const stats = new Map();

function routeKey(req) {
  const base = req.baseUrl || "";
  const routePath = req.route?.path || "";
  const path = (base + routePath) || req.originalUrl.split("?")[0];
  return `${req.method} ${path}`;
}

function apiMetricsMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const key = routeKey(req);
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const s = stats.get(key) || { count: 0, totalMs: 0, errorCount: 0, lastStatus: null, lastAt: null };
      s.count += 1;
      s.totalMs += ms;
      if (res.statusCode >= 500) s.errorCount += 1;
      s.lastStatus = res.statusCode;
      s.lastAt = new Date().toISOString();
      stats.set(key, s);
    } catch {
      /* metrics must never break the real response */
    }
  });
  next();
}

function getApiMetrics(limit = 40) {
  return [...stats.entries()]
    .map(([key, s]) => {
      const [method, ...rest] = key.split(" ");
      return {
        method,
        path: rest.join(" ") || "/",
        count: s.count,
        avgMs: Math.round(s.totalMs / s.count),
        errorCount: s.errorCount,
        lastStatus: s.lastStatus,
        lastAt: s.lastAt,
      };
    })
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, limit);
}

module.exports = { apiMetricsMiddleware, getApiMetrics };
