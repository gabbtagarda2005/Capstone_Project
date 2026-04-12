import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/api";
import type { BusLiveLogRow } from "@/lib/types";
import "./AttendantDossierMap.css";

const BUKIDNON: [number, number] = [8.0515, 125.0];

type Props = {
  busId: string | null;
  /** Fallback when no live fix yet */
  hintLatLng: [number, number] | null;
  corridorLine: [number, number][];
  /** Default: LIVE TELEMETRY */
  chromeTag?: string;
  /** Default: Unit … / No assigned unit */
  chromeHint?: string;
};

export function AttendantDossierMap({
  busId,
  hintLatLng,
  corridorLine,
  chromeTag = "LIVE TELEMETRY",
  chromeHint,
}: Props) {
  const [live, setLive] = useState<BusLiveLogRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await api<{ items: BusLiveLogRow[] }>("/api/buses/live");
        if (!cancelled) setLive(res.items ?? []);
      } catch {
        if (!cancelled) setLive([]);
      }
    };
    void pull();
    const t = window.setInterval(() => void pull(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const busPos = useMemo(() => {
    if (!busId) return null;
    const row = live.find((x) => x.busId === busId);
    if (!row || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return null;
    return [row.latitude, row.longitude] as [number, number];
  }, [busId, live]);

  const center = busPos ?? hintLatLng ?? BUKIDNON;
  const zoom = busPos || hintLatLng ? 12 : 10;

  const routeLine = useMemo(() => {
    if (corridorLine.length >= 2) return corridorLine;
    if (busPos) {
      return [busPos, [busPos[0] + 0.018, busPos[1] + 0.022]] as [number, number][];
    }
    return [] as [number, number][];
  }, [busPos, corridorLine]);

  return (
    <div className="att-dossier-map">
      <div className="att-dossier-map__chrome">
        <span className="att-dossier-map__tag">{chromeTag}</span>
        <span className="att-dossier-map__hint">{chromeHint ?? (busId ? `Unit ${busId}` : "No assigned unit")}</span>
      </div>
      <div className="att-dossier-map__frame">
        <MapContainer center={center} zoom={zoom} className="att-dossier-map__leaflet" zoomControl={false} attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" subdomains="abcd" maxZoom={20} />
          {routeLine.length >= 2 ? (
            <Polyline
              positions={routeLine}
              pathOptions={{
                color: "#22d3ee",
                weight: 3,
                opacity: 0.85,
                dashArray: "10 14",
                lineCap: "round",
                lineJoin: "round",
                className: "att-dossier-map__route-line",
              }}
            />
          ) : null}
          {busPos ? (
            <CircleMarker
              center={busPos}
              radius={11}
              pathOptions={{
                color: "#67e8f9",
                weight: 3,
                fillColor: "#22d3ee",
                fillOpacity: 0.95,
                className: "att-dossier-map__pulse-marker",
              }}
            />
          ) : hintLatLng ? (
            <CircleMarker
              center={hintLatLng}
              radius={8}
              pathOptions={{
                color: "rgba(148, 163, 184, 0.7)",
                weight: 2,
                fillColor: "rgba(71, 85, 105, 0.5)",
                fillOpacity: 0.6,
              }}
            />
          ) : null}
        </MapContainer>
      </div>
    </div>
  );
}
