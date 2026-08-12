import type { AdminAuditLogRowDto } from "@/lib/types";

/** Short label for dashboard "Top pickup" list: full string in tooltip, compact in UI. */
export function shortPickupLocationLabel(full: string): string {
  const t = full.trim();
  if (!t) return full;
  if (/^unknown$/i.test(t)) return t;
  const paren = /\(([^)]+)\)\s*$/.exec(t);
  const city = paren?.[1]?.trim();
  if (city) return `${city} Bukidnon Terminal`;
  const integ = /^(.+?)\s+Integrated Bus Terminal/i.exec(t);
  const place = integ?.[1]?.trim();
  if (place) return `${place} Bukidnon Terminal`;
  if (!t.includes(",") && t.length <= 48) {
    return `${t} Bukidnon Terminal`;
  }
  return t;
}

export function parseAuditDetails(details: string): { method: string; path: string; jsonSuffix: string } {
  const trimmed = details.trim();
  const sep = trimmed.indexOf(" — ");
  const main = sep >= 0 ? trimmed.slice(0, sep) : trimmed;
  const jsonSuffix = sep >= 0 ? trimmed.slice(sep + 3).trim() : "";
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i.exec(main);
  if (!m?.[1] || !m[2]) return { method: "", path: "", jsonSuffix: trimmed };
  return { method: m[1].toUpperCase(), path: m[2], jsonSuffix };
}

function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function busPhraseFromBody(jsonSuffix: string): string | null {
  const o = tryParseJsonObject(jsonSuffix);
  if (!o) return null;
  const raw = o.busId ?? o.bus_id;
  if (raw == null || raw === "") return null;
  const id = String(raw).trim();
  if (!id) return null;
  return `Bus #${id}`;
}

function resourceIdFromPath(path: string): string | null {
  if (!path.startsWith("/api/")) return null;
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 3) return null;
  const last = segments[segments.length - 1];
  if (!last || /^(admin|public|live|status|broadcast)$/i.test(last)) return null;
  if (segments.length >= 4 && segments[segments.length - 2] === "admin") return null;
  return decodeURIComponent(last);
}

function statusFromBody(jsonSuffix: string): string | null {
  const o = tryParseJsonObject(jsonSuffix);
  if (!o) return null;
  const st = o.status ?? o.busStatus ?? o.state;
  if (st == null) return null;
  const v = String(st).trim();
  return v || null;
}

