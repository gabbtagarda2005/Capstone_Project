import type {
  CorridorBuilderStop,
  CorridorBuilderTerminal,
  CorridorRouteRow,
  AdminAuditLogRowDto,
  AdminPortalSettingsDto,
  AdminRbacRole,
  AttendantAppAccessDto,
  PassengerAppAccessDto,
  BusRow,
  FleetMode,
  FareGlobalSettingsDto,
  LiveDispatchBlock,
  FareHistoryRowDto,
  FareLocationOption,
  FareMatrixRowDto,
  FleetHardwareStatusRow,
  PassengerFeedbackDashboardDto,
  DailyOperationsReportDto,
  DailyOpsSnapshotListDto,
  ReportsAnalyticsDto,
} from "@/lib/types";

const RAW_ADMIN_API = (import.meta.env.VITE_ADMIN_API_URL as string | undefined)?.trim();

/**
 * Admin_Backend paths are always `/api/...`. If env is set to `http://host:4001/api`, requests would
 * become `/api/api/...` and hit the JSON 404 `{ error: "Endpoint not found." }`.
 */
function normalizeAdminApiOrigin(raw: string): string {
  let s = raw.trim().replace(/\/+$/, "");
  if (/\/api$/i.test(s)) {
    s = s.slice(0, -4).replace(/\/+$/, "");
  }
  return s;
}

/** Dev: omit or leave empty VITE_ADMIN_API_URL to use same-origin /api (Vite proxy → Admin_Backend :4001). */
const API_BASE =
  RAW_ADMIN_API !== undefined && RAW_ADMIN_API !== ""
    ? normalizeAdminApiOrigin(RAW_ADMIN_API)
    : import.meta.env.DEV
      ? ""
      : "http://127.0.0.1:4001";
const API_FALLBACK_BASE = normalizeAdminApiOrigin("http://127.0.0.1:4001");

/** Public origin for Socket.io and health probes (no trailing slash). */
export const ADMIN_API_ORIGIN =
  API_BASE === "" && typeof window !== "undefined"
    ? window.location.origin
    : String(API_BASE).replace(/\/+$/, "");
