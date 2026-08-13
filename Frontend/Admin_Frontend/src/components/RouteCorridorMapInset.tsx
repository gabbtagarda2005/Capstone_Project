import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { BusLiveLogRow, CorridorHubPin } from "@/lib/types";
import "./RouteCorridorMapInset.css";

const BUKIDNON: [number, number] = [8.0515, 125.0];

const ORIGIN_PIN_ICON = L.divIcon({
  className: "rte-corridor-map__marker-endpoint",
  html: '<div class="rte-corridor-map__endpoint rte-corridor-map__endpoint--origin"><span>A</span></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

const DESTINATION_PIN_ICON = L.divIcon({
  className: "rte-corridor-map__marker-endpoint",
  html: '<div class="rte-corridor-map__endpoint rte-corridor-map__endpoint--destination"><span>B</span></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

type Props = {
  corridorLine: [number, number][];
  /** Origin / via / destination terminal pins when there is no detailed stop polyline. */
  hubPins?: CorridorHubPin[];
  liveBuses: BusLiveLogRow[];
};

const VIA_MARKER_STYLE = { color: "#fcd34d", fillColor: "#fbbf24", weight: 2, fillOpacity: 0.95 };

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0]!, 12);
      return;
    }
    const b = L.latLngBounds(points);
    if (!b.isValid()) return;
    map.fitBounds(b, { padding: [32, 32], maxZoom: 12 });
  }, [map, points]);
  return null;
}

export function RouteCorridorMapInset({ corridorLine, hubPins = [], liveBuses }: Props) {
  const useStopLine = corridorLine.length >= 2;

  const hubLine = useMemo(() => {
    return hubPins
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => [p.latitude, p.longitude] as [number, number]);
  }, [hubPins]);

  const linePositions = useStopLine ? corridorLine : hubLine.length >= 2 ? hubLine : [];

  const fitPoints = useMemo(() => {
    const pts: [number, number][] = [];
    if (linePositions.length > 0) {
      for (const p of linePositions) pts.push(p);
    } else {
      for (const p of hubLine) pts.push(p);
    }
    for (const b of liveBuses) {
      if (Number.isFinite(b.latitude) && Number.isFinite(b.longitude)) {
        pts.push([b.latitude, b.longitude]);
      }
    }
    return pts;
  }, [linePositions, hubLine, liveBuses]);

  const center = useMemo(() => {
    if (fitPoints.length >= 1) {
      return fitPoints[Math.floor(fitPoints.length / 2)]!;
    }
    return BUKIDNON;
  }, [fitPoints]);

  const zoom = fitPoints.length >= 2 ? 11 : fitPoints.length === 1 ? 12 : 9;

  const chromeHint = useStopLine
    ? "Stop polyline · route line + terminals"
    : hubLine.length >= 2
      ? "Terminal hubs · route line + terminals"
      : hubLine.length === 1
        ? "Terminal hub"
        : liveBuses.length > 0
          ? "Live units"
          : "No coordinates";

  const showViaMarkers = !useStopLine && hubPins.length > 0;
  const originPin = hubPins.find((p) => p.kind === "origin" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  const destinationPin = hubPins.find(
    (p) => p.kind === "destination" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );

  return (
    <div className="rte-corridor-map">
      <div className="rte-corridor-map__chrome">
        <span className="rte-corridor-map__tag">CORRIDOR VISUALIZATION</span>
        <span className="rte-corridor-map__hint">{chromeHint}</span>
      </div>
      <div className="rte-corridor-map__frame">
        <MapContainer
          center={center}
          zoom={zoom}
          className="rte-corridor-map__leaflet"
          zoomControl={false}
          attributionControl={false}
        >
          {fitPoints.length > 0 ? <FitBounds points={fitPoints} /> : null}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
          />
          {linePositions.length >= 2 ? (
            <Polyline
              positions={linePositions}
              pathOptions={{
                color: "#2563eb",
                weight: 4,
                opacity: 0.92,
                lineCap: "round",
                lineJoin: "round",
                dashArray: useStopLine ? "14 12" : "10 10",
                className: "rte-corridor-map__route-line",
              }}
            />
          ) : null}
          {showViaMarkers
            ? hubPins
                .filter((p) => p.kind === "via")
                .map((p, i) => {
                  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
                  return (
                    <CircleMarker
                      key={`hub-via-${i}-${p.label}`}
                      center={[p.latitude, p.longitude]}
                      radius={8}
                      pathOptions={{
                        ...VIA_MARKER_STYLE,
                        className: "rte-corridor-map__hub rte-corridor-map__hub--via",
                      }}
                    >
                      <Popup>
                        <strong>Via</strong>
                        <br />
                        {p.label}
                      </Popup>
                    </CircleMarker>
                  );
                })
            : null}
          {originPin ? (
            <Marker position={[originPin.latitude, originPin.longitude]} icon={ORIGIN_PIN_ICON}>
              <Popup>
                <strong>Start</strong>
                <br />
                {originPin.label}
              </Popup>
            </Marker>
          ) : null}
          {destinationPin ? (
            <Marker position={[destinationPin.latitude, destinationPin.longitude]} icon={DESTINATION_PIN_ICON}>
              <Popup>
                <strong>End</strong>
                <br />
                {destinationPin.label}
              </Popup>
            </Marker>
          ) : null}
          {liveBuses.map((b) =>
            Number.isFinite(b.latitude) && Number.isFinite(b.longitude) ? (
              <CircleMarker
                key={b.busId}
                center={[b.latitude, b.longitude]}
                radius={9}
                pathOptions={{
                  color: "#67e8f9",
                  weight: 2,
                  fillColor: "#22d3ee",
                  fillOpacity: 0.9,
                  className: "rte-corridor-map__bus-dot",
                }}
              />
            ) : null
          )}
        </MapContainer>
      </div>
    </div>
  );
}
