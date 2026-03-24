import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import { pushGeofenceAlert } from "@/lib/opsEvents";
import "./LocationsPage.css";

/** Malaybalay — Bukidnon hub */
const DEFAULT_CENTER: [number, number] = [8.1477, 125.1324];
const DEFAULT_ZOOM = 10;

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

type WeatherByHub = Record<string, { label: string; emoji: string }>;

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

export function LocationsPage() {
  const [mounted, setMounted] = useState(false);
  const [weather, setWeather] = useState<WeatherByHub>({});
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [salesError, setSalesError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setWeatherError(null);
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
        if (!cancelled) setWeatherError("Weather overlay unavailable");
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
      }
    }
  }, []);

  useEffect(() => {
    runGeofenceScan();
  }, [runGeofenceScan]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSalesError(null);
      try {
        const res = await api<{ items: TicketRow[] }>("/api/tickets");
        if (!cancelled) setTickets(res.items);
      } catch (e) {
        if (!cancelled) {
          setTickets([]);
          setSalesError(e instanceof Error ? e.message : "Ticket sales unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const routeRevenueToday = useMemo(() => {
    const now = new Date();
    const map = new Map<string, number>();
    const sameDay = (d: Date) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
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

  const busState = useMemo(() => {
    return BUS_TRACKING.map((b, idx) => {
      const routeRevenue = routeRevenueToday.get(b.assignedRoute) ?? 0;
      const seats = b.busId === "3423424" ? 50 : 45;
      const issuedApprox = b.busId === "3423424" ? 50 : Math.min(seats, Math.round(routeRevenue / 15));
      const terminal = HUBS.find((h) => h.name === b.currentTerminal);
      const basePos: [number, number] = terminal?.pos ?? DEFAULT_CENTER;
      const pos: [number, number] = [basePos[0] + idx * 0.0055, basePos[1] + idx * 0.0035];
      return { ...b, seats, issuedApprox, full: issuedApprox >= seats, pos };
    });
  }, [routeRevenueToday]);

  function routeStrokeColor(routeName: string): string {
    const rev = routeRevenueToday.get(routeName) ?? 0;
    if (rev > 5000) return "#ef4444";
    if (rev < 500) return "#22c55e";
    return "#f59e0b";
  }

  const trafficCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    HUBS.forEach((h) => {
      counts[classifyTraffic(h.waitingPassengers).level] += 1;
    });
    return counts;
  }, []);

  return (
    <div className="locations-page">
      <header className="locations-page__head">
        <h1 className="locations-page__title">View location</h1>
        <p className="locations-page__lead">Bukidnon service area · terminal capacity heatmap · weather and geofencing</p>
        <div className="locations-page__actions">
          <button type="button" className="locations-page__scan-btn" onClick={runGeofenceScan}>
            Run geofence scan
          </button>
          {salesError ? <span className="locations-page__warn">{salesError}</span> : null}
          {weatherError ? <span className="locations-page__warn">{weatherError}</span> : null}
        </div>
      </header>

      <div className="locations-page__map-wrap">
        {!mounted ? (
          <div className="locations-page__map-skeleton" aria-hidden>
            Loading map…
          </div>
        ) : (
          <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="locations-page__map" scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {ROUTES.map((r) => (
              <Polyline key={r.name} positions={r.points} pathOptions={{ color: routeStrokeColor(r.name), opacity: 0.78, weight: 6 }} />
            ))}
            {HUBS.map((h) => (
              <CircleMarker
                key={h.name}
                center={h.pos}
                radius={classifyTraffic(h.waitingPassengers).radius}
                pathOptions={{
                  color: classifyTraffic(h.waitingPassengers).color,
                  fillColor: classifyTraffic(h.waitingPassengers).color,
                  fillOpacity: 0.45,
                }}
              >
                <Popup>
                  <strong>{h.name}</strong>
                  <br />
                  Total passengers waiting: {h.waitingPassengers}
                  <br />
                  Buses at terminal: {h.buses.join(", ")}
                  <br />
                  Traffic level: {classifyTraffic(h.waitingPassengers).level.toUpperCase()}
                  <br />
                  Weather: {weather[h.name]?.emoji ?? "⏳"} {weather[h.name]?.label ?? "Loading"}
                </Popup>
              </CircleMarker>
            ))}
            {busState.map((b) => (
              <CircleMarker
                key={b.busId}
                center={b.pos}
                radius={6}
                pathOptions={{ color: b.full ? "#ef4444" : "#38bdf8", fillColor: b.full ? "#ef4444" : "#38bdf8", fillOpacity: 0.9 }}
              >
                <Popup>
                  <strong>Bus {b.busId}</strong>
                  <br />
                  Route: {b.assignedRoute}
                  <br />
                  Occupancy: {b.issuedApprox}/{b.seats} {b.full ? "· FULL" : ""}
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        )}
      </div>

      <ul className="locations-page__legend">
        {HUBS.map((h) => {
          const t = classifyTraffic(h.waitingPassengers);
          return (
          <li key={h.name} className="locations-page__legend-item">
            <span className="locations-page__legend-dot" style={{ background: t.color }} />
            {h.name} · {h.waitingPassengers} pax · {t.level}
          </li>
        );
        })}
      </ul>
      <ul className="locations-page__traffic-summary">
        <li>High traffic terminals: {trafficCounts.high}</li>
        <li>Medium traffic terminals: {trafficCounts.medium}</li>
        <li>Low traffic terminals: {trafficCounts.low}</li>
        <li>Route lines: Green {"<"} ₱500 · Red {">"} ₱5,000 (today)</li>
      </ul>
    </div>
  );
}
