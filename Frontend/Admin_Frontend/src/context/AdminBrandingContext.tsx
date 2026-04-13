import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchAdminPortalSettings } from "@/lib/api";
import { LS_SEC_GEOFENCE_PUSH, LS_SEC_SENSITIVE_REAUTH, writeLsBool } from "@/lib/settingsPrefs";

const STORAGE_KEY = "admin_branding_v2";

export type AdminBranding = {
  companyName: string;
  /** Legacy / fallback image for sidebar when sidebarLogoUrl is empty */
  logoUrl: string | null;
  /** Circular “B” mark in sidebar */
  sidebarLogoUrl: string | null;
  faviconUrl: string | null;
  reportFooter: string;
  /** Mirrored from server security policy for inactivity logout */
  sessionTimeoutMinutes: number;
  /** When false, admin shell does not auto-logout on idle (Settings → Security). */
  securityPolicyApplyAdmin: boolean;
};

export const DEFAULT_ADMIN_BRANDING: AdminBranding = {
  companyName: "Bukidnon Bus Company",
  logoUrl: null,
  sidebarLogoUrl: null,
  faviconUrl: null,
  reportFooter: "© 2026 Bukidnon Bus Company - Fleet Management Division",
  sessionTimeoutMinutes: 30,
  securityPolicyApplyAdmin: true,
};

function parseStored(): AdminBranding {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ADMIN_BRANDING;
    const parsed = JSON.parse(raw) as Partial<AdminBranding>;
    const companyName =
      typeof parsed.companyName === "string" && parsed.companyName.trim()
        ? parsed.companyName.trim()
        : DEFAULT_ADMIN_BRANDING.companyName;
    const logoUrl =
      typeof parsed.logoUrl === "string" && parsed.logoUrl.length > 0 ? parsed.logoUrl : null;
    const sidebarLogoUrl =
      typeof parsed.sidebarLogoUrl === "string" && parsed.sidebarLogoUrl.length > 0
        ? parsed.sidebarLogoUrl
        : null;
    const faviconUrl =
      typeof parsed.faviconUrl === "string" && parsed.faviconUrl.length > 0 ? parsed.faviconUrl : null;
    const reportFooter =
      typeof parsed.reportFooter === "string" && parsed.reportFooter.trim()
        ? parsed.reportFooter.trim()
        : DEFAULT_ADMIN_BRANDING.reportFooter;
    const sessionTimeoutMinutes =
      typeof parsed.sessionTimeoutMinutes === "number" &&
      Number.isFinite(parsed.sessionTimeoutMinutes) &&
      parsed.sessionTimeoutMinutes >= 5
        ? parsed.sessionTimeoutMinutes
        : DEFAULT_ADMIN_BRANDING.sessionTimeoutMinutes;
    const securityPolicyApplyAdmin =
      parsed.securityPolicyApplyAdmin === undefined ? true : Boolean(parsed.securityPolicyApplyAdmin);
    return {
      companyName,
      logoUrl,
      sidebarLogoUrl,
      faviconUrl,
      reportFooter,
      sessionTimeoutMinutes,
      securityPolicyApplyAdmin,
    };
  } catch {
    return DEFAULT_ADMIN_BRANDING;
  }
}

function writeStored(b: AdminBranding) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
}

let memory = parseStored();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return memory;
}

function getServerSnapshot() {
  return DEFAULT_ADMIN_BRANDING;
}

function emit(next: AdminBranding) {
  memory = next;
  writeStored(next);
  listeners.forEach((l) => l());
}

