const rateLimit = require("express-rate-limit");

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

/** Baseline backstop — this service has no auth, so every route is public-facing. */
const generalApiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: "Too many requests. Please slow down.",
});

/** Unauthenticated DB-writing endpoint (terminal-affinity counter) — tighter than the general limit. */
const writeLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many requests to this endpoint.",
});

module.exports = { generalApiLimiter, writeLimiter };
