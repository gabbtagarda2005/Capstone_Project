import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useSearchParams } from "react-router-dom";
import {
  Circle as LeafletCircle,
  CircleMarker,
  MapContainer,
  Marker as LeafletMarker,
  Polyline as LeafletPolyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  BicyclingLayer,
  CircleF,
  GoogleMap,
  InfoWindowF,
  MarkerF,
  PolylineF,
  TrafficLayer,
  TransitLayer,
  useJsApiLoader,
} from "@react-google-maps/api";
import { useAuth } from "@/context/AuthContext";
import {
  ADMIN_API_ORIGIN,
  api,
  fetchCorridorBuilderContext,
  fetchCorridorRoutes,
  fetchLiveDispatchBlocks,
  getToken,
} from "@/lib/api";
import type { CorridorBuilderTerminal, CorridorRouteRow, TicketRow, BusLiveLogRow, BusRow, LiveDispatchBlock } from "@/lib/types";
import { haversineMeters, minDistanceToPolylineMetersWithClosestSegment } from "@/lib/haversineMeters";
import { type GpsSignalTier } from "@/lib/locationsMapUtils";
import { LiveFleetBusCard } from "@/components/LiveFleetBusCard";
import { MapControlPanel, type MapLayerKey, type MapLayerState, type BasemapMode } from "@/components/map/MapControlPanel";
import { TacticalMapLegendHud } from "@/components/map/TacticalMapLegendHud";
import "./LocationsPage.css";

const DEFAULT_CENTER: [number, number] = [8.1477, 125.1324];
const DEFAULT_ZOOM = 10;
const BUKIDNON_FOCUS: [number, number] = [8.0515, 125.0];
const BUKIDNON_FOCUS_ZOOM = 11.6;
/** If live GPS is farther than this from the assigned corridor polyline, mark deviation (meters). */
const ROUTE_GEOFENCE_BUFFER_M = 900;
/** Gray “last known” marker when server GPS timestamp is older than this (attendant HTTP ping ~7s). */
/** Stale if no newer sample than this (attendant pings every ~5s when live). */
const GPS_STALE_MS = 8 * 60 * 1000;
/** How often to reconcile map pins with MongoDB gps_logs while View Location is open */
const LIVE_GPS_POLL_MS = 2_000;
const DISPATCH_POLL_MS = 15_000;
const DELAY_HIGHLIGHT_MINUTES = 10;
const MAX_REASONABLE_DELAY_MINUTES = 180;
const TERMINAL_ARRIVAL_DISTANCE_M = 500;

function findCorridorForLabel(routeLabel: string | null, corridors: CorridorRouteRow[]): CorridorRouteRow | null {
  if (!routeLabel?.trim()) return null;
  const low = routeLabel.trim().toLowerCase();
  const exact = corridors.find(
    (c) => `${c.originLabel} → ${c.destLabel}`.toLowerCase() === low || c.displayName.toLowerCase() === low
  );
  if (exact) return exact;
  return (
    corridors.find((c) => low.includes(c.originLabel.toLowerCase()) && low.includes(c.destLabel.toLowerCase())) ||
    corridors.find((c) => c.displayName.toLowerCase().includes(low.slice(0, 12))) ||
    null
  );
}

function sortedStopsFromCorridor(c: CorridorRouteRow) {
  return [...c.authorizedStops].sort((a, b) => a.sequence - b.sequence);
}

function polylineFromCorridorRoute(c: CorridorRouteRow): [number, number][] {
  return sortedStopsFromCorridor(c).map((s) => [s.latitude, s.longitude] as [number, number]);
}

type SocketLocationPayload = {
  busId?: string;
  latitude?: number;
  longitude?: number;
  speedKph?: number | null;
  heading?: number | null;
  recordedAt?: string;
  attendantName?: string | null;
  signal?: GpsSignalTier | null;
  source?: "staff" | "hardware" | "mobile" | null;
  net?: "wifi" | "4g" | "unknown" | null;
  signalStrength?: number | null;
  voltage?: number | null;
  etaMinutes?: number | null;
  etaTargetIso?: string | null;
  nextTerminal?: string | null;
  trafficDelay?: boolean;
};

function parseSocketSignal(raw: unknown): GpsSignalTier | null {
  const s = raw != null ? String(raw).trim().toLowerCase() : "";
  if (s === "strong" || s === "weak" || s === "offline") return s;
  return null;
}

function parseSocketSource(raw: unknown): "staff" | "hardware" | "mobile" | null {
  const s = raw != null ? String(raw).trim().toLowerCase() : "";
  if (s === "staff" || s === "hardware" || s === "mobile") return s;
  return null;
}

function parseSocketNet(raw: unknown): "wifi" | "4g" | "unknown" | null {
  const s = raw != null ? String(raw).trim().toLowerCase() : "";
  if (s === "wifi" || s === "4g" || s === "unknown") return s;
  return null;
}

function formatCorridorDisplay(routeLabel: string): string {
  const t = routeLabel.trim();
  if (!t || t === "Assigned route —") return "—";
  return t.replace(/\s*[→➔>–—-]\s*/g, " → ");
}

function formatFleetLastSync(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "Never";
  try {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

function mergeLiveLogRow(prev: BusLiveLogRow[], p: SocketLocationPayload): BusLiveLogRow[] {
  const busId = p.busId != null ? String(p.busId) : "";
  if (!busId) return prev;
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return prev;
  const recordedAt = p.recordedAt ?? new Date().toISOString();
  const nextMs = Date.parse(recordedAt);
  const row: BusLiveLogRow = {
    busId,
    latitude: lat,
    longitude: lng,
    speedKph: p.speedKph ?? null,
    heading: p.heading ?? null,
    recordedAt,
    attendantName: p.attendantName ?? undefined,
    ...(p.signal !== undefined ? { signal: p.signal } : {}),
    ...(p.source !== undefined ? { source: p.source } : {}),
    ...(p.net !== undefined ? { net: p.net } : {}),
    ...(p.signalStrength !== undefined ? { signalStrength: p.signalStrength } : {}),
    ...(p.voltage !== undefined ? { voltage: p.voltage } : {}),
    ...(p.etaMinutes !== undefined ? { etaMinutes: p.etaMinutes } : {}),
    ...(p.etaTargetIso !== undefined ? { etaTargetIso: p.etaTargetIso } : {}),
    ...(p.nextTerminal !== undefined ? { nextTerminal: p.nextTerminal } : {}),
    ...(p.trafficDelay !== undefined ? { trafficDelay: p.trafficDelay } : {}),
  };
  const idx = prev.findIndex((x) => x.busId === busId);
  if (idx >= 0) {
    const existing = prev[idx];
    if (!existing) return prev;
    const prevMs = Date.parse(existing.recordedAt ?? "");
    if (Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs < prevMs) {
      return prev;
    }
    const next = [...prev];
    next[idx] = {
      ...existing,
      ...row,
      signal: p.signal !== undefined ? p.signal : existing.signal,
      source: p.source !== undefined ? p.source : existing.source,
      net: p.net !== undefined ? p.net : existing.net,
      signalStrength: p.signalStrength !== undefined ? p.signalStrength : existing.signalStrength,
      voltage: p.voltage !== undefined ? p.voltage : existing.voltage,
      etaMinutes: p.etaMinutes !== undefined ? p.etaMinutes : existing.etaMinutes,
      etaTargetIso: p.etaTargetIso !== undefined ? p.etaTargetIso : existing.etaTargetIso,
      nextTerminal: p.nextTerminal !== undefined ? p.nextTerminal : existing.nextTerminal,
      trafficDelay: p.trafficDelay !== undefined ? p.trafficDelay : existing.trafficDelay,
    };
    return next;
  }
  return [...prev, row];
}

/**
 * Merge HTTP `/api/buses/live` with in-memory rows so a slow or stale poll cannot overwrite
 * a fresher position already applied via Socket.IO.
 */
function mergeFleetSnapshot(prev: BusLiveLogRow[], api: BusLiveLogRow[]): BusLiveLogRow[] {
  const prevById = new Map(prev.map((r) => [r.busId, r]));
  const out: BusLiveLogRow[] = [];
  for (const apiRow of api) {
    const oldRow = prevById.get(apiRow.busId);
    if (!oldRow) {
      out.push(apiRow);
      continue;
    }
    const tApi = Date.parse(apiRow.recordedAt ?? "");
    const tOld = Date.parse(oldRow.recordedAt ?? "");
    if (Number.isFinite(tOld) && Number.isFinite(tApi) && tOld > tApi) {
      out.push(oldRow);
    } else {
      out.push({ ...oldRow, ...apiRow });
    }
  }
  return out;
}

const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
/** Data-URL SVG markers for Google Maps (Symbol `path` strings are unreliable in some Maps + React combos). */
const GOOGLE_TERMINAL_HEX_ICON: google.maps.Icon = {
  url:
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">' +
        '<polygon points="21,6 36,15 36,27 21,36 6,27 6,15" fill="#34d399" stroke="#065f46" stroke-width="2.5"/>' +
        "</svg>"
    ),
  scaledSize: { width: 42, height: 42 } as google.maps.Size,
  anchor: { x: 21, y: 21 } as google.maps.Point,
};
/** Location waypoints + corridor bus stops — small cyan dot, no geofence on View Location. */
const GOOGLE_CYAN_WAYPOINT_ICON: google.maps.Icon = {
  url:
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">' +
        '<circle cx="7" cy="7" r="5.2" fill="#22d3ee" stroke="#0b1220" stroke-width="1.8"/>' +
        "</svg>"
    ),
  scaledSize: { width: 14, height: 14 } as google.maps.Size,
  anchor: { x: 7, y: 7 } as google.maps.Point,
};
/** Flexible / free-pickup zone (dashed cyan ring). */
const GOOGLE_CYAN_WAYPOINT_FLEX_ICON: google.maps.Icon = {
  url:
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
        '<circle cx="11" cy="11" r="9" fill="none" stroke="#67e8f9" stroke-width="2" stroke-dasharray="4 3"/>' +
        '<circle cx="11" cy="11" r="5" fill="#22d3ee" stroke="#0b1220" stroke-width="1.6"/>' +
        "</svg>"
    ),
  scaledSize: { width: 22, height: 22 } as google.maps.Size,
  anchor: { x: 11, y: 11 } as google.maps.Point,
};
const GOOGLE_DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#93a4c3" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1220" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1f2a40" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#253a61" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#081426" }] },
];

