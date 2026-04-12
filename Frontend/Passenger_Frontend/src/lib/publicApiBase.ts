const DEFAULT_PASSENGER = "http://localhost:4000";
const DEFAULT_ADMIN = "http://localhost:4001";

/**
 * Bases to try for public API calls (Passenger BFF first, then Admin direct).
 * In dev, if only `VITE_PASSENGER_API_URL` is set, `DEFAULT_ADMIN` is appended so fleet/live board still work when the proxy is misconfigured or Admin is only reachable on 4001.
 */
export function publicApiBaseCandidates(): string[] {
  const passenger = import.meta.env.VITE_PASSENGER_API_URL?.replace(/\/$/, "");
  const admin = import.meta.env.VITE_ADMIN_API_URL?.replace(/\/$/, "");
  const out: string[] = [];
  if (passenger) out.push(passenger);
  if (admin && !out.includes(admin)) out.push(admin);
  if (out.length === 0) {
    out.push(DEFAULT_PASSENGER);
    out.push(DEFAULT_ADMIN);
  } else if (import.meta.env.DEV && passenger && !admin && !out.includes(DEFAULT_ADMIN)) {
    out.push(DEFAULT_ADMIN);
  }
  return out;
}

/**
 * Primary base URL (first candidate). Use `fetchWithPublicApiBases` for resilient GET/POST.
 */
export function publicApiBase(): string {
  return publicApiBaseCandidates()[0] ?? DEFAULT_PASSENGER;
}
