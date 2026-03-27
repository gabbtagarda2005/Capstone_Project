import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Popup,
  Circle,
  Marker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useSearchParams } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import { GEOFENCE_BREACH_EVENT } from "@/lib/geofenceEvents";
import { pushGeofenceAlert } from "@/lib/opsEvents";
import { pushAdminAudit } from "@/lib/adminAudit";
import { postSecurityLog } from "@/lib/securityLog";
import { buildHeatTrail, isFastPulse, makeBusDivIcon } from "@/lib/locationsMapUtils";
import { MapControlPanel, type MapLayerKey, type MapLayerState } from "@/components/map/MapControlPanel";
import { useAuth } from "@/context/AuthContext";
import "./LocationsPage.css";

const DEFAULT_CENTER: [number, number] = [8.1477, 125.1324];
const DEFAULT_ZOOM = 10;
const BUKIDNON_FOCUS: [number, number] = [8.0515, 125.0];
const BUKIDNON_FOCUS_ZOOM = 11.6;
const SEMANTIC_ZOOM_DETAIL = 11.5;

/** Terminal safe-zone radii (m) — Malaybalay, Valencia, Maramag */
const GEOFENCE_TERMINALS: { name: string; pos: [number, number]; radius: number }[] = [
  { name: "Malaybalay terminal", pos: [8.1477, 125.1324], radius: 6500 },
  { name: "Valencia City", pos: [7.9042, 125.0938], radius: 6000 },
  { name: "Maramag", pos: [7.7617, 125.0053], radius: 5500 },
];

type Hub = {
  name: string;
  pos: [number, number];
  waitingPassengers: number;
  buses: string[];
};

const HUBS: Hub[] = [
  { name: "Malaybalay terminal", pos: [8.1477, 125.1324], waitingPassengers: 148, buses: ["3423424", "BUK-101", "BUK-501"] },
  { name: "Valencia City", pos: [7.9042, 125.0938], waitingPassengers: 82, buses: ["BUK-232", "BUK-317"] },
  { name: "Maramag", pos: [7.7617, 125.0053], waitingPassengers: 39, buses: ["BUK-711"] },
  { name: "Don Carlos", pos: [7.6889, 125.0068], waitingPassengers: 18, buses: ["BUK-812"] },
];

/** Intermediate bus stops (not full terminals) — shown as smaller map markers */
const BUS_STOPS: { name: string; pos: [number, number] }[] = [
  { name: "BukSU Main Campus stop", pos: [8.125, 125.098] },
  { name: "Malaybalay Public Market", pos: [8.152, 125.128] },
  { name: "Sayre Highway · North checkpoint", pos: [8.02, 125.11] },
  { name: "Valencia City Plaza stop", pos: [7.898, 125.088] },
  { name: "Maramag highway bay", pos: [7.755, 125.018] },
  { name: "Don Carlos junction", pos: [7.695, 125.012] },
];

type Route = { name: string; points: [number, number][] };
const ROUTES: Route[] = [
  { name: "Malaybalay ↔ Valencia", points: [HUBS[0]!.pos, HUBS[1]!.pos] },
  { name: "Valencia ↔ Maramag", points: [HUBS[1]!.pos, HUBS[2]!.pos] },
  { name: "Maramag ↔ Don Carlos", points: [HUBS[2]!.pos, HUBS[3]!.pos] },
  { name: "dulogon ↔ wdadwad", points: [[7.95, 125.12], [7.82, 125.2]] },
];

const BUS_TRACKING = [
  { busId: "3423424", assignedRoute: "Malaybalay ↔ Valencia", currentTerminal: "Don Carlos" },
  { busId: "BUK-101", assignedRoute: "Malaybalay ↔ Valencia", currentTerminal: "Malaybalay terminal" },
  { busId: "BUK-232", assignedRoute: "Valencia ↔ Maramag", currentTerminal: "Valencia City" },
  { busId: "BUK-709", assignedRoute: "dulogon ↔ wdadwad", currentTerminal: "Valencia City" },
];

const DRIVER_BY_BUS: Record<string, string> = {
  "3423424": "R. Dela Cruz",
  "BUK-101": "M. Sarmiento",
  "BUK-232": "J. Omblero",
  "BUK-709": "A. Bautista",
};