const TILE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const LEAFLET_STOP_ICON = L.divIcon({
  className: "locations-page__leaflet-stop",
  html:
    '<div style="width:11px;height:11px;border-radius:50%;background:#22d3ee;border:2px solid #0b1220;box-sizing:border-box"></div>',
  iconSize: [11, 11],
  iconAnchor: [5, 5],
});
const LEAFLET_STOP_FLEX_ICON = L.divIcon({
  className: "locations-page__leaflet-stop locations-page__leaflet-stop--flex",
  html:
    '<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center">' +
    '<div style="position:absolute;inset:0;border-radius:50%;border:2px dashed rgba(103,232,249,0.95);box-sizing:border-box"></div>' +
    '<div style="width:11px;height:11px;border-radius:50%;background:#22d3ee;border:2px solid #0b1220;box-sizing:border-box"></div>' +
    "</div>",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const LEAFLET_TERMINAL_ICON = L.divIcon({
  className: "locations-page__leaflet-terminal",
  html:
    '<div class="locations-page__leaflet-terminal-inner" aria-hidden>' +
    '<svg width="32" height="32" viewBox="-1.1 -1.1 2.2 2.2" focusable="false">' +
    '<polygon points="0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5" fill="#34d399" stroke="#065f46" stroke-width="0.12" />' +
    "</svg></div>",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});
const LEAFLET_BUS_ICON = L.divIcon({
  className: "locations-page__leaflet-bus",
  html: '<div style="font-size:18px;line-height:18px">🚌</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/** Sidebar legend — same geometry/colors as map terminal hex (Leaflet / Google). */
function LocationsLegendTerminalPin() {
  return (
    <span className="locations-page__legend-pin locations-page__legend-pin--terminal" aria-hidden title="Terminal hub marker">
      <svg className="locations-page__legend-pin-svg" viewBox="-1.1 -1.1 2.2 2.2" width={22} height={22} focusable="false">
        <polygon
          points="0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5"
          fill="#34d399"
          stroke="#065f46"
          strokeWidth="0.14"
        />
      </svg>
    </span>
  );
}

/** Sidebar legend — same as LEAFLET_STOP_ICON / GOOGLE_CYAN_WAYPOINT_ICON (cyan dot + dark ring). */
function LocationsLegendBusStopPin() {
  return (
    <span className="locations-page__legend-pin locations-page__legend-pin--stop" aria-hidden title="Stop marker">
      <span className="locations-page__legend-stop-disc" />
    </span>
  );
}


type TrailPoint = { lat: number; lng: number; at: number; speed: number | null };
const TRAIL_MAX_POINTS = 50;
const TRAIL_MAX_AGE_MS = 12 * 60_000;


type AdminHub = {
  id: string;
  name: string;
  pos: [number, number];
  radiusM: number;
  aliases: string[];
  ticketCountToday: number;
  buses: string[];
  loadLevel: "high" | "medium" | "low";
  loadColor: string;
};

function normLoc(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function ticketTouchesHub(t: TicketRow, aliases: string[]): boolean {
  const start = normLoc(t.startLocation);
  const dest = normLoc(t.destination);
  for (const raw of aliases) {
    const a = normLoc(raw);
    if (!a) continue;
    if (start === a || dest === a) return true;
    if (start.includes(a) || dest.includes(a) || a.includes(start) || a.includes(dest)) return true;
  }
  return false;
}

function classifyLoadColors(level: "high" | "medium" | "low"): { color: string; radius: number } {
  if (level === "high") return { color: "#ef4444", radius: 12 };
  if (level === "medium") return { color: "#f59e0b", radius: 10 };
  return { color: "#22c55e", radius: 8 };
}

function rankHubLoads(counts: number[]): ("high" | "medium" | "low")[] {
  const n = counts.length;
  if (n === 0) return [];
  const order = counts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c);
  const out: ("high" | "medium" | "low")[] = Array(n).fill("low");
  const third = Math.max(1, Math.ceil(n / 3));
  order.forEach((o, rank) => {
    if (o.c <= 0) out[o.i] = "low";
    else if (rank < third) out[o.i] = "high";
    else if (rank < third * 2) out[o.i] = "medium";
    else out[o.i] = "low";
  });
  return out;
}

export function LocationsPage() {
  const { isLoaded: isGoogleLoaded } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });
  const googleCirclePath = useMemo(() => {
    if (!GOOGLE_MAPS_API_KEY || !isGoogleLoaded) return undefined;
    return (globalThis as unknown as { google?: { maps?: { SymbolPath?: { readonly CIRCLE: unknown } } } }).google?.maps?.SymbolPath
      ?.CIRCLE as unknown;
  }, [isGoogleLoaded]);
  const { token: adminToken } = useAuth();
  const [searchParams] = useSearchParams();
  const focusBukidnon = searchParams.get("focus") === "ukidnon" || searchParams.get("focus") === "bukidnon";
  const [mounted, setMounted] = useState(false);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [terminals, setTerminals] = useState<CorridorBuilderTerminal[]>([]);
  const [stopsList, setStopsList] = useState<Awaited<ReturnType<typeof fetchCorridorBuilderContext>>["stops"]>([]);
  const [corridorRoutes, setCorridorRoutes] = useState<CorridorRouteRow[]>([]);
  const [contextError, setContextError] = useState<string | null>(null);
  const [liveLogs, setLiveLogs] = useState<BusLiveLogRow[]>([]);
  /** Buses that reported attendant offline — hide pin until a new live location_update (stale HTTP poll can resurrect rows). */
  const [shiftEndedBusIds, setShiftEndedBusIds] = useState<Record<string, boolean>>({});
  const [busRows, setBusRows] = useState<BusRow[]>([]);
  const [basemap, setBasemap] = useState<BasemapMode>("dark");
  const overlayTransit = false;
  const overlayBiking = false;
  const [layers, setLayers] = useState<MapLayerState>({
    geofence: true,
    traffic: false,
    heatmap: true,
    delays: true,
    buses: true,
  });
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [flySeq, setFlySeq] = useState(0);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [lastSyncMsByBus, setLastSyncMsByBus] = useState<Record<string, number>>({});
  /** Re-render periodically so "Last sync" / stale state updates without new socket events */
  const [fleetTicker, setFleetTicker] = useState(0);
  const [dispatchBlocks, setDispatchBlocks] = useState<LiveDispatchBlock[]>([]);
  const [selectedMapEntity, setSelectedMapEntity] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  /** Map marker: solid red pulse after speed commandAlert */
  const [speedAlertUntil, setSpeedAlertUntil] = useState<Record<string, number>>({});
  /** Map marker: emerald ring after terminal geofence hit */
  const [terminalGlowUntil, setTerminalGlowUntil] = useState<Record<string, number>>({});
  /** Post force_sync: cyan pulse + fly-to (expires ~45s) */
  const [forceSyncPulseUntil, setForceSyncPulseUntil] = useState<Record<string, number>>({});
  /** Per-bus recent trail (cyan path) */
  const [trailByBus, setTrailByBus] = useState<Record<string, TrailPoint[]>>({});
  /** SOS perimeter ring (100m) around bus */
  const [sosRingUntil, setSosRingUntil] = useState<Record<string, number>>({});
  /** Click bus near a terminal: pulse terminal geofence ring. */
  const [terminalPulseUntil, setTerminalPulseUntil] = useState<Record<string, number>>({});

  useEffect(() => {
    const onSpeed = (e: Event) => {
      const d = (e as CustomEvent<{ busId?: string }>).detail;
      const bid = d?.busId != null ? String(d.busId) : "";
      if (!bid) return;
      setSpeedAlertUntil((p) => ({ ...p, [bid]: Date.now() + 48_000 }));
    };
    window.addEventListener("admin-speed-violation", onSpeed);
    return () => window.removeEventListener("admin-speed-violation", onSpeed);
  }, []);

  useEffect(() => {
    const onSos = (e: Event) => {
      const d = (e as CustomEvent<{ busId?: string }>).detail;
      const bid = d?.busId != null ? String(d.busId) : "";
      if (!bid) return;
      setSosRingUntil((p) => ({ ...p, [bid]: Date.now() + 90_000 }));
    };
    window.addEventListener("admin-sos-map-focus", onSos as any);
    return () => window.removeEventListener("admin-sos-map-focus", onSos as any);
  }, []);

  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetchLiveDispatchBlocks();
        if (!cancelled) setDispatchBlocks(res.items ?? []);
      } catch {
        if (!cancelled) setDispatchBlocks([]);
      }
    };
    void run();
    const id = window.setInterval(() => void run(), DISPATCH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [adminToken]);

  useEffect(() => {
    const id = window.setInterval(() => setFleetTicker((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedBusId) return;
    window.dispatchEvent(
      new CustomEvent<{ busId: string }>("admin-locations-bus-select", { detail: { busId: selectedBusId } })
    );
  }, [selectedBusId]);

  const onToggleLayer = useCallback((key: MapLayerKey, next: boolean) => {
    setLayers((prev) => ({ ...prev, [key]: next }));
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadCorridorContext = useCallback(async () => {
    try {
      const ctx = await fetchCorridorBuilderContext();
      setTerminals(ctx.terminals ?? []);
      setStopsList(ctx.stops ?? []);
      setContextError(null);
    } catch (e) {
      setTerminals([]);
      setStopsList([]);
      setContextError(e instanceof Error ? e.message : "Could not load locations");
    }
  }, []);

  useEffect(() => {
    void loadCorridorContext();
    const onVis = () => {
      if (document.visibilityState === "visible") void loadCorridorContext();
    };
    window.addEventListener("visibilitychange", onVis);
    const poll = window.setInterval(() => void loadCorridorContext(), 45_000);
    const onAdminRefresh = () => {
      void loadCorridorContext();
      window.setTimeout(() => void loadCorridorContext(), 450);
    };
    window.addEventListener("admin-corridor-context-refresh", onAdminRefresh);
    return () => {
      window.removeEventListener("visibilitychange", onVis);
      window.clearInterval(poll);
      window.removeEventListener("admin-corridor-context-refresh", onAdminRefresh);
    };
  }, [loadCorridorContext]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchCorridorRoutes();
        if (!cancelled) setCorridorRoutes((res.items ?? []).filter((r) => !r.suspended));
      } catch {
        if (!cancelled) setCorridorRoutes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: TicketRow[] }>("/api/tickets");
        if (!cancelled) setTickets(res.items);
      } catch {
        if (!cancelled) setTickets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyLiveItemsToState = useCallback((liveItems: BusLiveLogRow[]) => {
    let merged: BusLiveLogRow[] = [];
    setLiveLogs((prev) => {
      merged = mergeFleetSnapshot(prev, liveItems);
      return merged;
    });
    setTrailByBus((prev) => {
      const now = Date.now();
      const next: Record<string, TrailPoint[]> = { ...prev };
      for (const log of merged) {
        const bid = String(log.busId || "").trim();
        const lat = Number(log.latitude);
        const lng = Number(log.longitude);
        if (!bid || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const at = Date.parse(log.recordedAt ?? "");
        const ts = Number.isFinite(at) ? at : now;
        const cur = next[bid] ? [...next[bid]] : [];
        const last = cur[cur.length - 1];
        if (last && Math.abs(last.lat - lat) < 1e-7 && Math.abs(last.lng - lng) < 1e-7) continue;
        const speed = log.speedKph != null && Number.isFinite(Number(log.speedKph)) ? Number(log.speedKph) : null;
        cur.push({ lat, lng, at: ts, speed });
        const pruned = cur.filter((p) => now - p.at <= TRAIL_MAX_AGE_MS).slice(-TRAIL_MAX_POINTS);
        next[bid] = pruned;
      }
      return next;
    });
    setLastSyncMsByBus((prev) => {
      const n = { ...prev };
      for (const log of liveItems) {
        const ms = Date.parse(log.recordedAt ?? "");
        if (Number.isFinite(ms)) n[log.busId] = Math.max(n[log.busId] ?? 0, ms);
      }
      return n;
    });
  }, []);

  /**
   * Pull latest coordinates from the API (one row per bus in gps_logs).
   * Runs as soon as the admin session is ready, on a short interval, and when the tab becomes visible again.
   */
  const syncFleetFromApi = useCallback(
    async (includeBusRegistry: boolean) => {
      let liveItems: BusLiveLogRow[] = [];
      try {
        const liveRes = await api<{ items: BusLiveLogRow[] }>("/api/buses/live");
        liveItems = liveRes.items ?? [];
      } catch {
        /* keep [] */
      }
      if (includeBusRegistry) {
        try {
          const busesRes = await api<{ items: BusRow[] }>("/api/buses");
          setBusRows(busesRes.items ?? []);
        } catch {
          /* keep — markers still render from live logs */
        }
      }
      applyLiveItemsToState(liveItems);
    },
    [applyLiveItemsToState]
  );

  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    void syncFleetFromApi(true);
    const id = window.setInterval(() => {
      if (!cancelled) void syncFleetFromApi(false);
    }, LIVE_GPS_POLL_MS);
    const onVisible = () => {
      if (cancelled || document.visibilityState !== "visible" || !getToken()) return;
      void syncFleetFromApi(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [adminToken, syncFleetFromApi]);

  useEffect(() => {
    if (!adminToken) return;

    const socket = io(ADMIN_API_ORIGIN.replace(/\/$/, ""), {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 12,
      reconnectionDelay: 2000,
      auth: { token: adminToken },
    });

    const subscribeBuses = () => {
      socket.emit("subscribe:buses");
    };
    socket.on("connect", subscribeBuses);
    subscribeBuses();

    const bumpFleetSync = (busId: string, recordedAtIso?: string) => {
      const ms = recordedAtIso ? Date.parse(recordedAtIso) : NaN;
      const t = Number.isFinite(ms) ? ms : Date.now();
      setLastSyncMsByBus((prev) => ({ ...prev, [busId]: t }));
    };

    const applyPayload = (p: SocketLocationPayload) => {
      const bidPre = p.busId != null ? String(p.busId) : "";
      if (bidPre) {
        setShiftEndedBusIds((prev) => {
          if (!prev[bidPre]) return prev;
          const n = { ...prev };
          delete n[bidPre];
          return n;
        });
      }
      setLiveLogs((prev) => mergeLiveLogRow(prev, p));
      const bid = p.busId != null ? String(p.busId) : "";
      const la = Number(p.latitude);
      const ln = Number(p.longitude);
      if (!bid || !Number.isFinite(la) || !Number.isFinite(ln)) return;
      setTrailByBus((prev) => {
        const now = Date.now();
        const cur = prev[bid] ? [...prev[bid]] : [];
        const at = Date.parse(p.recordedAt ?? "");
        const ts = Number.isFinite(at) ? at : now;
        const last = cur[cur.length - 1];
        if (!last || Math.abs(last.lat - la) > 1e-7 || Math.abs(last.lng - ln) > 1e-7) {
          const speed = p.speedKph != null && Number.isFinite(Number(p.speedKph)) ? Number(p.speedKph) : null;
          cur.push({ lat: la, lng: ln, at: ts, speed });
        }
        const pruned = cur.filter((pt) => now - pt.at <= TRAIL_MAX_AGE_MS).slice(-TRAIL_MAX_POINTS);
        return { ...prev, [bid]: pruned };
      });
      bumpFleetSync(bid, p.recordedAt);
    };

    const onLocationUpdate = (raw: Record<string, unknown>) => {
      applyPayload({
        busId: raw.busId != null ? String(raw.busId) : undefined,
        latitude: raw.latitude != null ? Number(raw.latitude) : undefined,
        longitude: raw.longitude != null ? Number(raw.longitude) : undefined,
        speedKph: raw.speedKph != null ? Number(raw.speedKph) : null,
        heading: raw.heading != null ? Number(raw.heading) : null,
        recordedAt: raw.recordedAt != null ? String(raw.recordedAt) : undefined,
        attendantName: raw.attendantName != null ? String(raw.attendantName) : null,
        ...("source" in raw ? { source: parseSocketSource(raw.source) } : {}),
        ...("net" in raw ? { net: parseSocketNet(raw.net) } : {}),
        ...("signalStrength" in raw && Number.isFinite(Number(raw.signalStrength))
          ? { signalStrength: Number(raw.signalStrength) }
          : {}),
        ...("voltage" in raw && Number.isFinite(Number(raw.voltage)) ? { voltage: Number(raw.voltage) } : {}),
        ...("etaMinutes" in raw && Number.isFinite(Number(raw.etaMinutes))
          ? { etaMinutes: Number(raw.etaMinutes) }
          : {}),
        ...("etaTargetIso" in raw ? { etaTargetIso: String(raw.etaTargetIso) } : {}),
        ...("nextTerminal" in raw ? { nextTerminal: String(raw.nextTerminal) } : {}),
        ...("trafficDelay" in raw ? { trafficDelay: raw.trafficDelay === true } : {}),
        ...("signal" in raw ? { signal: parseSocketSignal(raw.signal) } : {}),
      });
    };

    const onLocationUpdateAlt = (raw: Record<string, unknown>) => {
      applyPayload({
        busId: raw.busId != null ? String(raw.busId) : undefined,
        latitude: raw.lat != null ? Number(raw.lat) : undefined,
        longitude: raw.lng != null ? Number(raw.lng) : undefined,
        speedKph: raw.speedKph != null ? Number(raw.speedKph) : null,
        recordedAt: raw.timestamp != null ? String(raw.timestamp) : undefined,
        attendantName: raw.attendantName != null ? String(raw.attendantName) : null,
        ...("source" in raw ? { source: parseSocketSource(raw.source) } : {}),
        ...("net" in raw ? { net: parseSocketNet(raw.net) } : {}),
        ...("signalStrength" in raw && Number.isFinite(Number(raw.signalStrength))
          ? { signalStrength: Number(raw.signalStrength) }
          : {}),
        ...("voltage" in raw && Number.isFinite(Number(raw.voltage)) ? { voltage: Number(raw.voltage) } : {}),
        ...("etaMinutes" in raw && Number.isFinite(Number(raw.etaMinutes))
          ? { etaMinutes: Number(raw.etaMinutes) }
          : {}),
        ...("etaTargetIso" in raw ? { etaTargetIso: String(raw.etaTargetIso) } : {}),
        ...("nextTerminal" in raw ? { nextTerminal: String(raw.nextTerminal) } : {}),
        ...("trafficDelay" in raw ? { trafficDelay: raw.trafficDelay === true } : {}),
        ...("signal" in raw ? { signal: parseSocketSignal(raw.signal) } : {}),
      });
    };

    /** Canonical fleet envelope — merge position (defensive if other events are missed). */
    const onBusLocationUpdate = (raw: Record<string, unknown>) => {
      const bus_id = raw.bus_id != null ? String(raw.bus_id) : "";
      const recordedAt = raw.recordedAt != null ? String(raw.recordedAt) : new Date().toISOString();
      if (!bus_id) return;
      const la = raw.lat != null ? Number(raw.lat) : Number.NaN;
      const ln = raw.lng != null ? Number(raw.lng) : Number.NaN;
      const forceSync = raw.forceSync === true || raw.force_sync === true;
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        applyPayload({
          busId: bus_id,
          latitude: la,
          longitude: ln,
          speedKph: raw.speed != null ? Number(raw.speed) : null,
          recordedAt,
          attendantName: raw.attendantName != null ? String(raw.attendantName) : null,
          ...("source" in raw ? { source: parseSocketSource(raw.source) } : {}),
          ...("net" in raw ? { net: parseSocketNet(raw.net) } : {}),
          ...("signalStrength" in raw && Number.isFinite(Number(raw.signalStrength))
            ? { signalStrength: Number(raw.signalStrength) }
            : {}),
          ...("voltage" in raw && Number.isFinite(Number(raw.voltage)) ? { voltage: Number(raw.voltage) } : {}),
          ...("etaMinutes" in raw && Number.isFinite(Number(raw.etaMinutes))
            ? { etaMinutes: Number(raw.etaMinutes) }
            : {}),
          ...("etaTargetIso" in raw ? { etaTargetIso: String(raw.etaTargetIso) } : {}),
          ...("nextTerminal" in raw ? { nextTerminal: String(raw.nextTerminal) } : {}),
          ...("trafficDelay" in raw ? { trafficDelay: raw.trafficDelay === true } : {}),
          ...("signal" in raw ? { signal: parseSocketSignal(raw.signal) } : {}),
        });
        if (forceSync) {
          setForceSyncPulseUntil((p) => ({ ...p, [bus_id]: Date.now() + 45_000 }));
          window.dispatchEvent(
            new CustomEvent<{ latitude: number; longitude: number; zoom?: number }>("admin-tactical-map-flyto", {
              detail: { latitude: la, longitude: ln, zoom: 16 },
            })
          );
        }
      }
      bumpFleetSync(bus_id, recordedAt);
    };

    const onTerminalArrival = (raw: Record<string, unknown>) => {
      const bus_id = raw.bus_id != null ? String(raw.bus_id) : "";
      if (!bus_id) return;
      setTerminalGlowUntil((p) => ({ ...p, [bus_id]: Date.now() + 30_000 }));
    };

    /** Attendant signed out or socket dropped — remove pin immediately (DB row is also deleted server-side). */
    const onBusAttendantOffline = (raw: Record<string, unknown>) => {
      const bus_id = raw.bus_id != null ? String(raw.bus_id) : "";
      if (!bus_id) return;
      setLiveLogs((prev) => prev.filter((x) => x.busId !== bus_id));
      setLastSyncMsByBus((prev) => {
        const n = { ...prev };
        delete n[bus_id];
        return n;
      });
    };

    socket.on("locationUpdate", onLocationUpdate);
    socket.on("location_update", onLocationUpdateAlt);
    socket.on("bus_location_update", onBusLocationUpdate);
    socket.on("bus_terminal_arrival", onTerminalArrival);
    socket.on("bus_attendant_offline", onBusAttendantOffline);

    return () => {
      socket.off("connect", subscribeBuses);
      socket.off("locationUpdate", onLocationUpdate);
      socket.off("location_update", onLocationUpdateAlt);
      socket.off("bus_location_update", onBusLocationUpdate);
      socket.off("bus_terminal_arrival", onTerminalArrival);
      socket.off("bus_attendant_offline", onBusAttendantOffline);
      socket.disconnect();
    };
  }, [adminToken]);

  const adminHubs: AdminHub[] = useMemo(() => {
    const now = new Date();
    const sameDay = (d: Date) =>
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const ticketsToday = tickets.filter((t) => sameDay(new Date(t.createdAt)));

    const rows: Omit<AdminHub, "loadLevel" | "loadColor">[] = [];

    for (const term of terminals) {
      const lat = Number(term.terminal?.latitude);
      const lng = Number(term.terminal?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      const name = term.locationName?.trim() || term.terminal?.name?.trim() || "Terminal";
      const aliases = [term.locationName, term.terminal?.name, name].filter(Boolean) as string[];
      const rawR = Number(term.terminal?.geofenceRadiusM);
      const radiusM = Math.min(
        20_000,
        Math.max(200, Number.isFinite(rawR) && rawR > 0 ? rawR : 500)
      );

      const touching = ticketsToday.filter((t) => ticketTouchesHub(t, aliases));
      const ticketCountToday = touching.length;
      const buses = [
        ...new Set(
          touching
            .map((t) => t.busNumber)
            .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
            .map((b) => b.trim())
        ),
      ].slice(0, 12);

      rows.push({
        id: String(term._id),
        name,
        pos: [lat, lng],
        radiusM,
        aliases,
        ticketCountToday,
        buses,
      });
    }

    const counts = rows.map((r) => r.ticketCountToday);
    const levels = rankHubLoads(counts);

    return rows.map((r, i) => {
      const loadLevel = levels[i] ?? "low";
      const { color } = classifyLoadColors(loadLevel);
      return { ...r, loadLevel, loadColor: color };
    });
  }, [terminals, tickets]);

  const locationWaypoints = useMemo(() => {
    const out: Array<{ id: string; name: string; pos: [number, number] }> = [];
    for (const term of terminals) {
      const lp = term.locationPoint;
      const lat = Number(lp?.latitude);
      const lng = Number(lp?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        id: String(term._id),
        name: String(lp?.name || term.locationName || term.terminal?.name || "Location").trim(),
        pos: [lat, lng],
      });
    }
    return out;
  }, [terminals]);

  const mapCenter = useMemo((): [number, number] => {
    if (adminHubs.length > 0) {
      const lat = adminHubs.reduce((s, h) => s + h.pos[0], 0) / adminHubs.length;
      const lng = adminHubs.reduce((s, h) => s + h.pos[1], 0) / adminHubs.length;
      return [lat, lng];
    }
    const pts: [number, number][] = [];
    for (const p of locationWaypoints) pts.push(p.pos);
    for (const s of stopsList) {
      const la = Number(s.latitude);
      const lo = Number(s.longitude);
      if (Number.isFinite(la) && Number.isFinite(lo)) pts.push([la, lo]);
    }
    if (pts.length > 0) {
      const lat = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const lng = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return [lat, lng];
    }
    return DEFAULT_CENTER;
  }, [adminHubs, locationWaypoints, stopsList]);

  useEffect(() => {
    if (!mapRef.current || !flyTarget) return;
    mapRef.current.panTo({ lat: flyTarget[0], lng: flyTarget[1] });
    mapRef.current.setZoom(14);
  }, [flyTarget, flySeq]);

  const busRegistry = useMemo(() => new Map(busRows.map((b) => [b.busId, b])), [busRows]);

  const visibleLiveLogs = useMemo(
    () => liveLogs.filter((log) => !shiftEndedBusIds[log.busId]),
    [liveLogs, shiftEndedBusIds]
  );

  const busState = useMemo(() => {
    if (visibleLiveLogs.length === 0) return [];
    const now = Date.now();
    return visibleLiveLogs.map((log) => {
      const row = busRegistry.get(log.busId);
      const pos: [number, number] = [log.latitude, log.longitude];
      const route = row?.route?.trim() || "Assigned route —";
      const seats = typeof row?.seatCapacity === "number" && row.seatCapacity > 0 ? row.seatCapacity : 45;
      const corridor = findCorridorForLabel(row?.route ?? null, corridorRoutes);
      const anchorCount = corridor?.authorizedStops?.length ?? 0;
      const corridorHud =
        corridor?.displayName?.trim() && anchorCount > 0
          ? `${String(corridor.displayName).trim()} · ${anchorCount} corridor anchors`
          : corridor?.displayName?.trim() || formatCorridorDisplay(route);
      let violating = false;
      if (corridor) {
        const poly = polylineFromCorridorRoute(corridor);
        const stops = sortedStopsFromCorridor(corridor);
        if (poly.length >= 2) {
          const { distanceM, segmentIndex } = minDistanceToPolylineMetersWithClosestSegment(
            log.latitude,
            log.longitude,
            poly
          );
          const beyondBuffer = Number.isFinite(distanceM) && distanceM > ROUTE_GEOFENCE_BUFFER_M;
          if (!beyondBuffer) {
            violating = false;
          } else if (segmentIndex == null) {
            violating = true;
          } else {
            const startStop = stops[segmentIndex];
            const flexibleSegment = startStop != null && startStop.pickupOnly === false;
            violating = !flexibleSegment;
          }
        }
      }
      const attendantLabel =
        (log.attendantName != null && String(log.attendantName).trim()) ||
        (row?.attendantName != null && String(row.attendantName).trim()) ||
        null;
      const source = log.source === "hardware" ? "hardware" : "staff";
      const sourceNet = log.net === "wifi" || log.net === "4g" || log.net === "unknown" ? log.net : null;
      const sourceSignalStrength =
        log.signalStrength != null && Number.isFinite(Number(log.signalStrength)) ? Number(log.signalStrength) : null;
      const sourceVoltage = log.voltage != null && Number.isFinite(Number(log.voltage)) ? Number(log.voltage) : null;
      const parsedLog = Date.parse(log.recordedAt ?? "");
      const trackedMs = lastSyncMsByBus[log.busId];
      const lastMs =
        Number.isFinite(parsedLog) && Number.isFinite(trackedMs) && trackedMs != null
          ? Math.max(parsedLog, trackedMs)
          : Number.isFinite(parsedLog)
            ? parsedLog
            : Number.isFinite(trackedMs) && trackedMs != null
              ? trackedMs
              : 0;
      /** Fresh coords from HTTP poll / socket — do not use Socket “attendant disconnected” (HTTP may still be pinging). */
      const pingStale = !Number.isFinite(lastMs) || lastMs <= 0 || now - lastMs > GPS_STALE_MS;
      const stationary = pingStale;
      const lastSyncLabel = formatFleetLastSync(lastMs);
      const fleetStatus = stationary ? "Stationary" : "Active";
      const precisionSyncPulse = (forceSyncPulseUntil[log.busId] ?? 0) > now;
      const rawSig = log.signal;
      const signalTier: GpsSignalTier | null =
        rawSig === "strong" || rawSig === "weak" || rawSig === "offline" ? rawSig : null;
      const speedVal = log.speedKph != null ? Number(log.speedKph) : NaN;
      const speedCritical =
        (Number.isFinite(speedVal) && speedVal > 80) || (speedAlertUntil[log.busId] ?? 0) > now;
      const nearestTerminalDistanceM = adminHubs.reduce((min, h) => {
        const d = haversineMeters(log.latitude, log.longitude, h.pos[0], h.pos[1]);
        return Number.isFinite(d) ? Math.min(min, d) : min;
      }, Number.POSITIVE_INFINITY);
      const inTerminalRadius = nearestTerminalDistanceM <= TERMINAL_ARRIVAL_DISTANCE_M;
      const terminalArrival = !speedCritical && !stationary && ((terminalGlowUntil[log.busId] ?? 0) > now || inTerminalRadius);
      return {
        busId: log.busId,
        assignedRoute: route,
        currentTerminal: "",
        seats,
        issuedApprox: row?.ticketsIssued ?? 0,
        pos,
        pct: Math.min(100, ((row?.ticketsIssued ?? 0) / seats) * 100),
        full: false,
        violating,
        speedKph: log.speedKph ?? null,
        speedCritical,
        terminalArrival,
        nearestTerminalDistanceM: Number.isFinite(nearestTerminalDistanceM) ? nearestTerminalDistanceM : null,
        attendantName: attendantLabel,
        source,
        sourceNet,
        sourceSignalStrength,
        sourceVoltage,
        corridorHud,
        displayBusLabel: row?.busNumber?.trim() || row?.busId || log.busId,
        stationary,
        lastSyncLabel,
        fleetStatus,
        precisionSyncPulse,
        signalTier,
        etaMinutes: log.etaMinutes ?? null,
        etaTargetIso: log.etaTargetIso ?? null,
        nextTerminal: log.nextTerminal ?? null,
        trafficDelay: log.trafficDelay === true,
      };
    });
  }, [
    visibleLiveLogs,
    busRegistry,
    corridorRoutes,
    lastSyncMsByBus,
    fleetTicker,
    speedAlertUntil,
    terminalGlowUntil,
    forceSyncPulseUntil,
    adminHubs,
  ]);

  const averageSpeedByRoute = useMemo(() => {
    const sums = new Map<string, { sum: number; n: number }>();
    for (const b of busState) {
      const spd = b.speedKph != null ? Number(b.speedKph) : NaN;
      if (!Number.isFinite(spd) || spd <= 0) continue;
      const key = String(b.assignedRoute || "Assigned route —").trim();
      const agg = sums.get(key) ?? { sum: 0, n: 0 };
      agg.sum += spd;
      agg.n += 1;
      sums.set(key, agg);
    }
    const out = new Map<string, number>();
    for (const [k, v] of sums) if (v.n > 0) out.set(k, v.sum / v.n);
    return out;
  }, [busState]);

  const dispatchByBusId = useMemo(() => {
    const m = new Map<string, LiveDispatchBlock>();
    for (const b of dispatchBlocks) m.set(String(b.busId), b);
    return m;
  }, [dispatchBlocks]);

  const delayMinutesByBus = useMemo(() => {
    const now = new Date();
    const hh = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hour12: false }).format(now)
    );
    const mm = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", minute: "2-digit" }).format(now));
    const nowMin = hh * 60 + mm;
    const out = new Map<string, number>();
    for (const b of dispatchBlocks) {
      const sm = String(b.scheduledDeparture || "").match(/^(\d{1,2}):(\d{2})$/);
      if (!sm) continue;
      if (b.status === "arriving" || b.status === "cancelled") continue;
      const sched = Number(sm[1]) * 60 + Number(sm[2]);
      const lag = nowMin - sched;
      if (lag > 0 && lag <= MAX_REASONABLE_DELAY_MINUTES) out.set(String(b.busId), lag);
    }
    return out;
  }, [dispatchBlocks, fleetTicker]);

  const trafficDelayHintByBus = useMemo(() => {
    const out = new Map<string, string>();
    for (const b of busState) {
      const etaMin = b.etaMinutes != null ? Number(b.etaMinutes) : NaN;
      const delayMin = delayMinutesByBus.get(b.busId) ?? 0;
      const speed = b.speedKph != null ? Number(b.speedKph) : NaN;
      const routeAvg = averageSpeedByRoute.get(String(b.assignedRoute || "Assigned route —").trim()) ?? null;
      const speedDropRisk = Number.isFinite(speed) && routeAvg != null && routeAvg > 0 && speed <= routeAvg * 0.7;
      if (speedDropRisk) out.set(b.busId, "WX/Traffic risk: route speed -30%");
      else if (Number.isFinite(etaMin) && etaMin > 10) out.set(b.busId, `Delayed by traffic: +${etaMin} mins`);
      else if (b.trafficDelay) out.set(b.busId, "Traffic delay detected");
      else if (delayMin > 0) out.set(b.busId, `Running behind: +${delayMin} mins`);
      else out.set(b.busId, "On time");
    }
    return out;
  }, [busState, delayMinutesByBus, averageSpeedByRoute]);

  const handleBusMarkerClick = useCallback(
    (b: { busId: string; pos: [number, number] }) => {
      setSelectedMapEntity(`bus:${b.busId}`);
      let nearest: { id: string; d: number } | null = null;
      for (const h of adminHubs) {
        const d = haversineMeters(b.pos[0], b.pos[1], h.pos[0], h.pos[1]);
        if (!nearest || d < nearest.d) nearest = { id: h.id, d };
      }
      if (nearest && nearest.d <= 500) {
        setTerminalPulseUntil((p) => ({ ...p, [nearest.id]: Date.now() + 30_000 }));
      }
    },
    [adminHubs]
  );

  return (
    <div className="locations-page">
      <div className="locations-page__split">
        <div className="locations-page__map-shell">
          <div className="locations-page__map-wrap">
            {!mounted ? (
              <div className="locations-page__map-skeleton" aria-hidden>
                Initializing tactical map…
              </div>
            ) : !GOOGLE_MAPS_API_KEY ? (
              <MapContainer
                className="locations-page__map"
                center={{ lat: mapCenter[0], lng: mapCenter[1] }}
                zoom={focusBukidnon ? BUKIDNON_FOCUS_ZOOM : DEFAULT_ZOOM}
                scrollWheelZoom
              >
                <TileLayer url={basemap === "dark" ? TILE_DARK : TILE_OSM} />

                {corridorRoutes
                  .filter((r) => !r.suspended)
                  .flatMap((r) => {
                    const pts = polylineFromCorridorRoute(r);
                    const stops = sortedStopsFromCorridor(r);
                    if (pts.length < 2) return [];
                    const nodes: JSX.Element[] = [];
                    for (let i = 0; i < pts.length - 1; i++) {
                      const flexible = stops[i]?.pickupOnly === false;
                      nodes.push(
                        <LeafletPolyline
                          key={`cor-l-${r._id}-seg-${i}`}
                          positions={[pts[i]!, pts[i + 1]!]}
                          pathOptions={{
                            color: flexible ? "#5eead4" : "#22d3ee",
                            weight: 4,
                            opacity: 0.72,
                            dashArray: flexible ? "10 8" : undefined,
                          }}
                        />
                      );
                    }
                    return nodes;
                  })}

                {layers.geofence
                  ? adminHubs.map((z) => (
                      <LeafletCircle
                        key={`lg-${z.id}`}
                        center={[z.pos[0], z.pos[1]]}
                        radius={z.radiusM}
                        pathOptions={{ color: "#10b981", fillColor: "#34d399", fillOpacity: 0.1, weight: 2 }}
                      >
                        <Popup>
                          <div style={{ minWidth: 180 }}>
                            <strong>{z.name}</strong>
                            <div>Geofence radius: {Math.round(z.radiusM)}m</div>
                          </div>
                        </Popup>
                      </LeafletCircle>
                    ))
                  : null}
                {adminHubs.map((z) => (
                  <LeafletMarker
                    key={`lt-${z.id}`}
                    position={[z.pos[0], z.pos[1]]}
                    icon={LEAFLET_TERMINAL_ICON}
                    zIndexOffset={620}
                  >
                    <Popup>
                      <div style={{ minWidth: 200 }}>
                        <strong>{z.name}</strong>
                        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, marginTop: 6 }}>
                          {z.pos[0].toFixed(6)}, {z.pos[1].toFixed(6)}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>WGS84 — same as Location management deploy</div>
                      </div>
                    </Popup>
                  </LeafletMarker>
                ))}
                {locationWaypoints.map((p) => (
                  <LeafletMarker key={`ll-${p.id}`} position={[p.pos[0], p.pos[1]]} icon={LEAFLET_STOP_ICON} zIndexOffset={560}>
                    <Popup>
                      <div style={{ minWidth: 180 }}>
                        <strong>{p.name}</strong>
                        <div>Type: Location (corridor waypoint)</div>
                        <div style={{ fontFamily: "ui-monospace, monospace", marginTop: 6 }}>
                          {p.pos[0].toFixed(6)}, {p.pos[1].toFixed(6)}
                        </div>
                      </div>
                    </Popup>
                  </LeafletMarker>
                ))}
                {Object.entries(terminalPulseUntil)
                  .filter(([, until]) => until > Date.now())
                  .map(([hid]) => {
                    const h = adminHubs.find((x) => x.id === hid);
                    if (!h) return null;
                    return (
                      <LeafletCircle
                        key={`tp-l-${hid}`}
                        center={[h.pos[0], h.pos[1]]}
                        radius={Math.max(120, Math.min(500, h.radiusM))}
                        pathOptions={{ color: "#34d399", fillOpacity: 0, weight: 3 }}
                      />
                    );
                  })}
                {/* Traffic intel is pinpoint-based (no corridor lines). */}

                {layers.heatmap
                  ? adminHubs.map((h) => (
                      <LeafletCircle
                        key={`lh-${h.id}`}
                        center={[h.pos[0], h.pos[1]]}
                        radius={Math.max(900, Math.min(3200, 900 + h.ticketCountToday * 40))}
                        pathOptions={{ stroke: false, fillColor: h.loadColor, fillOpacity: 0.2 }}
                      />
                    ))
                  : null}

                {stopsList.map((s) => {
                  const slat = Number(s.latitude);
                  const slng = Number(s.longitude);
                  if (!Number.isFinite(slat) || !Number.isFinite(slng)) return null;
                  const flexStop = s.pickupOnly === false;
                  return (
                    <LeafletMarker
                      key={`ls-${s._id}`}
                      position={[slat, slng]}
                      icon={flexStop ? LEAFLET_STOP_FLEX_ICON : LEAFLET_STOP_ICON}
                      zIndexOffset={540}
                    >
                      <Popup>
                        <div style={{ minWidth: 180 }}>
                          <strong>{s.name || "Bus stop"}</strong>
                          <div>Type: {flexStop ? "Flexible stop (free pickup zone)" : "Strict stop"}</div>
                          <div>{s.locationName}</div>
                          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, marginTop: 6 }}>
                            {slat.toFixed(6)}, {slng.toFixed(6)}
                          </div>
                        </div>
                      </Popup>
                    </LeafletMarker>
                  );
                })}

                {layers.buses
                  ? busState.map((b) => {
                      const delayMin = delayMinutesByBus.get(b.busId) ?? 0;
                      const etaDelayMin = b.etaMinutes != null ? Number(b.etaMinutes) : 0;
                      const isDelayed =
                        delayMin >= DELAY_HIGHLIGHT_MINUTES ||
                        dispatchByBusId.get(b.busId)?.status === "delayed" ||
                        etaDelayMin > 10 ||
                        b.trafficDelay;
                      const trailPts = trailByBus[b.busId] ?? [];
                      const trailSegments = trailPts
                        .slice(1)
                        .map((p, i) => ({ a: trailPts[i]!, b: p }))
                        .filter((s) => !!s.a && !!s.b);
                      const now = Date.now();
                      const hasSosRing = (sosRingUntil[b.busId] ?? 0) > now;
                      const isTrafficRisk = layers.traffic && (b.trafficDelay || (b.speedKph != null && b.speedKph < 15));
                      const isDelayRisk = layers.delays && isDelayed;
                      const routeAvg = averageSpeedByRoute.get(String(b.assignedRoute || "Assigned route —").trim()) ?? null;
                      const speedDropRisk =
                        b.speedKph != null && routeAvg != null && routeAvg > 0 && Number(b.speedKph) <= routeAvg * 0.7;
                      const trailColor = isDelayRisk || speedDropRisk ? "#fb923c" : isTrafficRisk ? "#f59e0b" : "#00FFFF";
                      const pinFill = b.speedCritical ? "#ef4444" : b.terminalArrival || b.stationary ? "#3b82f6" : "#00FFFF";
                      const pinRadius = b.speedCritical ? 13 : b.terminalArrival || b.stationary ? 9 : 11;
                      return (
                        <Fragment key={`lb-${b.busId}`}>
                          {trailSegments.map((seg, idx) => {
                            const violation = (seg.b.speed ?? 0) > 80 || (seg.a.speed ?? 0) > 80;
                            return (
                              <LeafletPolyline
                                key={`tr-${b.busId}-${idx}`}
                                positions={[
                                  [seg.a.lat, seg.a.lng],
                                  [seg.b.lat, seg.b.lng],
                                ]}
                                pathOptions={{ color: violation ? "#ff0000" : trailColor, opacity: 0.7, weight: 3 }}
                              />
                            );
                          })}
                          {b.terminalArrival ? (
                            <LeafletCircle
                              center={[b.pos[0], b.pos[1]]}
                              radius={140}
                              pathOptions={{ color: "#34d399", fillOpacity: 0, weight: 3 }}
                            />
                          ) : null}
                          {hasSosRing ? (
                            <LeafletCircle
                              center={[b.pos[0], b.pos[1]]}
                              radius={100}
                              pathOptions={{ color: "#e11d48", fillOpacity: 0, weight: 3 }}
                            />
                          ) : null}
                          {layers.traffic && isTrafficRisk ? (
                            <LeafletCircle
                              center={[b.pos[0], b.pos[1]]}
                              radius={70}
                              pathOptions={{ color: "#f59e0b", fillOpacity: 0, weight: 2 }}
                            />
                          ) : null}
                          <CircleMarker
                            center={[b.pos[0], b.pos[1]]}
                            radius={pinRadius}
                            pathOptions={{ color: "#0b1220", weight: 2, fillColor: pinFill, fillOpacity: 0.28 }}
                          />
                          <LeafletMarker
                            position={[b.pos[0], b.pos[1]]}
                            icon={LEAFLET_BUS_ICON}
                            zIndexOffset={800}
                            eventHandlers={{ click: () => handleBusMarkerClick({ busId: b.busId, pos: b.pos }) }}
                          >
                            {selectedMapEntity === `bus:${b.busId}` ? (
                              <Popup>
                                <div style={{ minWidth: 220 }}>
                                  <strong>{b.displayBusLabel}</strong>
                                  <div>{b.attendantName ?? "Attendant —"}</div>
                                  <div>Speed: {b.speedKph != null ? `${b.speedKph.toFixed(1)} km/h` : "—"}</div>
                                  <div>Source: {b.source === "hardware" ? "🛰️ Hardware" : "📱 Mobile"}</div>
                                  {b.nextTerminal ? <div>Next: {b.nextTerminal}</div> : null}
                                  {b.etaTargetIso ? <div>ETA: {new Date(b.etaTargetIso).toLocaleTimeString()}</div> : null}
                                  {layers.traffic ? <div>{trafficDelayHintByBus.get(b.busId) ?? "On time"}</div> : null}
                                  {isDelayed ? <div style={{ color: "#b91c1c" }}>Delay: +{Math.max(delayMin, etaDelayMin)}m</div> : null}
                                </div>
                              </Popup>
                            ) : null}
                          </LeafletMarker>
                        </Fragment>
                      );
                    })
                  : null}
              </MapContainer>
            ) : !isGoogleLoaded ? (
              <div className="locations-page__map-skeleton" aria-hidden>
                Loading Google Maps…
              </div>
            ) : (
              <GoogleMap
                mapContainerClassName="locations-page__map"
                center={{ lat: mapCenter[0], lng: mapCenter[1] }}
                zoom={focusBukidnon ? BUKIDNON_FOCUS_ZOOM : DEFAULT_ZOOM}
                onLoad={(m) => {
                  mapRef.current = m;
                  if (focusBukidnon) m.setCenter({ lat: BUKIDNON_FOCUS[0], lng: BUKIDNON_FOCUS[1] });
                }}
                options={{
                  mapTypeId: basemap === "dark" ? "roadmap" : basemap,
                  styles: basemap === "dark" ? GOOGLE_DARK_STYLE : undefined,
                  streetViewControl: false,
                  fullscreenControl: false,
                  mapTypeControl: false,
                }}
              >
                {layers.traffic ? <TrafficLayer /> : null}
                {overlayTransit ? <TransitLayer /> : null}
                {overlayBiking ? <BicyclingLayer /> : null}
                {corridorRoutes
                  .filter((r) => !r.suspended)
                  .flatMap((r) => {
                    const pts = polylineFromCorridorRoute(r);
                    const stops = sortedStopsFromCorridor(r);
                    if (pts.length < 2) return [];
                    return Array.from({ length: pts.length - 1 }, (_, i) => {
                      const flexible = stops[i]?.pickupOnly === false;
                      return (
                        <PolylineF
                          key={`cor-g-${r._id}-seg-${i}`}
                          path={[
                            { lat: pts[i]![0], lng: pts[i]![1] },
                            { lat: pts[i + 1]![0], lng: pts[i + 1]![1] },
                          ]}
                          options={{
                            strokeColor: flexible ? "#5eead4" : "#22d3ee",
                            strokeWeight: 4,
                            strokeOpacity: 0.72,
                            ...(flexible
                              ? {
                                  icons: [
                                    {
                                      icon: {
                                        path: "M 0,-1 0,1",
                                        strokeOpacity: 1,
                                        scale: 3,
                                        strokeColor: "#5eead4",
                                      },
                                      offset: "0",
                                      repeat: "14px",
                                    },
                                  ],
                                }
                              : {}),
                          }}
                        />
                      );
                    });
                  })}
                {layers.geofence
                  ? adminHubs.map((z) => (
                      <CircleF
                        key={`g-${z.id}`}
                        center={{ lat: z.pos[0], lng: z.pos[1] }}
                        radius={z.radiusM}
                        options={{ strokeColor: "#10b981", fillColor: "#34d399", fillOpacity: 0.1, strokeWeight: 2 }}
                      />
                    ))
                  : null}
                {adminHubs.map((z) => (
                  <MarkerF
                    key={`tg-${z.id}`}
                    position={{ lat: z.pos[0], lng: z.pos[1] }}
                    zIndex={9900}
                    icon={GOOGLE_TERMINAL_HEX_ICON}
                    title={`${z.name} — ${z.pos[0].toFixed(6)}, ${z.pos[1].toFixed(6)} (WGS84, matches Location management)`}
                  />
                ))}
                {locationWaypoints.map((p) => (
                  <MarkerF
                    key={`lg-${p.id}`}
                    position={{ lat: p.pos[0], lng: p.pos[1] }}
                    zIndex={9650}
                    icon={GOOGLE_CYAN_WAYPOINT_ICON}
                    title={`${p.name} — ${p.pos[0].toFixed(6)}, ${p.pos[1].toFixed(6)} (Location waypoint)`}
                  />
                ))}
                {Object.entries(terminalPulseUntil)
                  .filter(([, until]) => until > Date.now())
                  .map(([hid]) => {
                    const h = adminHubs.find((x) => x.id === hid);
                    if (!h) return null;
                    return (
                      <CircleF
                        key={`tp-g-${hid}`}
                        center={{ lat: h.pos[0], lng: h.pos[1] }}
                        radius={Math.max(120, Math.min(500, h.radiusM))}
                        options={{ strokeColor: "#34d399", strokeOpacity: 0.95, strokeWeight: 3, fillOpacity: 0 }}
                      />
                    );
                  })}
                {/* Traffic intel is pinpoint-based (no corridor lines). */}
                {layers.heatmap
                  ? adminHubs.map((h) => (
                      <CircleF
                        key={`h-${h.id}`}
                        center={{ lat: h.pos[0], lng: h.pos[1] }}
                        radius={Math.max(900, Math.min(3200, 900 + h.ticketCountToday * 40))}
                        options={{
                          strokeOpacity: 0,
                          fillColor: h.loadColor,
                          fillOpacity: 0.2,
                        }}
                      />
                    ))
                  : null}
                {stopsList.map((s) => {
                  const slat = Number(s.latitude);
                  const slng = Number(s.longitude);
                  if (!Number.isFinite(slat) || !Number.isFinite(slng)) return null;
                  const flexStop = s.pickupOnly === false;
                  return (
                    <MarkerF
                      key={`s-${s._id}`}
                      position={{ lat: slat, lng: slng }}
                      zIndex={9550}
                      icon={flexStop ? GOOGLE_CYAN_WAYPOINT_FLEX_ICON : GOOGLE_CYAN_WAYPOINT_ICON}
                      title={`${s.name || "Bus stop"}${flexStop ? " (flexible)" : ""} — ${slat.toFixed(6)}, ${slng.toFixed(6)}`}
                    />
                  );
                })}
                {layers.buses
                  ? busState.map((b) => {
                      const delayMin = delayMinutesByBus.get(b.busId) ?? 0;
                      const etaDelayMin = b.etaMinutes != null ? Number(b.etaMinutes) : 0;
                      const isDelayed =
                        delayMin >= DELAY_HIGHLIGHT_MINUTES ||
                        dispatchByBusId.get(b.busId)?.status === "delayed" ||
                        etaDelayMin > 10 ||
                        b.trafficDelay;
                      const trafficHint = trafficDelayHintByBus.get(b.busId) ?? "On time: light traffic";
                      const trailPts = trailByBus[b.busId] ?? [];
                      const trailSegments = trailPts
                        .slice(1)
                        .map((p, i) => ({ a: trailPts[i]!, b: p }))
                        .filter((s) => !!s.a && !!s.b);
                      const now = Date.now();
                      const hasSosRing = (sosRingUntil[b.busId] ?? 0) > now;
                      const isTrafficRisk = layers.traffic && (b.trafficDelay || (b.speedKph != null && b.speedKph < 15));
                      const isDelayRisk = layers.delays && isDelayed;
                      const routeAvg = averageSpeedByRoute.get(String(b.assignedRoute || "Assigned route —").trim()) ?? null;
                      const speedDropRisk =
                        b.speedKph != null && routeAvg != null && routeAvg > 0 && Number(b.speedKph) <= routeAvg * 0.7;
                      const trailColor = isDelayRisk || speedDropRisk ? "#fb923c" : isTrafficRisk ? "#f59e0b" : "#00FFFF";
                      const pinFill = b.speedCritical ? "#ef4444" : b.terminalArrival ? "#3b82f6" : "#00FFFF";
                      const pinScale = b.terminalArrival ? 7.5 : b.speedCritical ? 9 : 8;
                      return (
                        <Fragment key={`b-${b.busId}`}>
                          {trailSegments.map((seg, idx) => {
                            const violation = (seg.b.speed ?? 0) > 80 || (seg.a.speed ?? 0) > 80;
                            return (
                              <PolylineF
                                key={`trg-${b.busId}-${idx}`}
                                path={[
                                  { lat: seg.a.lat, lng: seg.a.lng },
                                  { lat: seg.b.lat, lng: seg.b.lng },
                                ]}
                                options={{
                                  strokeColor: violation ? "#ff0000" : trailColor,
                                  strokeOpacity: 0.7,
                                  strokeWeight: 3,
                                  zIndex: 1,
                                }}
                              />
                            );
                          })}
                          {b.terminalArrival ? (
                            <CircleF
                              center={{ lat: b.pos[0], lng: b.pos[1] }}
                              radius={140}
                              options={{ strokeColor: "#34d399", strokeOpacity: 0.95, strokeWeight: 3, fillOpacity: 0 }}
                            />
                          ) : null}
                          {hasSosRing ? (
                            <CircleF
                              center={{ lat: b.pos[0], lng: b.pos[1] }}
                              radius={100}
                              options={{ strokeColor: "#e11d48", strokeOpacity: 0.95, strokeWeight: 3, fillOpacity: 0 }}
                            />
                          ) : null}
                          {layers.traffic && isTrafficRisk ? (
                            <CircleF
                              center={{ lat: b.pos[0], lng: b.pos[1] }}
                              radius={70}
                              options={{ strokeColor: "#f59e0b", strokeOpacity: 0.95, strokeWeight: 2, fillOpacity: 0 }}
                            />
                          ) : null}
                          <MarkerF
                            position={{ lat: b.pos[0], lng: b.pos[1] }}
                            onClick={() => handleBusMarkerClick({ busId: b.busId, pos: b.pos })}
                            zIndex={9999}
                            icon={
                              googleCirclePath != null
                                ? ({
                                    path: googleCirclePath,
                                    scale: pinScale,
                                    fillColor: pinFill,
                                    fillOpacity: 0.95,
                                    strokeColor: "#0b1220",
                                    strokeWeight: 2.4,
                                  } as google.maps.Symbol)
                                : undefined
                            }
                          />
                          {selectedMapEntity === `bus:${b.busId}` ? (
                            <InfoWindowF position={{ lat: b.pos[0], lng: b.pos[1] }} onCloseClick={() => setSelectedMapEntity(null)}>
                              <div style={{ minWidth: 220 }}>
                                <strong>{b.displayBusLabel}</strong>
                                <div>{b.attendantName ?? "Attendant —"}</div>
                                <div>Speed: {b.speedKph != null ? `${b.speedKph.toFixed(1)} km/h` : "—"}</div>
                                <div>Source: {b.source === "hardware" ? "🛰️ Hardware" : "📱 Mobile"}</div>
                                {b.nextTerminal ? <div>Next: {b.nextTerminal}</div> : null}
                                {b.etaTargetIso ? <div>ETA: {new Date(b.etaTargetIso).toLocaleTimeString()}</div> : null}
                                {layers.traffic ? <div>{trafficHint}</div> : null}
                                {isDelayed ? <div style={{ color: "#b91c1c" }}>Delay: +{Math.max(delayMin, etaDelayMin)}m</div> : null}
                              </div>
                            </InfoWindowF>
                          ) : null}
                        </Fragment>
                      );
                    })
                  : null}
              </GoogleMap>
            )}
            {mounted ? (
              <MapControlPanel
                basemap={basemap}
                onBasemapChange={setBasemap}
                layers={layers}
                onToggle={onToggleLayer}
                activeBuses={busState.length}
                regionLabel="Bukidnon"
              />
            ) : null}
            <TacticalMapLegendHud />
          </div>
        </div>
      </div>
      <div className="locations-page__map-reference" aria-label="Map reference">
        <p className="locations-page__map-reference-title">Map reference</p>
        <ul className="locations-page__map-reference-list">
          <li className="locations-page__map-reference-item">
            <LocationsLegendTerminalPin />
            <span>Terminal hub</span>
          </li>
          <li className="locations-page__map-reference-item">
            <LocationsLegendBusStopPin />
            <span>Route bus stop</span>
          </li>
          <li className="locations-page__map-reference-item">
            <span className="locations-page__map-reference-swatch locations-page__map-reference-swatch--deployed" aria-hidden />
            <span>Deployed</span>
          </li>
        </ul>
        {contextError ? <p className="locations-page__warn">{contextError}</p> : null}
      </div>

      <section className="locations-page__fleet-bar" aria-label="Live fleet">
        <div className="locations-page__fleet-bar-head">
          <h2 className="locations-page__insight-title">Live fleet</h2>
        </div>
        {busState.length === 0 ? (
          <p className="locations-page__legend-card-sub" style={{ margin: 0 }}>
            {busRows.length > 0 ? (
              <>No live GPS pings yet — ensure assigned attendant devices are online and sharing location.</>
            ) : (
              <>
                No buses in the fleet registry and no live GPS pings — open <strong>Management → Fleet</strong> to register buses, then ensure
                attendant devices report location.
              </>
            )}
          </p>
        ) : (
          <ul className="locations-page__bus-list locations-page__bus-list--horizontal">
            {busState.map((b) => (
              <li key={b.busId} className="locations-page__fleet-card-cell">
                <LiveFleetBusCard
                  busId={b.busId}
                  route={b.assignedRoute}
                  signalTier={b.stationary ? "offline" : (b.signalTier ?? "weak")}
                  attendantLine={
                    b.source === "hardware"
                      ? `🛰️ Hardware backup${b.sourceNet ? ` (${b.sourceNet.toUpperCase()})` : ""}`
                      : b.attendantName
                        ? `📱 Attendant · ${b.attendantName}`
                        : "📱 Attendant · —"
                  }
                  lastSyncLine={`Last sync ${b.lastSyncLabel}`}
                  active={selectedBusId === b.busId}
                  onClick={() => {
                    setSelectedBusId(b.busId);
                    setFlyTarget(b.pos);
                    setFlySeq((n) => n + 1);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
