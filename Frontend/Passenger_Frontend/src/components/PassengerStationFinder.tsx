import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchDeployedPoints, type DeployedPointItem } from "@/lib/fetchPassengerMapData";
import { rankDeployedTerminalsByDistance, type RankedTerminal } from "@/lib/passengerNearestTerminal";
import { haversineKm } from "@/lib/passengerGeo";
import { fetchWalkingRoute, straightLineFallback, type WalkingRoute } from "@/lib/fetchWalkingRoute";
import { usePassengerLiveLocation } from "@/lib/usePassengerLiveLocation";
import "./PassengerStationFinder.css";

type Mode = "list" | "navigating";

/** Same walking pace used across the app's other straight-line ETA estimates. */
const WALKING_METERS_PER_MINUTE = 80;
/** Re-request a route only after this much drift from where the last route started. */
const REROUTE_DEVIATION_METERS = 60;
/** Floor between OSRM calls — respects the public demo server's rate limits. */
const REROUTE_MIN_INTERVAL_MS = 12_000;
/** GPS accuracy worse than this triggers the low-accuracy banner. */
const POOR_ACCURACY_METERS = 50;

const PASSENGER_ICON = L.divIcon({
  className: "psf-marker psf-marker--passenger",
  html: '<div class="psf-marker__pulse" aria-hidden="true"></div><div class="psf-marker__core" aria-hidden="true"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const DESTINATION_ICON = L.divIcon({
  className: "psf-marker psf-marker--destination",
  html: '<div class="psf-marker__pin" aria-hidden="true"></div>',
  iconSize: [26, 34],
  iconAnchor: [13, 34],
});

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatWalkMinutes(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "—";
  const minutes = Math.max(1, Math.round(meters / WALKING_METERS_PER_MINUTE));
  return `~${minutes} min walk`;
}

function arrivalThresholdMeters(geofenceRadiusM: number): number {
  if (!Number.isFinite(geofenceRadiusM) || geofenceRadiusM <= 0) return 100;
  return Math.max(40, Math.min(geofenceRadiusM, 200));
}

