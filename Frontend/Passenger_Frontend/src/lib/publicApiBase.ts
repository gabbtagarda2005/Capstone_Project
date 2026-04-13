const DEFAULT_PASSENGER = "http://localhost:4000";
const DEFAULT_ADMIN = "http://localhost:4001";

/** Strip trailing slashes and a mistaken trailing `/api` (avoids `/api/api/public/...` → Admin JSON 404). */
function normalizePublicApiBase(raw: string | undefined): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  let u = String(raw).trim().replace(/\/+$/, "");
  if (/\/api$/i.test(u)) u = u.replace(/\/api$/i, "");
  return u.replace(/\/+$/, "");
}

/**
 * Bases to try for public API calls (Passenger BFF first, then Admin direct).
 * In dev, if only `VITE_PASSENGER_API_URL` is set, `DEFAULT_ADMIN` is appended so fleet/live board still work when the proxy is misconfigured or Admin is only reachable on 4001.
 */
export function publicApiBaseCandidates(): string[] {
  const passenger = normalizePublicApiBase(import.meta.env.VITE_PASSENGER_API_URL);
  const admin = normalizePublicApiBase(import.meta.env.VITE_ADMIN_API_URL);
  const out: string[] = [];
  /** Same-origin in dev → Vite `server.proxy` to Passenger API (see vite.config.ts). */
  if (import.meta.env.DEV) {
    out.push("");
  }
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
