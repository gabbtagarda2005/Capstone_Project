import type { LegacyRef, ReactNode } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PassengerBasemapMode } from "@/lib/passengerMapTiles";
import "./PassengerMapBasemapDock.css";

type Props = {
  basemap: PassengerBasemapMode;
  onBasemapChange: (mode: PassengerBasemapMode) => void;
  activeBuses: number;
  regionLabel?: string;
};

function IconLayersMore() {
  return (
    <svg className="pmap-dock__chip-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

type BaseThumbProps = {
  mode: PassengerBasemapMode;
  label: string;
  current: PassengerBasemapMode;
  thumbClass: string;
  onSelect: (m: PassengerBasemapMode) => void;
};

function BasemapThumb({ mode, label, current, thumbClass, onSelect }: BaseThumbProps) {
  const active = current === mode;
  return (
    <button
      type="button"
      className={"pmap-dock__basemap-mini" + (active ? " pmap-dock__basemap-mini--active" : "")}
      onClick={() => onSelect(mode)}
      aria-pressed={active}
      aria-label={`${label} map`}
    >
      <span className={"pmap-dock__basemap-mini-thumb " + thumbClass} aria-hidden />
      <span className="pmap-dock__basemap-mini-caption">{label}</span>
    </button>
  );
}

function MoreChip({
  icon,
  label,
  active,
  onClick,
  btnRef,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  btnRef: LegacyRef<HTMLButtonElement>;
}) {
  return (
    <button
      ref={btnRef}
      type="button"
      className={"pmap-dock__chip pmap-dock__chip--more-btn" + (active ? " pmap-dock__chip--active" : "")}
      onClick={onClick}
      aria-expanded={active}
      aria-haspopup="dialog"
    >
      <span className="pmap-dock__chip-icon">{icon}</span>
      <span className="pmap-dock__chip-label">{label}</span>
    </button>
  );
}

export function PassengerMapBasemapDock({
  basemap,
  onBasemapChange,
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
  }, [moreOpen, updateMorePanelPosition, basemap]);

  useEffect(() => {
    if (!moreOpen) return;
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
    <div className="pmap-dock">
      <aside className="pmap-dock__rail" aria-label="Map type">
        <div className="pmap-dock__basemap-shell" ref={railShellRef}>
          <div className="pmap-dock__basemap-col pmap-dock__basemap-col--compact" role="group" aria-label="Map type">
            <BasemapThumb
              mode="satellite"
              label="Satellite"
              current={basemap}
              thumbClass="pmap-dock__basemap-mini-thumb--sat"
              onSelect={onBasemapChange}
            />
            <BasemapThumb
              mode="roadmap"
              label="Map"
              current={basemap}
              thumbClass="pmap-dock__basemap-mini-thumb--road"
              onSelect={onBasemapChange}
            />
            <div className="pmap-dock__more-anchor">
              <MoreChip
                icon={<IconLayersMore />}
                label="More"
                active={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
                btnRef={moreBtnRef as LegacyRef<HTMLButtonElement>}
              />
            </div>
          </div>
        </div>

        <div className="pmap-dock__stat pmap-dock__stat--rail">
          <p className="pmap-dock__stat-label">Live buses</p>
          <p className="pmap-dock__stat-value">
            {activeBuses} <span className="pmap-dock__stat-suffix">/ {regionLabel}</span>
          </p>
        </div>
      </aside>

      {moreOpen
        ? createPortal(
            <div
              ref={morePanelRef}
              id={morePanelId}
              className="pmap-dock__more-panel"
              style={{
                top: moreFixedPos?.top ?? 0,
                left: moreFixedPos?.left ?? 0,
                visibility: moreFixedPos ? "visible" : "hidden",
              }}
              role="dialog"
              aria-label="More map styles"
            >
              <p className="pmap-dock__more-panel-title">Map style</p>
              <div className="pmap-dock__more-panel-scroll">
                <BasemapThumb
                  mode="terrain"
                  label="Terrain"
                  current={basemap}
                  thumbClass="pmap-dock__basemap-mini-thumb--terrain"
                  onSelect={(m) => {
                    onBasemapChange(m);
                    closeMore();
                  }}
                />
                <BasemapThumb
                  mode="dark"
                  label="Dark"
                  current={basemap}
                  thumbClass="pmap-dock__basemap-mini-thumb--dark"
                  onSelect={(m) => {
                    onBasemapChange(m);
                    closeMore();
                  }}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
