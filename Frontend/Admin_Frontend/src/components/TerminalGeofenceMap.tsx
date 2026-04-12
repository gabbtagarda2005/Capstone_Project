import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { haversineMeters } from "@/lib/haversineMeters";
import "./TerminalGeofenceMap.css";

type LiveBus = { busId: string; latitude: number; longitude: number };

export type TerminalCoverageStop = {
  name: string;
  latitude: number;
  longitude: number;
  sequence: number;
  geofenceRadiusM?: number;
};

type Props = {
  centerLat: number;
  centerLng: number;
  geofenceRadiusM: number;
  liveBuses: LiveBus[];
  /** Terminal label for map popup / legend */
  terminalName?: string;
  /** Bus stops configured for this coverage hub (shown as markers + optional geofences) */
  stops?: TerminalCoverageStop[];
};

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const b = L.latLngBounds(points);
    if (!b.isValid()) return;
    map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export function TerminalGeofenceMap({
  centerLat,
  centerLng,
  geofenceRadiusM,
  liveBuses,
  terminalName = "Terminal",
  stops = [],
}: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  const validStops = useMemo(
    () =>
      [...stops]
        .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
        .sort((a, b) => a.sequence - b.sequence),
    [stops]
  );

  const routeLine = useMemo(() => {
    const line: [number, number][] = [[centerLat, centerLng]];
    for (const s of validStops) {
      line.push([s.latitude, s.longitude]);
    }
    return line;
  }, [centerLat, centerLng, validStops]);

  const fitPoints = useMemo(() => {
    const pts: [number, number][] = [[centerLat, centerLng]];
    for (const s of validStops) pts.push([s.latitude, s.longitude]);
    return pts;
  }, [centerLat, centerLng, validStops]);

  const inside = useMemo(
    () =>
      liveBuses.filter(
        (b) =>
          Number.isFinite(b.latitude) &&
          Number.isFinite(b.longitude) &&
          haversineMeters(centerLat, centerLng, b.latitude, b.longitude) <= geofenceRadiusM
      ),
    [liveBuses, centerLat, centerLng, geofenceRadiusM]
  );

  if (!ready) {
    return <div className="term-geo-map term-geo-map--placeholder" aria-hidden />;
  }

  return (
    <div className="term-geo-map">
      <div className="term-geo-map__chrome">
        <span className="term-geo-map__tag">TERMINAL · STOPS · LIVE BUSES</span>
        <span className="term-geo-map__hint">
          {geofenceRadiusM} m terminal · {validStops.length} stop{validStops.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="term-geo-map__frame">
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={14}
          className="term-geo-map__leaflet"
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" subdomains="abcd" maxZoom={20} />
          {routeLine.length >= 2 ? (
            <Polyline
              positions={routeLine}
              pathOptions={{
                color: "#1f5885",
                weight: 3,
                opacity: 0.85,
                dashArray: "8 6",
              }}
            />
          ) : null}
          <Circle
            center={[centerLat, centerLng]}
            radius={geofenceRadiusM}
            pathOptions={{
              color: "#22d3ee",
              weight: 2,
              opacity: 0.95,
              fillColor: "#22d3ee",
              fillOpacity: 0.12,
              className: "term-geo-map__fence",
            }}
          />
          {validStops.map((s) => {
            const r = s.geofenceRadiusM != null && Number.isFinite(s.geofenceRadiusM) && s.geofenceRadiusM >= 20 ? s.geofenceRadiusM : 100;
            return (
              <Circle
                key={`fence-${s.sequence}-${s.name}`}
                center={[s.latitude, s.longitude]}
                radius={r}
                pathOptions={{
                  color: "#f59e0b",
                  weight: 1.5,
                  opacity: 0.75,
                  fillColor: "#f59e0b",
                  fillOpacity: 0.08,
                }}
              />
            );
          })}
          <CircleMarker
            center={[centerLat, centerLng]}
            radius={9}
            pathOptions={{
              color: "#67e8f9",
              weight: 3,
              fillColor: "#0ea5e9",
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <strong>Terminal</strong>
              <br />
              {terminalName}
              <br />
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px" }}>
                {centerLat.toFixed(5)}, {centerLng.toFixed(5)}
              </span>
            </Popup>
          </CircleMarker>
          {validStops.map((s) => (
            <CircleMarker
              key={`stop-${s.sequence}-${s.name}`}
              center={[s.latitude, s.longitude]}
              radius={7}
              pathOptions={{
                color: "#fbbf24",
                weight: 2,
                fillColor: "#d97706",
                fillOpacity: 0.95,
              }}
            >
              <Popup>
                <strong>Bus stop</strong> · seq {s.sequence}
                <br />
                {s.name}
                <br />
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px" }}>
                  {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                </span>
              </Popup>
            </CircleMarker>
          ))}
          {liveBuses.map((b) => {
            const isIn = haversineMeters(centerLat, centerLng, b.latitude, b.longitude) <= geofenceRadiusM;
            return (
              <CircleMarker
                key={b.busId}
                center={[b.latitude, b.longitude]}
                radius={isIn ? 9 : 5}
                pathOptions={{
                  color: isIn ? "#4ade80" : "rgba(148,163,184,0.5)",
                  weight: isIn ? 2 : 1,
                  fillColor: isIn ? "#22c55e" : "rgba(71,85,105,0.6)",
                  fillOpacity: 0.9,
                }}
              >
                <Popup>
                  <strong>Bus</strong> {b.busId}
                  {isIn ? <span> · inside terminal geofence</span> : <span> · outside terminal geofence</span>}
                </Popup>
              </CircleMarker>
            );
          })}
          {fitPoints.length >= 2 ? <FitBounds points={fitPoints} /> : null}
        </MapContainer>
      </div>
      <p className="term-geo-map__legend">
        <span className="term-geo-map__led term-geo-map__led--terminal" /> Terminal
        <span className="term-geo-map__led term-geo-map__led--stop" /> Bus stops
        <span className="term-geo-map__led term-geo-map__led--in" /> Bus in zone
        <span className="term-geo-map__led term-geo-map__led--out" /> Bus elsewhere · {inside.length} in terminal zone
      </p>
    </div>
  );
}
