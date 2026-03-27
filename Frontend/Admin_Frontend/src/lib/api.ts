import type {
  CorridorBuilderStop,
  CorridorBuilderTerminal,
  CorridorRouteRow,
  AdminAuditLogRowDto,
  AdminPortalSettingsDto,
  AdminRbacRole,
  FareGlobalSettingsDto,
  FareHistoryRowDto,
  FareLocationOption,
  FareMatrixRowDto,
  ReportsAnalyticsDto,
} from "@/lib/types";

const API_BASE = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4001";
const API_FALLBACK_BASE = "http://localhost:4001";

export function getToken(): string | null {
  return localStorage.getItem("admin_token");
}

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown; authToken?: string | null } = {}
): Promise<T> {
  const { authToken, json, ...rest } = init;
  const headers: Record<string, string> = {
    ...(rest.headers as Record<string, string>),
  };
  const token = authToken !== undefined ? authToken : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = rest.body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  const candidates = API_BASE === API_FALLBACK_BASE ? [API_BASE] : [API_BASE, API_FALLBACK_BASE];
  let lastHtmlError: Error | null = null;

  for (const candidateBase of candidates) {
    const res = await fetch(`${candidateBase}${path}`, { ...rest, headers, body });
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let data: { error?: string } | Record<string, unknown> = {};

    if (text) {
      const trimmed = text.trim();
      // Common failure mode: hitting the frontend dev server / 404 page / express error page
      // which returns HTML starting with "<!DOCTYPE ...".
      if (trimmed.startsWith("<")) {
        const htmlErr = new Error(
          `Non-JSON response (${res.status}) for ${path}. Received HTML instead of JSON. (API base: ${candidateBase}). ` +
            `Open ${candidateBase}/health — it must show "service":"admin-api". Restart Admin_Backend from Backend/Admin_Backend after pulling latest code.`
        );
        // If the first base is wrong, try once with the local admin-api default.
        if (res.status === 404 && candidateBase === API_BASE && candidates.length > 1) {
          lastHtmlError = htmlErr;
          continue;
        }
        throw htmlErr;
      }

      try {
        data = JSON.parse(text) as { error?: string };
      } catch {
        throw new Error(`Invalid JSON response (${res.status}) for ${path}.`);
      }
    }

    if (!res.ok) {
      throw new Error((data as { error?: string }).error || res.statusText || "Request failed");
    }
    return data as T;
  }

  throw lastHtmlError ?? new Error("Request failed");
}

export async function fetchCorridorBuilderContext(): Promise<{
  terminals: CorridorBuilderTerminal[];
  stops: CorridorBuilderStop[];
}> {
  return api("/api/corridor-routes/builder-context");
}

export async function fetchCorridorRoutes(): Promise<{ items: CorridorRouteRow[] }> {
  return api("/api/corridor-routes/");
}

export async function createCorridorRoute(body: {
  displayName?: string;
  originCoverageId: string;
  destinationCoverageId: string;
  /** Terminal hubs between start and destination (order preserved). */
  viaCoverageIds?: string[];
  authorizedStops: { coverageId: string; sequence: number }[];
}): Promise<{
  _id: string;
  displayName: string;
  originCoverageId: string;
  destinationCoverageId: string;
  viaCoverageIds?: string[];
  authorizedStops: CorridorRouteRow["authorizedStops"];
}> {
  return api("/api/corridor-routes/", { method: "POST", json: body });
}

export async function deleteCorridorRoute(id: string): Promise<void> {
  await api(`/api/corridor-routes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchFareLocationOptions(): Promise<{ options: FareLocationOption[] }> {
  return api("/api/fares/location-options");
}

export async function fetchFareLocationEndpoints(): Promise<{
  startOptions: FareLocationOption[];
  endOptions: FareLocationOption[];
}> {
  return api("/api/fares/location-endpoints");
}

export async function fetchFareSettings(): Promise<FareGlobalSettingsDto> {
  return api("/api/fares/settings");
}

export async function putFareSettings(body: {
  studentDiscountPct: number;
  pwdDiscountPct: number;
  seniorDiscountPct: number;
}): Promise<FareGlobalSettingsDto> {
  return api("/api/fares/settings", { method: "PUT", json: body });
}

export async function fetchFareMatrix(): Promise<{ items: FareMatrixRowDto[] }> {
  return api("/api/fares/matrix");
}

export async function postFareMatrix(body: {
  startEndpoint: string;
  endEndpoint: string;
  baseFarePesos: number;
}): Promise<{ _id: string; startLabel: string; endLabel: string; baseFarePesos: number }> {
  return api("/api/fares/matrix", { method: "POST", json: body });
}

export async function deleteFareMatrixEntry(id: string): Promise<void> {
  await api(`/api/fares/matrix/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchFareHistory(): Promise<{ items: FareHistoryRowDto[] }> {
  return api("/api/fares/history");
}

export async function fetchAdminAuditLog(limit = 100): Promise<{ items: AdminAuditLogRowDto[] }> {
  return api(`/api/admin/audit-log?limit=${encodeURIComponent(String(limit))}`);
}

export async function postAdminAuditEvent(body: {
  action: "ADD" | "EDIT" | "VIEW" | "DELETE" | "BROADCAST";
  module: string;
  details: string;
}): Promise<void> {
  await api("/api/admin/audit-event", { method: "POST", json: body });
}

export async function fetchReportsAnalytics(): Promise<ReportsAnalyticsDto> {
  return api("/api/reports/analytics");
}

export async function fetchAdminPortalSettings(): Promise<{ settings: AdminPortalSettingsDto }> {
  return api("/api/admin/settings");
}

export async function putAdminPortalSettings(body: {
  general?: Partial<
    Pick<
      AdminPortalSettingsDto,
      | "emailDailySummary"
      | "soundAlerts"
      | "timezone"
      | "currency"
      | "geofenceBreachToasts"
      | "sensitiveActionConfirmation"
    >
  >;
  security?: Partial<
    Pick<AdminPortalSettingsDto, "maxLoginAttempts" | "lockoutMinutes" | "sessionTimeoutMinutes">
  >;
  branding?: Partial<
    Pick<AdminPortalSettingsDto, "companyName" | "sidebarLogoUrl" | "faviconUrl" | "reportFooter">
  >;
}): Promise<{ settings: AdminPortalSettingsDto }> {
  return api("/api/admin/settings", { method: "PUT", json: body });
}

export async function fetchAdminRbac(): Promise<{ items: { email: string; role: AdminRbacRole }[] }> {
  return api("/api/admin/rbac");
}

export async function putAdminRbac(items: { email: string; role: AdminRbacRole }[]): Promise<{
  items: { email: string; role: AdminRbacRole }[];
}> {
  return api("/api/admin/rbac", { method: "PUT", json: { items } });
}