export function formatRelativeAuditTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  let diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 0) diffSec = 0;
  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return m <= 1 ? "1 min ago" : `${m} min ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return h <= 1 ? "1 hour ago" : `${h} hours ago`;
  }
  const d = Math.floor(diffSec / 86400);
  if (d === 1) return "Yesterday";
  if (d < 14) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Primary emoji for timeline (GPS-style events override HTTP verb). */
export function auditTimelineEmoji(row: AdminAuditLogRowDto): string {
  const path = (row.path && row.path.trim()) || parseAuditDetails(row.details).path;
  const low = path.toLowerCase();
  if (low.includes("test-gps") || low.includes("hardware-telemetry") || low.includes("/live-location")) {
    return "\u{1F4CD}";
  }
  const a = String(row.action || "").toUpperCase();
  if (a === "DELETE") return "\u274C";
  if (a === "EDIT") return "\u270F\uFE0F";
  if (a === "ADD") return "\u2795";
  if (a === "BROADCAST") return "\u{1F4E2}";
  if (a === "LOGIN") return "\u{1F511}";
  return "\u{1F441}\uFE0F";
}

export function humanizeAdminAuditSentence(row: AdminAuditLogRowDto): string {
  const src = String(row.source || "").toLowerCase();
  if (src === "client") {
    const d = row.details.trim();
    return d || "Recorded an action from the admin console.";
  }

  const path = (row.path && row.path.trim()) || parseAuditDetails(row.details).path;
  const { method, path: pathFromDetails, jsonSuffix } = parseAuditDetails(row.details);
  const effPath = path || pathFromDetails;
  const effMethod = (row.httpMethod && row.httpMethod.trim()) || method;
  const action = String(row.action || "").toUpperCase();
  const body = tryParseJsonObject(jsonSuffix);

  if (action === "LOGIN") {
    return effPath.includes("google-login") ? "Signed in with Google." : "Signed in with email and password.";
  }

  if (effPath === "/api/buses/admin/test-gps" && effMethod === "POST") {
    const bus = busPhraseFromBody(jsonSuffix) ?? "a fleet bus";
    return `Tested GPS tracking for ${bus} (live map check).`;
  }

  if (effPath.startsWith("/api/admin/broadcast") && effMethod === "POST") {
    const sev = body?.severity != null ? String(body.severity) : "";
    return sev ? `Sent an in-app broadcast (${sev}).` : "Sent an in-app broadcast to passengers or attendants.";
  }

  if (effPath.startsWith("/api/buses/") && effMethod === "PATCH") {
    const id = resourceIdFromPath(effPath);
    const st = statusFromBody(jsonSuffix);
    if (st) {
      return id
        ? `Updated bus status to "${st}" (${id}).`
        : `Updated bus status to "${st}".`;
    }
    return id ? `Updated bus registration (${id}).` : "Updated bus registration.";
  }

  if (effPath.startsWith("/api/buses/") && effMethod === "POST" && effPath !== "/api/buses/admin/test-gps") {
    return "Added a bus to the fleet registry.";
  }

  if (effPath.startsWith("/api/buses/") && effMethod === "DELETE") {
    const id = resourceIdFromPath(effPath);
    return id ? `Removed bus ${id} from the registry.` : "Removed a bus from the registry.";
  }

  if (effPath.startsWith("/api/drivers/") && effMethod === "DELETE") {
    const id = resourceIdFromPath(effPath);
    return id ? `Removed driver account ${id}.` : "Removed a driver account.";
  }

  if (effPath.startsWith("/api/driver-signup/") && effMethod === "DELETE") {
    return "Removed a driver signup record.";
  }

  if (effPath.startsWith("/api/attendants/") && effMethod === "DELETE") {
    const id = resourceIdFromPath(effPath);
    return id ? `Removed attendant account ${id}.` : "Removed an attendant account.";
  }

  if (effPath.startsWith("/api/locations")) {
    if (effMethod === "POST") return "Added or updated a stop/terminal in Location management.";
    if (effMethod === "PATCH" || effMethod === "PUT") return "Updated a stop or terminal.";
    if (effMethod === "DELETE") return "Removed a location entry.";
  }

  if (effPath.startsWith("/api/fares")) {
    if (effMethod === "PATCH" || effMethod === "PUT") return "Updated fare settings or the fare matrix.";
    if (effMethod === "POST") return "Added a fare matrix row or pricing rule.";
  }

  if (effPath.startsWith("/api/corridor-routes")) {
    if (effMethod === "POST") return "Created or duplicated a corridor route.";
    if (effMethod === "PATCH" || effMethod === "PUT") return "Updated a corridor route.";
    if (effMethod === "DELETE") return "Removed a corridor route.";
  }

  if (effPath.startsWith("/api/tickets")) {
    return action === "VIEW" ? "Opened ticket records." : "Changed ticket-related data.";
  }

  if (effPath === "/api/admin/rbac" && effMethod === "PUT") {
    const items = Array.isArray(body?.items) ? (body.items as Array<{ email?: unknown; role?: unknown }>) : null;
    if (items && items.length > 0) {
      const roleLabel = (r: unknown) => {
        const s = String(r ?? "");
        if (s === "super_admin") return "Super Admin";
        if (s === "fleet_manager") return "Fleet Manager";
        if (s === "auditor") return "Auditor";
        if (s === "it_support") return "IT Support";
        return s || "—";
      };
      const parts = items
        .filter((it) => it && it.email)
        .slice(0, 4)
        .map((it) => `${String(it.email)} → ${roleLabel(it.role)}`);
      const more = items.length > 4 ? ` (+${items.length - 4} more)` : "";
      return `Set admin role assignments: ${parts.join(", ")}${more}.`;
    }
    return "Updated admin role assignments.";
  }

  if (effPath === "/api/admin/settings" && (effMethod === "PUT" || effMethod === "PATCH")) {
    const keys = body ? Object.keys(body) : [];
    if (keys.length > 0) {
      const pretty = keys.map((k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
      return `Updated settings: ${pretty.join(", ")}.`;
    }
    return "Updated portal settings.";
  }

  if (effPath === "/api/admin/it-accounts/send-otp" && effMethod === "POST") {
    const email = body?.email != null ? String(body.email) : null;
    return email ? `Sent an IT-account verification code to ${email}.` : "Sent an IT-account verification code.";
  }

  if (effPath === "/api/admin/it-accounts/verify-otp" && effMethod === "POST") {
    const email = body?.email != null ? String(body.email) : null;
    return email ? `Verified the IT-account code for ${email}.` : "Verified an IT-account code.";
  }

  if (effPath === "/api/admin/it-accounts/create" && effMethod === "POST") {
    return "Created a new IT account (System Health access only).";
  }

  if (effPath.startsWith("/api/operators")) {
    if (effMethod === "DELETE") return "Removed an operator portal user.";
    if (effMethod === "POST") return "Added an operator portal user.";
    return "Updated operator portal settings.";
  }

  const mod = row.module || "Administration";
  const tail = effPath.replace(/^\/api\//, "");
  if (action === "DELETE") return `Removed a record in ${mod}.`;
  if (action === "ADD") return `Added a record in ${mod}.`;
  if (action === "EDIT") return `Updated a record in ${mod}.`;
  if (action === "VIEW") return `Viewed ${mod} data.`;
  if (effPath && effMethod) return `${effMethod} ${tail || effPath} (${mod}).`;
  return row.details.trim() || "Recorded an admin action.";
}