const FUEL_PCT: Record<string, number> = {
  "3423424": 62,
  "BUK-101": 88,
  "BUK-232": 41,
  "BUK-709": 74,
};

type WeatherByHub = Record<string, { label: string; emoji: string }>;

function FocusBukidnon({ enabled }: { enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) return;
    map.flyTo(BUKIDNON_FOCUS, BUKIDNON_FOCUS_ZOOM, { animate: true, duration: 1.25 });
  }, [enabled, map]);
  return null;
}

function MapZoomSync({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
    moveend: () => onZoom(map.getZoom()),
  });
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  return null;
}

function FlyToBus({ target, seq }: { target: [number, number] | null; seq: number }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo(target, 14, { duration: 1.05 });
  }, [target, seq, map]);
  return null;
}

function classifyTraffic(waitingPassengers: number): { level: "high" | "medium" | "low"; color: string; radius: number } {
  if (waitingPassengers >= 100) return { level: "high", color: "#ef4444", radius: 12 };
  if (waitingPassengers >= 50) return { level: "medium", color: "#f59e0b", radius: 10 };
  return { level: "low", color: "#22c55e", radius: 8 };
}

function weatherLabel(code: number): { label: string; emoji: string } {
  if ([61, 63, 65, 80, 81, 82].includes(code)) return { label: "Rain expected", emoji: "🌧️" };
  if ([71, 73, 75].includes(code)) return { label: "Cold / frost", emoji: "❄️" };
  if ([95, 96, 99].includes(code)) return { label: "Thunderstorm", emoji: "⛈️" };
  if ([1, 2, 3, 45, 48].includes(code)) return { label: "Cloudy", emoji: "☁️" };
  return { label: "Clear", emoji: "☀️" };
}

function routeTouchesRain(routeName: string, weather: WeatherByHub): boolean {
  const r = ROUTES.find((x) => x.name === routeName);
  if (!r) return false;
  for (const p of r.points) {
    const hub = HUBS.find((h) => h.pos[0] === p[0] && h.pos[1] === p[1]);
    if (!hub) continue;
    const w = weather[hub.name];
    if (w?.emoji === "🌧️" || w?.emoji === "⛈️") return true;
  }
  return false;
}

