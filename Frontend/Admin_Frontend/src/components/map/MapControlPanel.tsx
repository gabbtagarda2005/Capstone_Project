import type { ReactNode } from "react";
import "./MapControlPanel.css";

export type MapLayerKey = "geofence" | "traffic" | "heatmap" | "delays";

export type MapLayerState = Record<MapLayerKey, boolean>;

type Props = {
  layers: MapLayerState;
  onToggle: (key: MapLayerKey, next: boolean) => void;
  activeBuses: number;
  regionLabel?: string;
};

function IconLayers() {
  return (
    <svg className="map-control-panel__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg className="map-control-panel__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg className="map-control-panel__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconZap() {
  return (
    <svg className="map-control-panel__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

type RowProps = {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  accent: "emerald" | "amber" | "cyan" | "violet";
};

function LayerToggleRow({ icon, label, active, onClick, accent }: RowProps) {
  return (
    <button type="button" className={`map-control-panel__row ${active ? "map-control-panel__row--active" : ""}`} onClick={onClick}>
      <span className={`map-control-panel__row-left map-control-panel__accent--${accent} ${active ? "map-control-panel__accent--on" : ""}`}>
        {icon}
      </span>
      <span className={`map-control-panel__row-label ${active ? "map-control-panel__row-label--active" : ""}`}>{label}</span>
      <span className={`map-control-panel__dot map-control-panel__accent--${accent} ${active ? "map-control-panel__dot--pulse" : ""}`} />
    </button>
  );
}

export function MapControlPanel({ layers, onToggle, activeBuses, regionLabel = "Bukidnon" }: Props) {
  return (
    <div className="map-control-panel">
      <div className="map-control-panel__glass">
        <div className="map-control-panel__head">
          <IconLayers />
          <span className="map-control-panel__head-text">Map layers</span>
        </div>
        <div className="map-control-panel__rows">
          <LayerToggleRow
            icon={<IconShield />}
            label="Geofence zones"
            active={layers.geofence}
            onClick={() => onToggle("geofence", !layers.geofence)}
            accent="emerald"
          />
          <LayerToggleRow
            icon={<IconActivity />}
            label="Live traffic (sim)"
            active={layers.traffic}
            onClick={() => onToggle("traffic", !layers.traffic)}
            accent="amber"
          />
          <LayerToggleRow
            icon={<IconZap />}
            label="Passenger heat"
            active={layers.heatmap}
            onClick={() => onToggle("heatmap", !layers.heatmap)}
            accent="cyan"
          />
          <LayerToggleRow
            icon={
              <svg className="map-control-panel__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            }
            label="Delay risk (weather)"
            active={layers.delays}
            onClick={() => onToggle("delays", !layers.delays)}
            accent="violet"
          />
        </div>
      </div>
      <div className="map-control-panel__stat">
        <p className="map-control-panel__stat-label">Active buses</p>
        <p className="map-control-panel__stat-value">
          {activeBuses} <span className="map-control-panel__stat-suffix">/ {regionLabel}</span>
        </p>
      </div>
      <p className="map-control-panel__note">Leaflet view — true 45° 3D tilt uses MapLibre GL in a future build.</p>
    </div>
  );
}
