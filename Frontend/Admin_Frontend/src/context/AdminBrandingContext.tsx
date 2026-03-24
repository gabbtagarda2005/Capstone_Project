import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "admin_branding_v1";

export type AdminBranding = {
  companyName: string;
  /** HTTPS URL or data URL; null = letter fallback in sidebar */
  logoUrl: string | null;
};

export const DEFAULT_ADMIN_BRANDING: AdminBranding = {
  companyName: "Bukidnon",
  logoUrl: null,
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
    return { companyName, logoUrl };
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
  return { companyName, logoUrl };
}

type Ctx = {
  branding: AdminBranding;
  setBranding: (next: Partial<AdminBranding>) => void;
  resetBranding: () => void;
};

const AdminBrandingContext = createContext<Ctx | null>(null);

export function AdminBrandingProvider({ children }: { children: ReactNode }) {
  const branding = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

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
    }),
    [branding, setBranding, resetBranding]
  );

  return <AdminBrandingContext.Provider value={value}>{children}</AdminBrandingContext.Provider>;
}

export function useAdminBranding() {
  const ctx = useContext(AdminBrandingContext);
  if (!ctx) throw new Error("useAdminBranding must be used within AdminBrandingProvider");
  return ctx;
}
