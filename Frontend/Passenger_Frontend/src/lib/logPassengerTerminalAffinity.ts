const PASSENGER_BASE = (import.meta.env.VITE_PASSENGER_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/**
 * Increments anonymous “nearest terminal” popularity in Mongo (coverage id only; no coordinates stored).
 */
export async function logPassengerTerminalAffinity(coverageId: string | null | undefined): Promise<void> {
  const id = String(coverageId || "").trim();
  if (!/^[a-f0-9]{24}$/i.test(id)) return;
  try {
    await fetch(`${PASSENGER_BASE}/api/passenger/terminal-affinity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverageId: id }),
    });
  } catch {
    /* non-blocking */
  }
}
