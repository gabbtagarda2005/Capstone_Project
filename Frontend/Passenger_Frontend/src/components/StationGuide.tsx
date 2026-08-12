import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BUKIDNON_STATIONS, type BukidnonStation } from "@/lib/bukidnonStations";
import { haversineKm } from "@/lib/passengerGeo";
import "./StationGuide.css";

type Position = { lat: number; lng: number };

type StationGuideProps = {
  stationList?: BukidnonStation[];
};

const DEFAULT_CENTER: Position = { lat: 8.1477, lng: 125.1324 };
const WALKING_METERS_PER_MINUTE = 80;
const ARRIVAL_THRESHOLD_METERS = 80;

const USER_ICON = L.divIcon({
  className: "station-guide__marker station-guide__marker--user",
  html: '<div class="station-guide__marker-core" aria-hidden="true"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const STATION_ICON = L.divIcon({
  className: "station-guide__marker station-guide__marker--station",
  html: '<div class="station-guide__marker-terminal" aria-hidden="true"></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function formatDistance(distanceKm: number) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return "—";
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

function formatWalkingEta(distanceKm: number) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return "—";
  const meters = distanceKm * 1000;
  const minutes = Math.max(1, Math.round(meters / WALKING_METERS_PER_MINUTE));
  return `${minutes} min walk`;
}

function buildGoogleMapsUrl(origin: Position, destination: Position) {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=walking`;
}

function UserMapRecenter({ position }: { position: Position | null }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;
    map.setView([position.lat, position.lng], 14, { animate: true });
  }, [map, position]);

  return null;
}

function findNearestStation(position: Position, stations: BukidnonStation[]) {
  let nearest: BukidnonStation | null = null;
  let nearestKm = Infinity;
  for (const station of stations) {
    const km = haversineKm(position.lat, position.lng, station.latitude, station.longitude);
    if (km < nearestKm) {
      nearestKm = km;
      nearest = station;
    }
  }
  return nearest;
}

export function StationGuide({ stationList = BUKIDNON_STATIONS }: StationGuideProps) {
  const [position, setPosition] = useState<Position | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [hasManualSelection, setHasManualSelection] = useState(false);
  const [arrived, setArrived] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGeoError("Geolocation is not supported by this browser.");
      return undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoError(null);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGeoError("Location permission denied. Allow location access to see nearby terminals.");
        } else {
          setGeoError("Unable to read your current location. Try again or check device settings.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    watchIdRef.current = watchId;
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const nearestStation = useMemo(() => {
    if (!position) return null;
    return findNearestStation(position, stationList);
  }, [position, stationList]);

  useEffect(() => {
    if (nearestStation && !hasManualSelection) {
      setSelectedStationId(nearestStation.id);
    }
  }, [nearestStation, hasManualSelection]);

  const selectedStation = useMemo(() => {
    if (!nearestStation) return null;
    const selected = stationList.find((station) => station.id === selectedStationId);
    return selected ?? nearestStation;
  }, [nearestStation, selectedStationId, stationList]);

  const distanceKm = useMemo(() => {
    if (!position || !selectedStation) return NaN;
    return haversineKm(position.lat, position.lng, selectedStation.latitude, selectedStation.longitude);
  }, [position, selectedStation]);

  const distanceLabel = formatDistance(distanceKm);
  const etaLabel = formatWalkingEta(distanceKm);

  useEffect(() => {
    const meters = distanceKm * 1000;
    const isClose = Number.isFinite(meters) && meters <= ARRIVAL_THRESHOLD_METERS;
    setArrived(isClose);
  }, [distanceKm]);

  const routePoints: [number, number][] = useMemo(() => {
    if (!position || !selectedStation) return [];
    return [
      [position.lat, position.lng],
      [selectedStation.latitude, selectedStation.longitude],
    ];
  }, [position, selectedStation]);

  const activeOrigin = position ?? DEFAULT_CENTER;
  const activeDestination = selectedStation
    ? { lat: selectedStation.latitude, lng: selectedStation.longitude }
    : DEFAULT_CENTER;

  return (
    <section className="station-guide">
      <div className="station-guide__header">
        <div>
          <p className="station-guide__eyebrow">Station guide</p>
          <h2 className="station-guide__title">Find your nearest Bukidnon bus terminal</h2>
          <p className="station-guide__subtitle">
            Live GPS tracking finds the closest station and gives you walking directions to the terminal entrance.
          </p>
        </div>
      </div>

      <div className="station-guide__grid">
        <div className="station-guide__panel station-guide__panel--controls">
          <div className="station-guide__status">
            <span className="station-guide__status-label">Live position</span>
            <span className="station-guide__status-value">
              {position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : "Waiting for GPS…"}
            </span>
          </div>

          {geoError ? <div className="station-guide__alert">{geoError}</div> : null}

          <label className="station-guide__select-label" htmlFor="station-guide-select">
            Choose a station or follow the nearest suggestion
          </label>
          <select
            id="station-guide-select"
            className="station-guide__select"
            value={selectedStation?.id ?? ""}
            onChange={(event) => {
              setSelectedStationId(event.target.value);
              setHasManualSelection(true);
            }}
          >
            {stationList.map((station) => (
              <option key={station.id} value={station.id}>
                {station.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="station-guide__toggle"
            onClick={() => setHasManualSelection(false)}
            disabled={!nearestStation || !hasManualSelection}
          >
            Auto-select nearest station
          </button>

          <article className="station-guide__info-card">
            <div className="station-guide__info-title">Target station</div>
            <div className="station-guide__info-value">
              {selectedStation ? selectedStation.label : "No station selected"}
            </div>
            <div className="station-guide__info-meta">{selectedStation?.description}</div>
          </article>

          <article className="station-guide__info-card">
            <div className="station-guide__info-title">Distance</div>
            <div className="station-guide__info-value">{distanceLabel}</div>
            <div className="station-guide__info-meta">{etaLabel}</div>
          </article>

          <div className="station-guide__actions">
            <a
              className="station-guide__btn station-guide__btn--primary"
              href={buildGoogleMapsUrl(activeOrigin, activeDestination)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Guide Me
            </a>
            <button
              type="button"
              className="station-guide__btn station-guide__btn--secondary"
              onClick={() => {
                if (selectedStation) {
                  window.open(buildGoogleMapsUrl(activeOrigin, activeDestination), "_blank");
                }
              }}
              disabled={!selectedStation || !position}
            >
              Open walking directions
            </button>
          </div>

          {arrived && selectedStation ? (
            <div className="station-guide__notification" role="status">
              You have arrived near {selectedStation.label}. Check the station entrance for boarding.
            </div>
          ) : null}
        </div>

        <div className="station-guide__panel station-guide__panel--map">
          <MapContainer
            center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
            zoom={12}
            scrollWheelZoom={false}
            className="station-guide__map"
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            {position ? <UserMapRecenter position={position} /> : null}
            {position ? (
              <Marker position={[position.lat, position.lng]} icon={USER_ICON}>
                <></>
              </Marker>
            ) : null}
            {selectedStation ? (
              <Marker position={[selectedStation.latitude, selectedStation.longitude]} icon={STATION_ICON}>
                <></>
              </Marker>
            ) : null}
            {routePoints.length === 2 ? (
              <Polyline
                pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.75 }}
                positions={routePoints}
              />
            ) : null}
          </MapContainer>
          <div className="station-guide__map-hint">
            Live route preview. Tap Guide Me to open step-by-step walking directions in Google Maps.
          </div>
        </div>
      </div>
    </section>
  );
}