function normalize(next: Partial<AdminBranding>): AdminBranding {
  const companyName =
    next.companyName !== undefined
      ? next.companyName.trim() || DEFAULT_ADMIN_BRANDING.companyName
      : memory.companyName;
  const logoUrl =
    next.logoUrl !== undefined
      ? next.logoUrl && String(next.logoUrl).trim()
        ? String(next.logoUrl).trim()
        : null
      : memory.logoUrl;
  const sidebarLogoUrl =
    next.sidebarLogoUrl !== undefined
      ? next.sidebarLogoUrl && String(next.sidebarLogoUrl).trim()
        ? String(next.sidebarLogoUrl).trim()
        : null
      : memory.sidebarLogoUrl;
  const faviconUrl =
    next.faviconUrl !== undefined
      ? next.faviconUrl && String(next.faviconUrl).trim()
        ? String(next.faviconUrl).trim()
        : null
      : memory.faviconUrl;
  const reportFooter =
    next.reportFooter !== undefined
      ? next.reportFooter.trim() || DEFAULT_ADMIN_BRANDING.reportFooter
      : memory.reportFooter;
  const sessionTimeoutMinutes =
    next.sessionTimeoutMinutes !== undefined
      ? Math.max(5, Math.min(480, next.sessionTimeoutMinutes || 30))
      : memory.sessionTimeoutMinutes;
  const securityPolicyApplyAdmin =
    next.securityPolicyApplyAdmin !== undefined
      ? Boolean(next.securityPolicyApplyAdmin)
      : memory.securityPolicyApplyAdmin;
  return {
    companyName,
    logoUrl,
    sidebarLogoUrl,
    faviconUrl,
    reportFooter,
    sessionTimeoutMinutes,
    securityPolicyApplyAdmin,
  };
}

type Ctx = {
  branding: AdminBranding;
  setBranding: (next: Partial<AdminBranding>) => void;
  resetBranding: () => void;
  applyServerSettings: (s: {
    companyName: string;
    sidebarLogoUrl: string | null;
    faviconUrl: string | null;
    reportFooter: string;
    sessionTimeoutMinutes: number;
    securityPolicyApplyAdmin: boolean;
    geofenceBreachToasts: boolean;
    sensitiveActionConfirmation: boolean;
  }) => void;
};

const AdminBrandingContext = createContext<Ctx | null>(null);

export function AdminBrandingProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const branding = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const applyServerSettings = useCallback(
    (s: {
      companyName: string;
      sidebarLogoUrl: string | null;
      faviconUrl: string | null;
      reportFooter: string;
      sessionTimeoutMinutes: number;
      securityPolicyApplyAdmin: boolean;
      geofenceBreachToasts: boolean;
      sensitiveActionConfirmation: boolean;
    }) => {
      emit(
        normalize({
          companyName: s.companyName,
          logoUrl: s.sidebarLogoUrl,
          sidebarLogoUrl: s.sidebarLogoUrl,
          faviconUrl: s.faviconUrl,
          reportFooter: s.reportFooter,
          sessionTimeoutMinutes: s.sessionTimeoutMinutes,
          securityPolicyApplyAdmin: s.securityPolicyApplyAdmin,
        })
      );
      writeLsBool(LS_SEC_GEOFENCE_PUSH, s.geofenceBreachToasts !== false);
      writeLsBool(LS_SEC_SENSITIVE_REAUTH, s.sensitiveActionConfirmation === true);
      try {
        localStorage.setItem("admin_session_timeout_minutes", String(s.sessionTimeoutMinutes ?? 30));
      } catch {
        /* ignore */
      }
    },
    []
  );

  useEffect(() => {
    if (!token || user?.role !== "Admin") return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchAdminPortalSettings();
        if (cancelled) return;
        const s = r.settings;
        applyServerSettings({
          companyName: s.companyName,
          sidebarLogoUrl: s.sidebarLogoUrl,
          faviconUrl: s.faviconUrl,
          reportFooter: s.reportFooter,
          sessionTimeoutMinutes: s.sessionTimeoutMinutes ?? 30,
          securityPolicyApplyAdmin: s.securityPolicyApplyAdmin !== false,
          geofenceBreachToasts: s.geofenceBreachToasts !== false,
          sensitiveActionConfirmation: s.sensitiveActionConfirmation === true,
        });
      } catch {
        /* offline / 401 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user?.role, user?.email, applyServerSettings]);

  const setBranding = useCallback((next: Partial<AdminBranding>) => {
    emit(normalize(next));
  }, []);

  const resetBranding = useCallback(() => {
    emit({ ...DEFAULT_ADMIN_BRANDING });
  }, []);

  const value = useMemo(
    () => ({
      branding,
      setBranding,
      resetBranding,
      applyServerSettings,
    }),
    [branding, setBranding, resetBranding, applyServerSettings]
  );

  return <AdminBrandingContext.Provider value={value}>{children}</AdminBrandingContext.Provider>;
}

export function useAdminBranding() {
  const ctx = useContext(AdminBrandingContext);
  if (!ctx) throw new Error("useAdminBranding must be used within AdminBrandingProvider");
  return ctx;
}
