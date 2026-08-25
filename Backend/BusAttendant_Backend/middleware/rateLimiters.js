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

/** Login / OTP / password-reset — brute-force + credential-stuffing surface. */
const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many authentication attempts. Try again in a few minutes.",
});

/** Baseline backstop for everything else. */
const generalApiLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: "Too many requests. Please slow down.",
});

module.exports = { authLimiter, generalApiLimiter };
