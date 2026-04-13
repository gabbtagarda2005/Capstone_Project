import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./DashboardMap.css";
import { PassengerMapBasemapDock } from "@/components/PassengerMapBasemapDock";
import {
  fetchDeployedPoints,
  fetchLiveBusPositions,
  type DeployedPointItem,
  type LiveBusPosition,
} from "@/lib/fetchPassengerMapData";
import { fetchPublicFleetBuses, type PublicFleetBus } from "@/lib/fetchPublicFleetBuses";
import { fetchPublicOperationsDeck } from "@/lib/fetchPublicOperationsDeck";
import { passengerTileLayer, type PassengerBasemapMode } from "@/lib/passengerMapTiles";
import { haversineKm } from "@/lib/passengerGeo";
import { getPassengerLocationSession } from "@/lib/passengerLocationGate";

type MapConfig = {
  center: { lat: number; lng: number };
  zoom: number;
  label: string;
  tileUrl: string;
  attribution: string;
};

const defaultConfig: MapConfig = {
  center: { lat: 8.158, lng: 125.1236 },
  zoom: 11,
  label: "Malaybalay · Bukidnon",
  tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; OpenStreetMap',
};

const LEAFLET_TERMINAL_ICON = L.divIcon({
  className: "dashboard-map__marker-terminal",
  html:
    '<div class="dashboard-map__terminal-inner" aria-hidden>' +
    '<svg width="32" height="32" viewBox="-1.1 -1.1 2.2 2.2" focusable="false">' +
    '<polygon points="0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5" fill="#34d399" stroke="#065f46" stroke-width="0.12" />' +
    "</svg></div>",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const LEAFLET_STOP_ICON = L.divIcon({
  className: "dashboard-map__marker-stop",
  html:
    '<div style="width:11px;height:11px;border-radius:50%;background:#22d3ee;border:2px solid #0b1220;box-sizing:border-box"></div>',
  iconSize: [11, 11],
  iconAnchor: [5, 5],
});

const LEAFLET_WAYPOINT_ICON = L.divIcon({
  className: "dashboard-map__marker-waypoint",
  html:
    '<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center">' +
    '<div style="position:absolute;inset:0;border-radius:50%;border:2px dashed rgba(103,232,249,0.95);box-sizing:border-box"></div>' +
    '<div style="width:11px;height:11px;border-radius:50%;background:#22d3ee;border:2px solid #0b1220;box-sizing:border-box"></div>' +
    "</div>",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function busDivIcon() {
  return L.divIcon({
    className: "dashboard-map__bus-marker",
    html: `<div class="dashboard-map__bus-pin" aria-hidden="true">🚌</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

const USER_LOCATION_ICON = L.divIcon({
  className: "dashboard-map__marker-user",
  html:
    '<div class="dashboard-map__user-dot-wrap" aria-hidden="true">' +
    '<span class="dashboard-map__user-pulse"></span>' +
    '<span class="dashboard-map__user-core"></span>' +
    "</div>",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const NEARBY_BUS_RADIUS_KM = 40;

function formatDistanceToTerminal(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** First paint after enabling location: lock zoom 15 on passenger position. */
function EnsureUserMapView({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    map.setView([lat, lng], zoom, { animate: true });
  }, [map, lat, lng, zoom]);
  return null;
}

function RecenterWhenConfigChanges({
  center,
  zoom,
  block,
}: {
  center: [number, number];
  zoom: number;
  block: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (block) return;
    map.setView(center, zoom, { animate: true });
  }, [map, center[0], center[1], zoom, block]);
  return null;
}

function AutoFitOnce({
  fitKey,
  points,
  disabled,
}: {
  fitKey: string;
  points: [number, number][];
  disabled?: boolean;
}) {
  const map = useMap();
  const lastKey = useRef("");
  useEffect(() => {
    if (disabled) return;
    if (!fitKey || points.length === 0) return;
    if (lastKey.current === fitKey) return;
    lastKey.current = fitKey;
    try {
      const b = L.latLngBounds(points);
      map.fitBounds(b, { padding: [48, 48], maxZoom: 14 });
    } catch {
      /* ignore */
    }
  }, [map, fitKey, points, disabled]);
  return null;
}

type Props = {
  apiBase?: string;
};

export function DashboardMap({ apiBase }: Props) {
  const [userSession] = useState(() => getPassengerLocationSession());
  const [nearbyBusesOnly, setNearbyBusesOnly] = useState(false);
  const [cfg, setCfg] = useState<MapConfig>(defaultConfig);
  const [basemap, setBasemap] = useState<PassengerBasemapMode>("dark");
  const [deployed, setDeployed] = useState<DeployedPointItem[]>([]);
  const [liveBuses, setLiveBuses] = useState<LiveBusPosition[]>([]);
  const [fleetById, setFleetById] = useState<Map<string, PublicFleetBus>>(new Map());
  const [dataError, setDataError] = useState<string | null>(null);
  const [operationsDeckLive, setOperationsDeckLive] = useState(true);

  const busIcon = useMemo(() => busDivIcon(), []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { operationsDeckLive: live } = await fetchPublicOperationsDeck();
        if (cancelled) return;
        setOperationsDeckLive(live);
        if (!live) {
          setLiveBuses([]);
          setFleetById(new Map());
        }
      } catch {
        if (!cancelled) setOperationsDeckLive(true);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const visibleBuses = useMemo(() => {
    if (!operationsDeckLive) return [];
    if (!nearbyBusesOnly || !userSession) return liveBuses;
    return liveBuses.filter((b) => {
      if (!Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) return false;
      return haversineKm(userSession.lat, userSession.lng, b.latitude, b.longitude) <= NEARBY_BUS_RADIUS_KM;
    });
  }, [nearbyBusesOnly, operationsDeckLive, userSession, liveBuses]);

  useEffect(() => {
    const base = (apiBase || import.meta.env.VITE_PASSENGER_API_URL || "http://localhost:4000").replace(/\/+$/, "");
    const ac = new AbortController();
    fetch(`${base}/api/passenger/map-config`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.center?.lat != null && data?.center?.lng != null) {
          setCfg({
            center: { lat: data.center.lat, lng: data.center.lng },
            zoom: typeof data.zoom === "number" ? data.zoom : defaultConfig.zoom,
            label: String(data.label || defaultConfig.label),
            tileUrl: String(data.tileUrl || defaultConfig.tileUrl),
            attribution: String(data.attribution || defaultConfig.attribution),
          });
        }
      })
      .catch(() => {});
    return () => ac.abort();
  }, [apiBase]);

  const loadStaticPoints = useCallback(() => {
    fetchDeployedPoints()
      .then(setDeployed)
      .catch((e) => setDataError(e instanceof Error ? e.message : "Could not load stops"));
  }, []);

  const loadFleet = useCallback(() => {
    fetchPublicFleetBuses()
      .then((rows) => setFleetById(new Map(rows.map((b) => [b.busId, b]))))
      .catch(() => {});
  }, []);

  const loadLive = useCallback(() => {
    fetchLiveBusPositions()
      .then(setLiveBuses)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStaticPoints();
    loadFleet();
    loadLive();
    const t1 = window.setInterval(loadStaticPoints, 90_000);
    const t2 = window.setInterval(loadLive, 18_000);
    const t3 = window.setInterval(loadFleet, 120_000);
    return () => {
      window.clearInterval(t1);
      window.clearInterval(t2);
      window.clearInterval(t3);
    };
  }, [loadStaticPoints, loadFleet, loadLive]);

  const mapCenter: [number, number] = userSession
    ? [userSession.lat, userSession.lng]
    : [cfg.center.lat, cfg.center.lng];
  const mapZoom = userSession ? 15 : cfg.zoom;
  const tile = passengerTileLayer(basemap);

  const fitPoints = useMemo(() => {
    const pts: [number, number][] = [];
    for (const row of deployed) {
      if (row.terminal && Number.isFinite(row.terminal.latitude) && Number.isFinite(row.terminal.longitude)) {
        pts.push([row.terminal.latitude, row.terminal.longitude]);
      }
      if (row.locationPoint && Number.isFinite(row.locationPoint.latitude) && Number.isFinite(row.locationPoint.longitude)) {
        pts.push([row.locationPoint.latitude, row.locationPoint.longitude]);
      }
      for (const s of row.stops) {
        if (Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) {
          pts.push([s.latitude, s.longitude]);
        }
      }
    }
    for (const b of liveBuses) {
      if (Number.isFinite(b.latitude) && Number.isFinite(b.longitude)) {
        pts.push([b.latitude, b.longitude]);
      }
    }
    return pts;
  }, [deployed, liveBuses]);

  const fitKey = useMemo(() => {
    if (fitPoints.length === 0) return "";
    const dep = deployed
      .map((d) => d.id)
      .sort()
      .join(",");
    const buses = liveBuses
      .map((b) => b.busId)
      .sort()
      .join(",");
    return `${dep}|${buses}`;
  }, [deployed, liveBuses, fitPoints.length]);

  const photoBasemap = basemap === "satellite" || basemap === "terrain";

  const skipAutoFit = Boolean(userSession);

  return (
    <div className="dashboard-map">
      <div className="dashboard-map__chrome">
        <div className="dashboard-map__chrome-main">
          <h2 className="dashboard-map__title">Live network map</h2>
          <p className="dashboard-map__sub">
            {cfg.label}
            {dataError ? ` · ${dataError}` : ""}
          </p>
          {!operationsDeckLive ? (
            <p className="dashboard-map__deck-offline" role="status">
              Operations deck is <strong>OFFLINE</strong> — live buses are hidden until operations goes LIVE again.
            </p>
          ) : null}
          {userSession ? (
            <p className="dashboard-map__near-you" role="status">
              <span className="dashboard-map__near-you-dot" aria-hidden />
              You are{" "}
              <strong>{formatDistanceToTerminal(userSession.distanceKm)}</strong> from{" "}
              <strong>{userSession.nearestLabel}</strong>
            </p>
          ) : null}
        </div>
        {userSession ? (
          <div className="dashboard-map__chrome-actions">
            <button
              type="button"
              className={
                "dashboard-map__nearby-btn" + (nearbyBusesOnly ? " dashboard-map__nearby-btn--active" : "")
              }
              onClick={() => setNearbyBusesOnly((v) => !v)}
            >
              {nearbyBusesOnly ? "Show all buses" : "Show nearby buses"}
            </button>
          </div>
        ) : null}
      </div>
      <div className="dashboard-map__frame">
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          className={
            "dashboard-map__leaflet" + (photoBasemap ? " dashboard-map__leaflet--photo" : "")
          }
          scrollWheelZoom
        >
          {userSession ? <EnsureUserMapView lat={userSession.lat} lng={userSession.lng} zoom={15} /> : null}
          <RecenterWhenConfigChanges
            center={mapCenter}
            zoom={mapZoom}
            block={Boolean(userSession) || fitPoints.length > 0}
          />
          <AutoFitOnce fitKey={fitKey} points={fitPoints} disabled={skipAutoFit} />
          <TileLayer key={basemap} url={tile.url} attribution={tile.attribution} />

          {userSession ? (
            <Marker position={[userSession.lat, userSession.lng]} icon={USER_LOCATION_ICON}>
              <Popup>
                <strong>Your location</strong>
                <div className="dashboard-map__popup-muted">Approximate position from your device</div>
              </Popup>
            </Marker>
          ) : null}

          {deployed.flatMap((row) => {
            const nodes: React.ReactElement[] = [];
            const t = row.terminal;
            if (t && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) {
              const r = Math.min(20_000, Math.max(200, Number(t.geofenceRadiusM) || 500));
              nodes.push(
                <Circle
                  key={`${row.id}-geo`}
                  center={[t.latitude, t.longitude]}
                  radius={r}
                  pathOptions={{ color: "#10b981", fillColor: "#34d399", fillOpacity: 0.08, weight: 2 }}
                />
              );
              nodes.push(
                <Marker key={`${row.id}-term`} position={[t.latitude, t.longitude]} icon={LEAFLET_TERMINAL_ICON}>
                  <Popup>
                    <strong>Terminal</strong>
                    <div>{t.name}</div>
                    <div className="dashboard-map__popup-muted">{row.locationName}</div>
                  </Popup>
                </Marker>
              );
            }
            const lp = row.locationPoint;
            if (lp && Number.isFinite(lp.latitude) && Number.isFinite(lp.longitude)) {
              nodes.push(
                <Marker key={`${row.id}-way`} position={[lp.latitude, lp.longitude]} icon={LEAFLET_WAYPOINT_ICON}>
                  <Popup>
                    <strong>Location (corridor)</strong>
                    <div>{lp.name}</div>
                    <div className="dashboard-map__popup-muted">{row.locationName}</div>
                  </Popup>
                </Marker>
              );
            }
            for (const s of row.stops) {
              if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
              nodes.push(
                <Marker
                  key={`${row.id}-stop-${s.sequence}`}
                  position={[s.latitude, s.longitude]}
                  icon={LEAFLET_STOP_ICON}
                >
                  <Popup>
                    <strong>Bus stop</strong>
                    <div>{s.name}</div>
                    <div className="dashboard-map__popup-muted">{row.locationName}</div>
                  </Popup>
                </Marker>
              );
            }
            return nodes;
          })}

          {visibleBuses.map((b) => {
            if (!Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) return null;
            const reg = fleetById.get(b.busId);
            const label = reg?.busNumber?.trim() || b.busId;
            const route = reg?.route?.trim() || "—";
            return (
              <Marker key={`bus-${b.busId}`} position={[b.latitude, b.longitude]} icon={busIcon}>
                <Popup>
                  <strong>Bus {label}</strong>
                  <div>Route: {route}</div>
                  {b.nextTerminal ? <div>Next: {b.nextTerminal}</div> : null}
                  {b.etaMinutes != null && Number.isFinite(b.etaMinutes) ? (
                    <div>ETA ~{Math.round(b.etaMinutes)} min</div>
                  ) : null}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        <PassengerMapBasemapDock
          basemap={basemap}
          onBasemapChange={setBasemap}
          activeBuses={visibleBuses.length}
          regionLabel="network"
        />
      </div>
    </div>
  );
}
