import { publicApiBaseCandidates } from "@/lib/publicApiBase";

const RETRY_STATUS = new Set([404, 502, 503, 504]);

/** Build `/path?a=1&b=two` for public GET helpers. Omits empty / null / undefined values. */
export function publicPathWithQuery(
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const q = sp.toString();
  return q ? `${path}?${q}` : path;
}

function notJsonHint(base: string, path: string): string {
  return `Response from ${base}${path} was not JSON. Set VITE_PASSENGER_API_URL to your Passenger API (e.g. http://localhost:4000), not the Vite dev port; ensure Passenger_Backend proxies to Admin (ADMIN_BACKEND_URL) or set VITE_ADMIN_API_URL and run Admin_Backend.`;
}

/**
 * GET public JSON with fallback across `publicApiBaseCandidates()` when the body is not JSON
 * or the server returns 404/502–504 (e.g. wrong URL or proxy down → try Admin directly).
 */
export async function fetchPublicGetJson<T extends Record<string, unknown>>(path: string): Promise<T> {
  const bases = publicApiBaseCandidates();
  let lastMessage = "Could not reach API.";
  for (const base of bases) {
    const url = `${base}${path}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : "Network error";
      continue;
    }
    const text = await res.text();
    let data = {} as T;
    if (text.trim()) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        lastMessage = notJsonHint(base, path);
        continue;
      }
    }
    if (!res.ok) {
      const errMsg =
        typeof data.error === "string" && data.error ? data.error : `HTTP ${res.status}`;
      if (RETRY_STATUS.has(res.status)) {
        lastMessage = errMsg;
        continue;
      }
      throw new Error(errMsg);
    }
    return data;
  }
  throw new Error(lastMessage);
}

/**
 * POST public JSON with the same fallback behavior as GET.
 */
export async function fetchPublicPostJson<T extends Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const bases = publicApiBaseCandidates();
  const payload = JSON.stringify(body);
  let lastMessage = "Could not reach API.";
  for (const base of bases) {
    const url = `${base}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: payload,
      });
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : "Network error";
      continue;
    }
    const text = await res.text();
    let data = {} as T;
    if (text.trim()) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        lastMessage = notJsonHint(base, path);
        continue;
      }
    }
    const d = data as { error?: string; message?: string };
    const errMsg =
      typeof d.error === "string"
        ? d.error
        : typeof d.message === "string"
          ? d.message
          : res.ok
            ? ""
            : `HTTP ${res.status}`;
    if (!res.ok) {
      if (RETRY_STATUS.has(res.status)) {
        lastMessage = errMsg || `HTTP ${res.status}`;
        continue;
      }
      throw new Error(errMsg || `HTTP ${res.status}`);
    }
    return data;
  }
  throw new Error(lastMessage);
}