/** Bus attendant API — health / maintenance proxy when probing the field app stack. */
export const BUS_ATTENDANT_API_ORIGIN = String(
  import.meta.env.VITE_BUS_ATTENDANT_API_URL || "http://localhost:4011"
).replace(/\/+$/, "");

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

  const candidates =
    API_BASE === ""
      ? [""]
      : API_BASE === API_FALLBACK_BASE
        ? [API_BASE]
        : [API_BASE, API_FALLBACK_BASE];
  let lastHtmlError: Error | null = null;
  let lastFetchError: Error | null = null;

  for (const candidateBase of candidates) {
    let res: Response;
    try {
      res = await fetch(`${candidateBase}${path}`, {
        ...rest,
        headers,
        body,
        // Avoid stale JSON after PUT/PATCH (e.g. fare settings) when the browser reuses cached GETs.
        cache: rest.cache ?? "no-store",
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const localhostHint =
        candidateBase !== "" && /localhost/i.test(candidateBase) && !/127\.0\.0\.1/.test(candidateBase)
          ? " On Windows, try VITE_ADMIN_API_URL=http://127.0.0.1:4001 if localhost fails."
          : "";
      const at =
        candidateBase === "" ? `(same-origin)${path}` : `${candidateBase}${path}`;
      lastFetchError = new Error(
        `Cannot reach admin API at ${at}. Start Admin_Backend (node server.js in Backend/Admin_Backend, port 4001). In dev, clear VITE_ADMIN_API_URL to use Vite proxy, or set it to http://127.0.0.1:4001.${localhostHint} (${raw})`
      );
      if (candidates.length > 1 && candidateBase === API_BASE) {
        continue;
      }
      throw lastFetchError;
    }
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let data: { error?: string } | Record<string, unknown> = {};

    if (text) {
      const trimmed = text.trim();
      // Common failure mode: hitting the frontend dev server / 404 page / express error page
      // which returns HTML starting with "<!DOCTYPE ...".
      if (trimmed.startsWith("<")) {
        const htmlErr = new Error(
          `Non-JSON response (${res.status}) for ${path}. Point VITE_ADMIN_API_URL at Admin_Backend (${candidateBase}/health).`
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
      const errMsg = (data as { error?: string }).error || res.statusText || "Request failed";
      if (errMsg === "Endpoint not found.") {
        throw new Error(
          "That path is not on the Admin API. If VITE_ADMIN_API_URL ends with /api, remove it (use http://127.0.0.1:4001 only). Otherwise restart Admin_Backend and check the Network tab request URL."
        );
      }
      throw new Error(errMsg);
    }
    return data as T;
  }

  throw lastHtmlError ?? lastFetchError ?? new Error("Request failed");
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

export type CorridorRouteWritePayload = {
  displayName?: string;
  originCoverageId: string;
  destinationCoverageId: string;
  viaCoverageIds?: string[];
  authorizedStops: { coverageId: string; sequence: number }[];
};

export async function patchCorridorRoute(
  id: string,
  body: { suspended: boolean } | (CorridorRouteWritePayload & { suspended?: boolean })
): Promise<{
  _id: string;
  displayName?: string;
  suspended?: boolean;
  originCoverageId?: string;
  destinationCoverageId?: string;
  viaCoverageIds?: string[];
  authorizedStops?: { coverageId: string; sequence: number; name?: string; latitude?: number; longitude?: number }[];
}> {
  return api(`/api/corridor-routes/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
}

export async function fetchBuses(): Promise<{ items: BusRow[] }> {
  return api("/api/buses");
}

export async function fetchLiveDispatchBlocks(): Promise<{
  items: LiveDispatchBlock[];
  holidayBanner: { holidayName: string; message: string; updatedAt: string } | null;
  manilaDate?: string;
}> {
  return api("/api/live-dispatch/blocks");
}

export async function fetchFleetHardwareStatus(): Promise<{
  items: FleetHardwareStatusRow[];
  generatedAt: string;
}> {
  return api("/api/fleet/hardware-status");
}

export async function createLiveDispatchBlock(body: {
  busId: string;
  routeId: string;
  routeLabel?: string;
  departurePoint?: string;
  scheduledDeparture: string;
  serviceDate?: string | null;
  status?: LiveDispatchBlock["status"];
}): Promise<LiveDispatchBlock> {
  return api("/api/live-dispatch/blocks", { method: "POST", json: body });
}

export async function patchLiveDispatchBlock(
  id: string,
  body: Partial<
    Pick<
      LiveDispatchBlock,
      | "status"
      | "scheduledDeparture"
      | "busId"
      | "routeId"
      | "routeLabel"
      | "departurePoint"
      | "arrivalDetectedAt"
      | "arrivalTerminalName"
      | "gate"
      | "arrivalLockedEta"
      | "serviceDate"
    >
  >
): Promise<LiveDispatchBlock> {
  return api(`/api/live-dispatch/blocks/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
}

/** PUT alias for live-dispatch block (trip) updates — e.g. external geofence sync. */
export async function putScheduleTrip(
  tripId: string,
  body: Partial<
    Pick<
      LiveDispatchBlock,
      | "status"
      | "scheduledDeparture"
      | "arrivalDetectedAt"
      | "arrivalTerminalName"
      | "gate"
      | "arrivalLockedEta"
      | "departurePoint"
    >
  >
): Promise<LiveDispatchBlock> {
  return api(`/api/schedules/${encodeURIComponent(tripId)}`, { method: "PUT", json: body });
}

export async function deleteLiveDispatchBlock(id: string): Promise<void> {
  await api(`/api/live-dispatch/blocks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function postLiveDispatchBulkPeak(body: {
  routeId: string;
  routeLabel?: string;
  startTime?: string;
  intervalMinutes?: number;
  count?: number;
  busIds: string[];
}): Promise<{ items: LiveDispatchBlock[] }> {
  return api("/api/live-dispatch/bulk-peak", { method: "POST", json: body });
}

/** Replaces all trip rows for this bus with a single row for today (Asia/Manila). */
export async function postLiveDispatchPublishToday(body: {
  busId: string;
  routeId: string;
  routeLabel: string;
  departurePoint: string;
  departureTime: string;
}): Promise<{ item: LiveDispatchBlock }> {
  return api("/api/live-dispatch/publish-today", { method: "POST", json: body });
}

/** @deprecated Prefer postLiveDispatchPublishToday — weekly bulk creates many rows. */
export async function postLiveDispatchWeeklyPlan(body: {
  busId: string;
  routeId: string;
  routeLabel: string;
  departurePoint: string;
  departureTime: string;
  startDate: string;
  endDate: string;
  weekdays: number[];
}): Promise<{ items: LiveDispatchBlock[]; count: number }> {
  return api("/api/live-dispatch/bulk-weekly", { method: "POST", json: body });
}

export async function postHolidayScheduleOverride(body: {
  holidayName: string;
  message: string;
}): Promise<{ holidayName: string; message: string; updatedAt: string }> {
  return api("/api/live-dispatch/holiday-override", { method: "POST", json: body });
}

export async function clearHolidayScheduleOverride(): Promise<void> {
  await api("/api/live-dispatch/holiday-override", { method: "DELETE" });
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
  farePerKmPesos: number;
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

export async function patchFareMatrixEntry(
  id: string,
  body: { baseFarePesos: number }
): Promise<{ _id: string; startLabel: string; endLabel: string; baseFarePesos: number; updatedAt?: string }> {
  return api(`/api/fares/matrix/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
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

export type AdminBroadcastSeverity = "normal" | "medium" | "critical";

export type AdminBroadcastPayload = { target: string; message: string; severity: string; updatedAt: string };

export async function postAdminBroadcast(body: {
  /** Single target (legacy). Ignored if `targets` is set. */
  target?: "passenger" | "attendant";
  /** One or both apps — same message and severity to each. */
  targets?: ("passenger" | "attendant")[];
  message: string;
  severity: AdminBroadcastSeverity;
}): Promise<{
  ok: boolean;
  broadcasts: AdminBroadcastPayload[];
  broadcast?: AdminBroadcastPayload;
}> {
  return api("/api/admin/broadcast", { method: "POST", json: body });
}

export async function fetchReportsAnalytics(): Promise<ReportsAnalyticsDto> {
  return api("/api/reports/analytics");
}

export type MasterReportExportArea =
  | "passenger"
  | "attendants"
  | "bus"
  | "route"
  | "insights"
  | "timeWindowPickups"
  | "revenue";

/**
 * Server-side report download (admin JWT, blob).
 * - Excel: POST `/api/reports/export-excel` with `{ selectedAreas, dateRange }` → branded `Bukidnon_Transit_Report_*.xlsx`.
 * - PDF/CSV: POST `/api/reports/master-export` with `{ selectedAreas, format, dateRange }`.
 */
export async function downloadReportsMasterExport(body: {
  selectedAreas: MasterReportExportArea[];
  format: "pdf" | "csv" | "xlsx";
  dateRange: { start: string; end: string };
}): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const bases =
    API_BASE === ""
      ? [""]
      : API_BASE === API_FALLBACK_BASE
        ? [API_BASE]
        : [API_BASE, API_FALLBACK_BASE];

  const path =
    body.format === "xlsx" ? "/api/reports/export-excel" : "/api/reports/master-export";
  const payload =
    body.format === "xlsx"
      ? { selectedAreas: body.selectedAreas, dateRange: body.dateRange }
      : body;

  let lastErr: Error | null = null;
  for (const base of bases) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (bases.length > 1 && base === API_BASE) continue;
      throw lastErr;
    }

    if (!res.ok) {
      const text = await res.text();
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) message = j.error;
      } catch {
        if (text && !text.trim().startsWith("<")) message = text.slice(0, 240);
      }
      if (res.status === 404 && message === "Endpoint not found.") {
        message =
          "Admin API 404 — often caused by VITE_ADMIN_API_URL including /api (use origin only, e.g. http://127.0.0.1:4001). Check Network tab for a doubled /api/api/ path.";
      }
      lastErr = new Error(message);
      if (res.status === 404 && bases.length > 1 && base === API_BASE) continue;
      throw lastErr;
    }

    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition");
    let filename = `BBC_master_report.${body.format === "xlsx" ? "xlsx" : body.format}`;
    if (cd) {
      const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(cd) || /filename="([^"]+)"/i.exec(cd);
      const raw = m?.[1]?.trim();
      if (raw) filename = decodeURIComponent(raw);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  throw lastErr || new Error("Master export failed");
}

export async function fetchDailyOperationsReport(dateYmd?: string): Promise<DailyOperationsReportDto> {
  const d = dateYmd?.trim().slice(0, 10);
  const q = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `?date=${encodeURIComponent(d)}` : "";
  return api<DailyOperationsReportDto>(`/api/reports/daily-operations${q}`);
}

export async function fetchDailyOpsSnapshotList(): Promise<DailyOpsSnapshotListDto> {
  try {
    return await api<DailyOpsSnapshotListDto>("/api/admin/daily-ops-snapshots");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("not on this Admin API") || msg.includes("Endpoint not found")) {
      return api<DailyOpsSnapshotListDto>("/api/reports/daily-ops-snapshots");
    }
    throw e;
  }
}

/** Download automated daily-ops JSON/PDF from server snapshot dir (admin JWT). */
export async function downloadDailyOpsSnapshotFile(filename: string): Promise<void> {
  const token = getToken();
  const q = `?f=${encodeURIComponent(filename)}`;
  const pathVariants = [
    `/api/admin/daily-ops-snapshots/download${q}`,
    `/api/reports/daily-ops-snapshots/download${q}`,
  ];
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const bases =
    API_BASE === ""
      ? [""]
      : API_BASE === API_FALLBACK_BASE
        ? [API_BASE]
        : [API_BASE, API_FALLBACK_BASE];
  let lastErr: Error | null = null;
  for (const base of bases) {
    for (const path of pathVariants) {
      let res: Response;
      try {
        res = await fetch(`${base}${path}`, { headers });
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        continue;
      }
      if (res.status === 404) {
        const t = await res.text();
        let errStr = "";
        try {
          const j = JSON.parse(t) as { error?: string };
          errStr = String(j.error || "");
        } catch {
          errStr = t.slice(0, 120);
        }
        if (errStr.includes("Endpoint not found")) {
          continue;
        }
        lastErr = new Error(errStr || "Not found");
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        let message = res.statusText;
        try {
          const j = JSON.parse(text) as { error?: string };
          if (j.error) message = j.error;
        } catch {
          if (text) message = text.slice(0, 200);
        }
        lastErr = new Error(message);
        continue;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
  }
  throw lastErr ?? new Error("Download failed");
}

export async function fetchPassengerFeedbackDashboard(): Promise<PassengerFeedbackDashboardDto> {
  return api("/api/passenger-feedback/dashboard");
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
      | "delayThresholdMinutes"
      | "geofenceBreachToasts"
      | "sensitiveActionConfirmation"
    >
  >;
  security?: Partial<
    Pick<
      AdminPortalSettingsDto,
      | "maxLoginAttempts"
      | "lockoutMinutes"
      | "sessionTimeoutMinutes"
      | "securityPolicyApplyAdmin"
      | "securityPolicyApplyAttendant"
    >
  >;
  branding?: Partial<
    Pick<
      AdminPortalSettingsDto,
      | "companyName"
      | "companyEmail"
      | "companyPhone"
      | "companyLocation"
      | "sidebarLogoUrl"
      | "faviconUrl"
      | "reportFooter"
    >
  >;
  clientApps?: {
    attendantAppAccess?: Partial<AttendantAppAccessDto>;
    passengerAppAccess?: Partial<PassengerAppAccessDto>;
  };
  maintenance?: Partial<{
    maintenanceShieldEnabled: boolean;
    maintenancePassengerLocked: boolean;
    maintenanceAttendantLocked: boolean;
    maintenanceMessage: string;
    maintenanceScheduledUntil: string | null;
    minAttendantAppVersion: string;
    fleetMode: FleetMode;
  }>;
  dailyOpsReport?: {
    enabled?: boolean;
    emailTime?: string;
    recipients?: string[];
    /** Merge logged-in admin email into recipients (server-side). */
    includeSavingAdminEmail?: boolean;
  };
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
