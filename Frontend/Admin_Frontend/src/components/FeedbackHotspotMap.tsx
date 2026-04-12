import { useMemo } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./FeedbackHotspotMap.css";

const BUKIDNON: [number, number] = [8.05, 125.0];

type Hotspot = {
  routeName: string;
  negativeCount: number;
  latitude: number;
  longitude: number;
};

type Props = {
  hotspots: Hotspot[];
};

export function FeedbackHotspotMap({ hotspots }: Props) {
  const center = useMemo((): [number, number] => {
    if (hotspots.length === 0) return BUKIDNON;
    const lat = hotspots.reduce((s, h) => s + h.latitude, 0) / hotspots.length;
    const lng = hotspots.reduce((s, h) => s + h.longitude, 0) / hotspots.length;
    return [lat, lng];
  }, [hotspots]);

  const maxNeg = useMemo(() => Math.max(1, ...hotspots.map((h) => h.negativeCount)), [hotspots]);
  const zoom = hotspots.length ? 9 : 8;

  return (
    <div className="fb-hotspot-map" role="region" aria-label="Negative feedback route hotspots">
      <div className="fb-hotspot-map__chrome">
        <span className="fb-hotspot-map__tag">Route hotspots</span>
        <span className="fb-hotspot-map__hint">Negative signal density · Bukidnon</span>
      </div>
      <div className="fb-hotspot-map__frame">
        <MapContainer center={center} zoom={zoom} className="fb-hotspot-map__leaflet" zoomControl={false} attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" subdomains="abcd" maxZoom={20} />
          {hotspots.map((h) => {
            const t = h.negativeCount / maxNeg;
            const radius = 10 + t * 22;
            return (
              <CircleMarker
                key={`${h.routeName}-${h.latitude}-${h.longitude}`}
                center={[h.latitude, h.longitude]}
                radius={radius}
                pathOptions={{
                  color: "#E11D48",
                  weight: 2,
                  fillColor: "#E11D48",
                  fillOpacity: 0.22 + t * 0.35,
                  className: "fb-hotspot-map__pulse",
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
                  <span className="fb-hotspot-map__tip">
                    {h.routeName}: {h.negativeCount} critical
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