function MapFitController({
  fitKey,
  passengerLat,
  passengerLng,
  destLat,
  destLng,
}: {
  fitKey: number;
  passengerLat: number | null;
  passengerLng: number | null;
  destLat: number;
  destLng: number;
}) {
  const map = useMap();
  const posRef = useRef({ passengerLat, passengerLng });
  useEffect(() => {
    posRef.current = { passengerLat, passengerLng };
  }, [passengerLat, passengerLng]);

  useEffect(() => {
    const { passengerLat: pLat, passengerLng: pLng } = posRef.current;
    if (pLat == null || pLng == null) {
      map.setView([destLat, destLng], 15, { animate: true });
      return;
    }
    try {
      const bounds = L.latLngBounds([
        [pLat, pLng],
        [destLat, destLng],
      ]);
      map.fitBounds(bounds, { padding: [56, 56], maxZoom: 17 });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, destLat, destLng]);

  return null;
}

export function PassengerStationFinder() {
  const [stations, setStations] = useState<DeployedPointItem[]>([]);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("list");
  const [selectedStation, setSelectedStation] = useState<RankedTerminal | null>(null);
  const [route, setRoute] = useState<WalkingRoute | null>(null);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [justArrivedLabel, setJustArrivedLabel] = useState<string | null>(null);
  const [recenterTick, setRecenterTick] = useState(0);

  const liveLocation = usePassengerLiveLocation(true);
  const lastRoutedFromRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRoutedAtRef = useRef(0);
  const routeRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchDeployedPoints()
        .then((rows) => {
          if (!cancelled) {
            setStations(rows);
            setStationsError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setStationsError(e instanceof Error ? e.message : "Could not load stations");
        });
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const rankedStations = useMemo(() => {
    if (!liveLocation.position) return [];
    return rankDeployedTerminalsByDistance(liveLocation.position.lat, liveLocation.position.lng, stations);
  }, [liveLocation.position, stations]);

  const nearestStation = rankedStations[0] ?? null;

  const filteredStations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rankedStations;
    return rankedStations.filter(
      (s) => s.name.toLowerCase().includes(q) || s.locationName.toLowerCase().includes(q)
    );
  }, [rankedStations, search]);

  function startNavigation(station: RankedTerminal) {
    setSelectedStation(station);
    setMode("navigating");
    setArrived(false);
    setJustArrivedLabel(null);
    setRoute(null);
    setRouteNotice(null);
    lastRoutedFromRef.current = null;
    lastRoutedAtRef.current = 0;
    setRecenterTick((t) => t + 1);
  }

  function cancelNavigation() {
    setMode("list");
    setSelectedStation(null);
    setRoute(null);
    setRouteNotice(null);
    setArrived(false);
  }

  function viewStationAfterArrival() {
    if (selectedStation) setJustArrivedLabel(selectedStation.name);
    cancelNavigation();
  }

  // Fetch (and periodically re-fetch, on material drift) the walking route while navigating.
  useEffect(() => {
    if (mode !== "navigating" || !selectedStation || !liveLocation.position) return;
    const pos = liveLocation.position;
    const from = lastRoutedFromRef.current;
    const elapsedMs = Date.now() - lastRoutedAtRef.current;
    const driftedFar = !from || haversineKm(from.lat, from.lng, pos.lat, pos.lng) * 1000 > REROUTE_DEVIATION_METERS;
    if (from && (!driftedFar || elapsedMs < REROUTE_MIN_INTERVAL_MS)) return;

    const requestId = ++routeRequestIdRef.current;
    const origin = { lat: pos.lat, lng: pos.lng };
    const destination = { lat: selectedStation.latitude, lng: selectedStation.longitude };
    lastRoutedFromRef.current = origin;
    lastRoutedAtRef.current = Date.now();
    setRouteLoading(true);

    fetchWalkingRoute(origin, destination)
      .then((r) => {
        if (routeRequestIdRef.current !== requestId) return;
        setRoute(r);
        setRouteNotice(null);
      })
      .catch(() => {
        if (routeRequestIdRef.current !== requestId) return;
        const distanceMeters = haversineKm(origin.lat, origin.lng, destination.lat, destination.lng) * 1000;
        setRoute(straightLineFallback(origin, destination, distanceMeters));
        setRouteNotice("Live route unavailable — showing a straight-line estimate.");
      })
      .finally(() => {
        if (routeRequestIdRef.current === requestId) setRouteLoading(false);
      });
  }, [mode, selectedStation, liveLocation.position]);

  // Arrival detection — independent of the route fetch, purely distance-based.
  useEffect(() => {
    if (mode !== "navigating" || !selectedStation || !liveLocation.position) return;
    const meters =
      haversineKm(
        liveLocation.position.lat,
        liveLocation.position.lng,
        selectedStation.latitude,
        selectedStation.longitude
      ) * 1000;
    setArrived(meters <= arrivalThresholdMeters(selectedStation.geofenceRadiusM));
  }, [mode, selectedStation, liveLocation.position]);

  const showPermissionState =
    liveLocation.status === "denied" ||
    liveLocation.status === "unavailable" ||
    liveLocation.status === "timeout" ||
    liveLocation.status === "error";

  const poorAccuracy =
    liveLocation.position != null &&
    Number.isFinite(liveLocation.position.accuracyM) &&
    liveLocation.position.accuracyM > POOR_ACCURACY_METERS;

  if (mode === "navigating" && selectedStation) {
    const distanceMeters = route?.distanceMeters ?? 0;
    const etaLabel = route
      ? `~${Math.max(1, Math.round(route.durationSeconds / 60))} min walk`
      : formatWalkMinutes(selectedStation.distanceKm * 1000);

    return (
      <section className="pd-spa-card pd-spa-card--stack-shell psf" aria-label="Navigating to bus station">
        <header className="psf__nav-head">
          <p className="psf__nav-eyebrow">Navigating to</p>
          <h2 className="psf__nav-title">{selectedStation.name}</h2>
          <div className="psf__nav-metrics">
            <span className="psf__nav-metric-value">{formatDistance(distanceMeters || selectedStation.distanceKm * 1000)}</span>
            <span className="psf__nav-metric-sep">·</span>
            <span>{etaLabel}</span>
          </div>
        </header>

        {poorAccuracy ? (
          <div className="psf__banner psf__banner--warn" role="status">
            🟡 GPS accuracy is low. Move to an open area for a more accurate location.
          </div>
        ) : null}
        {routeNotice ? (
          <div className="psf__banner psf__banner--info" role="status">
            {routeNotice}
          </div>
        ) : null}
        {showPermissionState ? (
          <div className="psf__banner psf__banner--error" role="alert">
            <span>{liveLocation.error}</span>
            <button type="button" className="psf__btn psf__btn--ghost" onClick={liveLocation.retry}>
              Try Again
            </button>
          </div>
        ) : null}

        {arrived ? (
          <div className="psf__arrived" role="status">
            <span>🎉 You have arrived!</span>
            <button type="button" className="psf__btn psf__btn--primary" onClick={viewStationAfterArrival}>
              View Station
            </button>
          </div>
        ) : null}

        <div className="psf__map-wrap">
          <MapContainer center={[selectedStation.latitude, selectedStation.longitude]} zoom={15} className="psf__map" scrollWheelZoom>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <MapFitController
              fitKey={recenterTick}
              passengerLat={liveLocation.position?.lat ?? null}
              passengerLng={liveLocation.position?.lng ?? null}
              destLat={selectedStation.latitude}
              destLng={selectedStation.longitude}
            />
            {liveLocation.position ? (
              <Marker position={[liveLocation.position.lat, liveLocation.position.lng]} icon={PASSENGER_ICON} />
            ) : null}
            <Marker position={[selectedStation.latitude, selectedStation.longitude]} icon={DESTINATION_ICON} />
            {route && route.positions.length > 1 ? (
              <Polyline
                positions={route.positions}
                pathOptions={
                  route.approximate
                    ? { color: "#94a3b8", weight: 4, opacity: 0.75, dashArray: "6 8" }
                    : { color: "#38bdf8", weight: 5, opacity: 0.85 }
                }
              />
            ) : null}
          </MapContainer>
          {routeLoading ? <div className="psf__map-loading">Updating route…</div> : null}
        </div>

        <div className="psf__actions">
          <button type="button" className="psf__btn psf__btn--ghost" onClick={() => setRecenterTick((t) => t + 1)}>
            Recenter
          </button>
          <button type="button" className="psf__btn psf__btn--danger" onClick={cancelNavigation}>
            Cancel Navigation
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="pd-spa-card pd-spa-card--stack-shell psf" aria-label="Find a bus station">
      <header className="psf__head">
        <h2>Find a Bus Station</h2>
        <p>Walking directions to the nearest registered terminal.</p>
      </header>

      {justArrivedLabel ? (
        <div className="psf__banner psf__banner--success" role="status">
          🎉 Arrived at {justArrivedLabel}.
        </div>
      ) : null}

      {showPermissionState ? (
        <div className="psf__banner psf__banner--error" role="alert">
          <span>{liveLocation.error}</span>
          <button type="button" className="psf__btn psf__btn--ghost" onClick={liveLocation.retry}>
            Try Again
          </button>
        </div>
      ) : null}

      {!showPermissionState && !liveLocation.position ? (
        <div className="psf__banner psf__banner--info" role="status">
          Getting your location…
        </div>
      ) : null}

      {poorAccuracy ? (
        <div className="psf__banner psf__banner--warn" role="status">
          🟡 GPS accuracy is low. Move to an open area for a more accurate location.
        </div>
      ) : null}

      {stationsError ? (
        <div className="psf__banner psf__banner--error" role="alert">
          {stationsError}
        </div>
      ) : null}

      <div className="psf__search">
        <span className="psf__search-icon" aria-hidden>
          🔎
        </span>
        <input
          type="search"
          className="psf__search-input"
          placeholder="Search bus station or terminal"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {nearestStation ? (
        <button
          type="button"
          className="psf__nearest-btn"
          onClick={() => startNavigation(nearestStation)}
        >
          <span className="psf__nearest-btn-icon" aria-hidden>
            📍
          </span>
          <span>
            Use Nearest Station — <strong>{nearestStation.name}</strong>
          </span>
        </button>
      ) : null}

      <div className="psf__list" role="list" aria-label="Nearby bus stations">
        {liveLocation.position && filteredStations.length === 0 ? (
          <p className="psf__empty">No nearby bus stations found.</p>
        ) : null}
        {filteredStations.map((s) => (
          <article key={s.coverageId} className="psf__station" role="listitem">
            <div className="psf__station-main">
              <span className="psf__station-icon" aria-hidden>
                📍
              </span>
              <div>
                <div className="psf__station-name">{s.name}</div>
                <div className="psf__station-meta">
                  {formatDistance(s.distanceKm * 1000)} · {formatWalkMinutes(s.distanceKm * 1000)}
                </div>
              </div>
            </div>
            <button type="button" className="psf__btn psf__btn--primary" onClick={() => startNavigation(s)}>
              Navigate
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
