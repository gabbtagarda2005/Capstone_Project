const rateLimit = require("express-rate-limit");

/** Common handler: JSON 429, and note the hit in the in-memory system event ring buffer. */
function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

/** Login / OTP / password-reset — brute-force + credential-stuffing surface. */
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many authentication attempts. Try again in a few minutes.",
});

/** LILYGO / field-hardware GPS ingest — generous for real devices (one ping every few seconds),
 *  tight enough to blunt a flood of forged telemetry from a single source. */
const deviceIngestLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many device telemetry requests from this address.",
});

/** Baseline backstop for everything else — generous enough not to disrupt normal dashboard
 *  polling, tight enough to blunt a scripted flood. */
const generalApiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: "Too many requests. Please slow down.",
});

module.exports = { authLimiter, deviceIngestLimiter, generalApiLimiter };
