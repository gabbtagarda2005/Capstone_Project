import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./MapControlPanel.css";

export type MapLayerKey = "geofence" | "traffic" | "heatmap" | "delays" | "buses";

export type MapLayerState = Record<MapLayerKey, boolean>;

/** Base map style (mutually exclusive). */
export type BasemapMode = "dark" | "roadmap" | "satellite" | "terrain";

type Props = {
  basemap: BasemapMode;
  onBasemapChange: (mode: BasemapMode) => void;
  layers: MapLayerState;
  onToggle: (key: MapLayerKey, next: boolean) => void;
  activeBuses: number;
  regionLabel?: string;
};

function IconShield() {
  return (
    <svg className="map-dock__chip-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconTraffic() {
  return (
    <svg className="map-dock__chip-svg" viewBox="0 0 24 24" aria-hidden>
      <path fill="#94a3b8" d="M4 18h16v2H4v-2zm2-2h12l1-8H5l1 8zm3-3v-2h4v2H9z" />
      <path fill="#22c55e" d="M6 10h3v2H6v-2z" />
      <path fill="#eab308" d="M10.5 10h3v2h-3v-2z" />
      <path fill="#ef4444" d="M15 10h3v2h-3v-2z" />
    </svg>
  );
}

function IconHeat() {
  return (
    <svg className="map-dock__chip-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="map-dock__chip-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconBus() {
  return (
    <svg className="map-dock__chip-svg" viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="10" width="16" height="8" rx="1" fill="#0ea5e9" />
      <rect x="5" y="11" width="10" height="4" rx="0.5" fill="#e0f2fe" />
      <circle cx="7.5" cy="19" r="1.5" fill="#1e293b" />
      <circle cx="16.5" cy="19" r="1.5" fill="#1e293b" />
      <rect x="15" y="12" width="3" height="2" rx="0.3" fill="#38bdf8" />
    </svg>
  );
}

function IconLayersMore() {
  return (
    <svg className="map-dock__chip-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

type ChipProps = {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  live?: boolean;
};

function LayerChip({ icon, label, active, onClick, live = false }: ChipProps) {
  return (
    <button
      type="button"
      className={"map-dock__chip" + (active ? " map-dock__chip--active" : "") + (active && live ? " map-dock__chip--live" : "")}
      onClick={onClick}
    >
      <span className="map-dock__chip-icon">{icon}</span>
      <span className="map-dock__chip-label">{label}</span>
    </button>
  );
}

type BaseThumbProps = {
  mode: BasemapMode;
  label: string;
  current: BasemapMode;
  thumbClass: string;
  onSelect: (m: BasemapMode) => void;
};

function BasemapThumb({ mode, label, current, thumbClass, onSelect }: BaseThumbProps) {
  const active = current === mode;
  return (
    <button
      type="button"
      className={"map-dock__basemap-mini" + (active ? " map-dock__basemap-mini--active" : "")}
      onClick={() => onSelect(mode)}
      aria-pressed={active}
      aria-label={`${label} map`}
    >
      <span className={"map-dock__basemap-mini-thumb " + thumbClass} aria-hidden />
      <span className="map-dock__basemap-mini-caption">{label}</span>
    </button>
  );
}

export function MapControlPanel({
  basemap,
  onBasemapChange,
  layers,
  onToggle,
  activeBuses,
  regionLabel = "Bukidnon",
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreFixedPos, setMoreFixedPos] = useState<{ top: number; left: number } | null>(null);
  const morePanelId = useId().replace(/:/g, "");
  const railShellRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  const updateMorePanelPosition = useCallback(() => {
    const btn = moreBtnRef.current;
    const panel = morePanelRef.current;
    if (!btn) return;
    const br = btn.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = Math.max(panel?.offsetWidth ?? 176, 176);
    const estH = Math.min(300, vh * 0.42);
    const ph = panel?.offsetHeight ? Math.min(panel.offsetHeight, estH) : Math.min(260, estH);

    let left = br.left - pw - gap;
    if (left < gap) left = gap;
    if (left + pw > vw - gap) left = Math.max(gap, vw - pw - gap);

    let top = br.top - ph - gap;
    if (top < gap) top = br.bottom + gap;
    if (top + ph > vh - gap) top = Math.max(gap, vh - ph - gap);

    setMoreFixedPos({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!moreOpen) {
      setMoreFixedPos(null);
      return;
    }
    updateMorePanelPosition();
    const t = window.setTimeout(updateMorePanelPosition, 0);
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(updateMorePanelPosition);
    });
    window.addEventListener("resize", updateMorePanelPosition);
    window.addEventListener("scroll", updateMorePanelPosition, true);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("resize", updateMorePanelPosition);
      window.removeEventListener("scroll", updateMorePanelPosition, true);
    };
  }, [moreOpen, updateMorePanelPosition, basemap, layers]);

  useEffect(() => {
    if (!moreOpen) return;
    /** Capture phase so we never close before the portaled control receives the same gesture (bubble mousedown on document was stealing clicks). */
    const onOutsidePointer = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const t = e.target as Node;
      if (railShellRef.current?.contains(t)) return;
      if (morePanelRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onOutsidePointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutsidePointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  return (
    <div className="map-dock">
      <aside className="map-dock__rail" aria-label="Map type and overlays">
        <div className="map-dock__basemap-shell" ref={railShellRef}>
          <div className="map-dock__basemap-col map-dock__basemap-col--compact" role="group" aria-label="Map type">
            <BasemapThumb
              mode="satellite"
              label="Satellite"
              current={basemap}
              thumbClass="map-dock__basemap-mini-thumb--sat"
              onSelect={onBasemapChange}
            />
            <BasemapThumb
              mode="roadmap"
              label="Map"
              current={basemap}
              thumbClass="map-dock__basemap-mini-thumb--road"
              onSelect={onBasemapChange}
            />
            <div className="map-dock__more-anchor">
              <button
                ref={moreBtnRef}
                type="button"
                className={
                  "map-dock__chip map-dock__chip--more-btn" + (moreOpen ? " map-dock__chip--active" : "")
                }
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                aria-controls={morePanelId}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <span className="map-dock__chip-icon">
                  <IconLayersMore />
                </span>
                <span className="map-dock__chip-label">More</span>
              </button>
            </div>
          </div>
        </div>

        <div className="map-dock__stat map-dock__stat--rail">
          <p className="map-dock__stat-label">Active buses</p>
          <p className="map-dock__stat-value">
            {activeBuses} <span className="map-dock__stat-suffix">/ {regionLabel}</span>
          </p>
        </div>
      </aside>

      <div className="map-dock__row map-dock__row--fleet">
        <div className="map-dock__tray" role="toolbar" aria-label="Fleet map overlays">
          <LayerChip
            icon={<IconShield />}
            label="Geofence"
            active={layers.geofence}
            onClick={() => onToggle("geofence", !layers.geofence)}
          />
          <LayerChip
            icon={<IconTraffic />}
            label="Traffic"
            active={layers.traffic}
            live
            onClick={() => onToggle("traffic", !layers.traffic)}
          />
          <LayerChip
            icon={<IconHeat />}
            label="Heat"
            active={layers.heatmap}
            live
            onClick={() => onToggle("heatmap", !layers.heatmap)}
          />
          <LayerChip
            icon={<IconClock />}
            label="Delays"
            active={layers.delays}
            live
            onClick={() => onToggle("delays", !layers.delays)}
          />
          <LayerChip
            icon={<IconBus />}
            label="Buses"
            active={layers.buses}
            onClick={() => onToggle("buses", !layers.buses)}
          />
        </div>
      </div>

      <p className="map-dock__attr">
        Google Maps · Basemap & overlays
      </p>

      {moreOpen
        ? createPortal(
            <div
              ref={morePanelRef}
              id={morePanelId}
              className="map-dock__more-panel"
              style={{
                top: moreFixedPos?.top ?? 0,
                left: moreFixedPos?.left ?? 0,
                visibility: moreFixedPos ? "visible" : "hidden",
              }}
              role="dialog"
              aria-label="Map style and overlays"
            >
              <p className="map-dock__more-panel-title">Map &amp; overlays</p>
              <div className="map-dock__more-panel-scroll">
                <BasemapThumb
                  mode="terrain"
                  label="Terrain"
                  current={basemap}
                  thumbClass="map-dock__basemap-mini-thumb--terrain"
                  onSelect={(m) => {
                    onBasemapChange(m);
                    closeMore();
                  }}
                />
                <BasemapThumb
                  mode="dark"
                  label="Dark"
                  current={basemap}
                  thumbClass="map-dock__basemap-mini-thumb--dark"
                  onSelect={(m) => {
                    onBasemapChange(m);
                    closeMore();
                  }}
                />
                {/* Overlay chips intentionally removed from More panel per product request. */}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