export function LocationsPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const focusBukidnon = searchParams.get("focus") === "ukidnon" || searchParams.get("focus") === "bukidnon";
  const [mounted, setMounted] = useState(false);
  const [weather, setWeather] = useState<WeatherByHub>({});
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [layers, setLayers] = useState<MapLayerState>({
    geofence: true,
    traffic: false,
    heatmap: true,
    delays: true,
  });
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [flySeq, setFlySeq] = useState(0);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const geofenceAuditSent = useRef(new Set<string>());
  const [mapAlert, setMapAlert] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const results = await Promise.all(
          HUBS.map(async (h) => {
            const url =
              `https://api.open-meteo.com/v1/forecast?latitude=${h.pos[0]}` +
              `&longitude=${h.pos[1]}&current=weather_code&timezone=auto`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("weather unavailable");
            const data = (await res.json()) as { current?: { weather_code?: number } };
            const code = Number(data.current?.weather_code ?? 0);
            return [h.name, weatherLabel(code)] as const;
          })
        );
        if (!cancelled) setWeather(Object.fromEntries(results));
      } catch {
        /* ignore */
      }
    };
    void run();
    const id = window.setInterval(() => void run(), 300_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const runGeofenceScan = useCallback(() => {
    for (const bus of BUS_TRACKING) {
      const route = ROUTES.find((r) => r.name === bus.assignedRoute);
      const allowedTerminals =
        route?.points.map((p) => HUBS.find((h) => h.pos[0] === p[0] && h.pos[1] === p[1])?.name).filter(Boolean) ?? [];
      const offRoute = !allowedTerminals.includes(bus.currentTerminal);
      if (offRoute) {
        pushGeofenceAlert({
          busId: bus.busId,
          assignedRoute: bus.assignedRoute,
          currentTerminal: bus.currentTerminal,
          severity: "critical",
        });
        const hub = HUBS.find((h) => h.name === bus.currentTerminal);
        const latitude = hub?.pos[0] ?? DEFAULT_CENTER[0];
        const longitude = hub?.pos[1] ?? DEFAULT_CENTER[1];
        if (!geofenceAuditSent.current.has(bus.busId)) {
          geofenceAuditSent.current.add(bus.busId);
          pushAdminAudit({
            admin: user?.email ?? "Automated Geofence",
            action: `Bus ${bus.busId} — corridor mismatch (${bus.currentTerminal} vs ${bus.assignedRoute}).`,
            level: "CRITICAL",
          });
          const msg = `Bus ${bus.busId} departed assigned corridor (${bus.assignedRoute}); reported terminal ${bus.currentTerminal}.`;
          postSecurityLog({
            type: "geofence_breach",
            busId: bus.busId,
            message: msg,
            severity: "critical",
            latitude,
            longitude,
            assignedRoute: bus.assignedRoute,
            currentTerminal: bus.currentTerminal,
          });
          window.dispatchEvent(
            new CustomEvent(GEOFENCE_BREACH_EVENT, {
              detail: {
                breachId: `${bus.busId}-${Date.now()}`,
                busId: bus.busId,
                latitude,
                longitude,
                assignedRoute: bus.assignedRoute,
                currentTerminal: bus.currentTerminal,
              },
            })
          );
        }
        setMapAlert(`Geofence: ${bus.busId} outside allowed corridor for ${bus.assignedRoute}.`);
        window.setTimeout(() => setMapAlert(null), 10_000);
      }
    }
  }, [user?.email]);

  useEffect(() => {
    runGeofenceScan();
  }, [runGeofenceScan]);

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

  const routeRevenueToday = useMemo(() => {
    const now = new Date();
    const map = new Map<string, number>();
    const sameDay = (d: Date) =>
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    tickets.forEach((t) => {
      const dt = new Date(t.createdAt);
      if (!sameDay(dt)) return;
      const direct = `${t.startLocation} ↔ ${t.destination}`;
      const reverse = `${t.destination} ↔ ${t.startLocation}`;
      const routeName = ROUTES.find((r) => r.name === direct || r.name === reverse)?.name ?? direct;
      map.set(routeName, (map.get(routeName) ?? 0) + t.fare);
    });
    return map;
  }, [tickets]);

  const violatingBusIds = useMemo(() => {
    const s = new Set<string>();
    for (const bus of BUS_TRACKING) {
      const route = ROUTES.find((r) => r.name === bus.assignedRoute);
      const allowedTerminals =
        route?.points.map((p) => HUBS.find((h) => h.pos[0] === p[0] && h.pos[1] === p[1])?.name).filter(Boolean) ?? [];
      if (!allowedTerminals.includes(bus.currentTerminal)) s.add(bus.busId);
    }
    return s;
  }, []);

  const busState = useMemo(() => {
    return BUS_TRACKING.map((b, idx) => {
      const routeRevenue = routeRevenueToday.get(b.assignedRoute) ?? 0;
      const seats = b.busId === "3423424" ? 50 : 45;
      const issuedApprox = b.busId === "3423424" ? 50 : Math.min(seats, Math.round(routeRevenue / 15));
      const terminal = HUBS.find((h) => h.name === b.currentTerminal);
      const basePos: [number, number] = terminal?.pos ?? DEFAULT_CENTER;
      const pos: [number, number] = [basePos[0] + idx * 0.0055, basePos[1] + idx * 0.0035];
      const pct = seats > 0 ? (issuedApprox / seats) * 100 : 0;
      const full = pct >= 95;
      return { ...b, seats, issuedApprox, pos, pct, full, violating: violatingBusIds.has(b.busId) };
    });
  }, [routeRevenueToday, violatingBusIds]);

  const busIcons = useMemo(() => {
    const m = new Map<string, ReturnType<typeof makeBusDivIcon>>();
    busState.forEach((b) => {
      m.set(b.busId, makeBusDivIcon(b.full || b.violating, isFastPulse(b.busId)));
    });
    return m;
  }, [busState]);

  function routeStrokeColor(routeName: string): string {
    const rev = routeRevenueToday.get(routeName) ?? 0;
    if (rev > 5000) return "#ef4444";
    if (rev < 500) return "#22c55e";
    return "#f59e0b";
  }

  const detailZoom = mapZoom >= SEMANTIC_ZOOM_DETAIL;

  return (
    <div className="locations-page">
      <div className="locations-page__split">
        <div className="locations-page__map-shell">
          {mapAlert ? (
            <div className="locations-page__glass-alert" role="alert">
              <span className="locations-page__glass-alert__dot" />
              <span className="locations-page__glass-alert__text">{mapAlert}</span>
              <button type="button" className="locations-page__glass-alert__x" onClick={() => setMapAlert(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
          ) : null}

          <div className="locations-page__map-wrap">
            {!mounted ? (
              <div className="locations-page__map-skeleton" aria-hidden>
                Initializing tactical map…
              </div>
            ) : (
              <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="locations-page__map" scrollWheelZoom>
                <MapZoomSync onZoom={setMapZoom} />
                <FlyToBus target={flyTarget} seq={flySeq} />
                <FocusBukidnon enabled={focusBukidnon} />
                <TileLayer
                  attribution='&copy; <a href="https://carto.com/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                {layers.geofence
                  ? GEOFENCE_TERMINALS.map((z) => {
                      const breach = violatingBusIds.size > 0;
                      return (
                        <Circle
                          key={z.name}
                          center={z.pos}
                          radius={z.radius}
                          pathOptions={{
                            color: breach ? "rgba(248, 113, 113, 0.95)" : "rgba(52, 211, 153, 0.85)",
                            fillColor: breach ? "#ef4444" : "#10b981",
                            fillOpacity: breach ? 0.12 : 0.08,
                            weight: breach ? 3 : 2,
                            dashArray: breach ? "8 6" : undefined,
                          }}
                        />
                      );
                    })
                  : null}
                {ROUTES.map((r) => {
                  const baseColor = routeStrokeColor(r.name);
                  const delayRisk = layers.delays && routeTouchesRain(r.name, weather);
                  return (
                    <Polyline
                      key={r.name}
                      positions={r.points}
                      pathOptions={{
                        color: delayRisk ? "#fb923c" : baseColor,
                        opacity: delayRisk ? 0.95 : 0.82,
                        weight: delayRisk ? 7 : 5,
                      }}
                    />
                  );
                })}
                {layers.traffic
                  ? ROUTES.map((r) => (
                      <Polyline
                        key={`traffic-${r.name}`}
                        positions={r.points}
                        pathOptions={{
                          color: "rgba(251, 191, 36, 0.55)",
                          opacity: 0.9,
                          weight: 3,
                          dashArray: "6 10",
                        }}
                      />
                    ))
                  : null}
                {layers.heatmap
                  ? HUBS.map((h) => (
                      <Circle
                        key={`heat-${h.name}`}
                        center={h.pos}
                        radius={2800 + classifyTraffic(h.waitingPassengers).radius * 180}
                        pathOptions={{
                          color: "transparent",
                          fillColor: "#22d3ee",
                          fillOpacity: 0.06 + Math.min(0.12, h.waitingPassengers / 2000),
                          weight: 0,
                        }}
                      />
                    ))
                  : null}
                {busState.map((b) => (
                  <Polyline
                    key={`trail-${b.busId}`}
                    positions={buildHeatTrail(b.pos, b.busId.length * 7)}
                    pathOptions={{
                      color: b.violating ? "rgba(248, 113, 113, 0.45)" : "rgba(34, 211, 238, 0.35)",
                      weight: 4,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                ))}
                {HUBS.map((h) => {
                  const t = classifyTraffic(h.waitingPassengers);
                  return (
                    <CircleMarker
                      key={h.name}
                      center={h.pos}
                      radius={detailZoom ? t.radius : Math.max(6, t.radius - 2)}
                      pathOptions={{
                        color: t.color,
                        fillColor: t.color,
                        fillOpacity: 0.42,
                        weight: 2,
                      }}
                    >
                      <Popup>
                        <strong>Terminal · {h.name}</strong>
                        <br />
                        Waiting: {h.waitingPassengers} · {t.level}
                        <br />
                        Buses: {h.buses.join(", ")}
                        <br />
                        Weather: {weather[h.name]?.emoji ?? "⏳"} {weather[h.name]?.label ?? "…"}
                      </Popup>
                    </CircleMarker>
                  );
                })}
                {BUS_STOPS.map((s) => (
                  <CircleMarker
                    key={s.name}
                    center={s.pos}
                    radius={detailZoom ? 7 : 5}
                    pathOptions={{
                      color: "#c4b5fd",
                      fillColor: "#7c3aed",
                      fillOpacity: 0.55,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <strong>Bus stop</strong>
                      <br />
                      {s.name}
                    </Popup>
                  </CircleMarker>
                ))}
                {busState.map((b) => {
                  const icon = busIcons.get(b.busId) ?? makeBusDivIcon(b.full || b.violating, isFastPulse(b.busId));
                  return (
                  <Marker key={b.busId} position={b.pos} icon={icon}>
                    <Popup>
                      <strong>Bus {b.busId}</strong>
                      {detailZoom ? (
                        <>
                          <br />
                          Driver: {DRIVER_BY_BUS[b.busId] ?? "—"}
                          <br />
                          Route: {b.assignedRoute}
                          <br />
                          Load: {b.issuedApprox}/{b.seats} ({Math.round(b.pct)}%)
                          {b.full ? " · CAPACITY CRITICAL" : ""}
                          <br />
                          Energy: {FUEL_PCT[b.busId] ?? "—"}% (sim)
                          {b.violating ? (
                            <>
                              <br />
                              <span style={{ color: "#f87171" }}>⚠ Corridor alert</span>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <br />
                          {b.assignedRoute} · {b.full ? "FULL" : "OK"}
                        </>
                      )}
                    </Popup>
                  </Marker>
                );
                })}
              </MapContainer>
            )}
            {mounted ? (
              <MapControlPanel
                layers={layers}
                onToggle={onToggleLayer}
                activeBuses={busState.length}
                regionLabel="Bukidnon"
              />
            ) : null}
          </div>
        </div>

        <aside className="locations-page__sidebar" aria-label="Terminals">
          <div className="locations-page__legend-card">
            <h3 className="locations-page__legend-card-title">Locations &amp; terminals</h3>
            <p className="locations-page__legend-card-sub">Passenger load by hub (demo)</p>
            <ul className="locations-page__legend locations-page__legend--stacked">
              {HUBS.map((h) => {
                const t = classifyTraffic(h.waitingPassengers);
                return (
                  <li key={h.name} className="locations-page__legend-item">
                    <span className="locations-page__legend-dot" style={{ background: t.color }} />
                    <span>
                      {h.name} · {h.waitingPassengers} pax · {t.level}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>

      <section className="locations-page__fleet-bar" aria-label="Live fleet">
        <div className="locations-page__fleet-bar-head">
          <h2 className="locations-page__insight-title">Live fleet</h2>
          <p className="locations-page__insight-sub">Select a unit to fly the map · ETAs refresh on a simulated checkpoint clock.</p>
        </div>
        <ul className="locations-page__bus-list locations-page__bus-list--horizontal">
          {busState.map((b) => (
            <li key={b.busId}>
              <button
                type="button"
                className={`locations-page__bus-row locations-page__bus-row--tile ${selectedBusId === b.busId ? "locations-page__bus-row--active" : ""}`}
                onClick={() => {
                  setSelectedBusId(b.busId);
                  setFlyTarget(b.pos);
                  setFlySeq((n) => n + 1);
                }}
              >
                <div className="locations-page__bus-row-top">
                  <span className="locations-page__bus-id">{b.busId}</span>
                  {b.full ? <span className="locations-page__bus-badge locations-page__bus-badge--full">95%+</span> : null}
                  {b.violating ? <span className="locations-page__bus-badge locations-page__bus-badge--alert">GEOFENCE</span> : null}
                </div>
                <div className="locations-page__bus-meta">
                  {DRIVER_BY_BUS[b.busId] ?? "—"} · {b.assignedRoute}
                </div>
                <div className="locations-page__bus-eta">ETA next hub · ~19 min (sim)</div>
              </button>
            </li>
          ))}
        </ul>
        <p className="locations-page__fleet-hint">
          Brushing: selected bus highlights on map. Delay-risk routes use orange when weather layer + rain on corridor.
        </p>
      </section>
    </div>
  );
}
