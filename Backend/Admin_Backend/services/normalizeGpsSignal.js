/**
 * Normalize attendant-reported connectivity for map + live board.
 * Accepts `signal` or `signal_status` (case-insensitive aliases).
 * @returns {"strong" | "weak" | "offline" | null}
 */
function normalizeGpsSignal(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (["strong", "good", "excellent", "4g", "5g", "lte", "wifi", "wi-fi", "ethernet"].includes(s)) return "strong";
  if (["weak", "poor", "3g", "2g", "edge", "gprs", "slow"].includes(s)) return "weak";
  if (["offline", "none", "disconnected", "no_connection", "noconnection"].includes(s)) return "offline";
  if (s === "strong" || s === "weak" || s === "offline") return s;
  return null;
}

module.exports = { normalizeGpsSignal };
