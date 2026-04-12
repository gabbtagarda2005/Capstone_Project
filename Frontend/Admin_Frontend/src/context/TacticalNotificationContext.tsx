import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { GEOFENCE_BREACH_EVENT, type GeofenceBreachDetail } from "@/lib/geofenceEvents";
import { tacticalMapFlyTo } from "@/lib/tacticalMapFlyTo";

export type TacticalVisualKind = "sos" | "geofence" | "system" | "maintenance";

export type TacticalFeedItem = {
  id: string;
  kind: TacticalVisualKind;
  title: string;
  subtitle: string;
  busId?: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  /** Lower = higher priority in list (after pinned SOS). */
  priority: number;
  dismissable: boolean;
};

type CommandAlertPayload = {
  kind?: string;
  id?: string;
  category?: string;
  busId?: string;
  plateNumber?: string;
  latitude?: number;
  longitude?: number;
  message?: string;
  createdAt?: string;
};

type Ctx = {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  items: TacticalFeedItem[];
  dismiss: (id: string) => void;
  flyToItem: (item: TacticalFeedItem) => void;
};

const TacticalNotificationContext = createContext<Ctx | null>(null);

const OPS_LINK_KEY = "tactical_ops_link_shown_v1";

function itemFromGeofence(d: GeofenceBreachDetail): TacticalFeedItem {
  return {
    id: `geofence-${d.breachId}`,
    kind: "geofence",
    title: "Geofence breach",
    subtitle: `Bus ${d.busId} · Terminal context: ${d.currentTerminal} · ${d.assignedRoute}`,
    busId: d.busId,
    latitude: d.latitude,
    longitude: d.longitude,
    createdAt: new Date().toISOString(),
    priority: 1,
    dismissable: true,
  };
}

function itemFromIncident(raw: CommandAlertPayload): TacticalFeedItem | null {
  if (raw.kind !== "incident" || !raw.id || !raw.busId) return null;
  const la = Number(raw.latitude);
  const ln = Number(raw.longitude);
  const cat = raw.category ? String(raw.category) : "report";
  return {
    id: `incident-${raw.id}`,
    kind: "maintenance",
    title: "Vehicle / ops report",
    subtitle: `${cat.toUpperCase()} · ${raw.message ?? `Bus ${raw.busId}`}`,
    busId: String(raw.busId),
    latitude: Number.isFinite(la) ? la : undefined,
    longitude: Number.isFinite(ln) ? ln : undefined,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    priority: 2,
    dismissable: true,
  };
}

export function TacticalNotificationProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rows, setRows] = useState<TacticalFeedItem[]>([]);
  const dismissed = useRef<Set<string>>(new Set());

  const pushUnique = useCallback((item: TacticalFeedItem) => {
    if (dismissed.current.has(item.id)) return;
    setRows((prev) => {
      if (prev.some((x) => x.id === item.id)) return prev;
      const next = [...prev, item];
      next.sort((a, b) => a.priority - b.priority || (a.createdAt < b.createdAt ? 1 : -1));
      return next.slice(-40);
    });
  }, []);

  useEffect(() => {
    const onBreach = (e: Event) => {
      const ce = e as CustomEvent<GeofenceBreachDetail>;
      if (!ce.detail?.busId) return;
      pushUnique(itemFromGeofence(ce.detail));
    };
    window.addEventListener(GEOFENCE_BREACH_EVENT, onBreach);
    return () => window.removeEventListener(GEOFENCE_BREACH_EVENT, onBreach);
  }, [pushUnique]);

  useEffect(() => {
    const onCmd = (e: Event) => {
      const ce = e as CustomEvent<CommandAlertPayload>;
      const raw = ce.detail;
      if (!raw) return;
      if (raw.kind === "sos") return;
      const inc = itemFromIncident(raw);
      if (inc) pushUnique(inc);
    };
    window.addEventListener("admin-tactical-command", onCmd);
    return () => window.removeEventListener("admin-tactical-command", onCmd);
  }, [pushUnique]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPS_LINK_KEY)) return;
      sessionStorage.setItem(OPS_LINK_KEY, "1");
      pushUnique({
        id: `system-ops-${Date.now()}`,
        kind: "system",
        title: "System sync",
        subtitle: "Realtime command channel linked to Admin API.",
        createdAt: new Date().toISOString(),
        priority: 4,
        dismissable: true,
      });
    } catch {
      /* ignore */
    }
  }, [pushUnique]);

  const dismiss = useCallback((id: string) => {
    dismissed.current.add(id);
    setRows((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const flyToItem = useCallback((item: TacticalFeedItem) => {
    if (item.latitude != null && item.longitude != null) {
      tacticalMapFlyTo(item.latitude, item.longitude, item.kind === "sos" ? 16 : 14);
    }
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  const value = useMemo<Ctx>(
    () => ({
      sidebarOpen,
      setSidebarOpen,
      toggleSidebar,
      items: rows,
      dismiss,
      flyToItem,
    }),
    [sidebarOpen, rows, dismiss, flyToItem, toggleSidebar]
  );

  return <TacticalNotificationContext.Provider value={value}>{children}</TacticalNotificationContext.Provider>;
}

export function useTacticalNotifications(): Ctx {
  const c = useContext(TacticalNotificationContext);
  if (!c) throw new Error("useTacticalNotifications must be used under TacticalNotificationProvider");
  return c;
}

export function useTacticalNotificationsOptional(): Ctx | null {
  return useContext(TacticalNotificationContext);
}
