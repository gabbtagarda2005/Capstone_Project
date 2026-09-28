import { useEffect, useRef, useState } from "react";
import type { PassengerBasemapMode } from "@/passenger/lib/passengerMapTiles";
import "./PassengerMapBasemapDock.css";

type Props = {
  basemap: PassengerBasemapMode;
  onBasemapChange: (mode: PassengerBasemapMode) => void;
  /** Shows a "Need Help?" button above the basemap rail when set (reopens the passenger quick guide). */
  onHelpClick?: () => void;
  /** Shows a "Weather" toggle above Need Help when set (turns Weather Mode markers on/off). */
  onWeatherClick?: () => void;
  weatherActive?: boolean;
};

function IconLayers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

const OPTIONS: { mode: PassengerBasemapMode; label: string; swatchClass: string }[] = [
  { mode: "satellite", label: "Satellite", swatchClass: "pmap-dock__option-swatch--sat" },
  { mode: "roadmap", label: "Map", swatchClass: "pmap-dock__option-swatch--road" },
  { mode: "terrain", label: "Terrain", swatchClass: "pmap-dock__option-swatch--terrain" },
  { mode: "dark", label: "Dark", swatchClass: "pmap-dock__option-swatch--dark" },
];

/**
 * Collapsed by default — only the "More" trigger shows. Tapping it expands a small connected
 * list (Satellite / Map / Terrain / Dark) upward, in place, so it can never be clipped by the
 * viewport edge and never shifts the trigger's own position.
 */
export function PassengerMapBasemapDock({
  basemap,
  onBasemapChange,
  onHelpClick,
  onWeatherClick,
  weatherActive,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onOutsidePointer = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (railRef.current?.contains(e.target as Node)) return;
      setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onOutsidePointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutsidePointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  return (
    <div className="pmap-dock">
      {onWeatherClick ? (
        <button
          type="button"
          className={
            "pmap-dock__weather" +
            (expanded ? " pmap-dock__weather--hidden" : "") +
            (weatherActive ? " pmap-dock__weather--active" : "")
          }
          onClick={onWeatherClick}
          aria-label="Show weather map"
          aria-pressed={Boolean(weatherActive)}
          tabIndex={expanded ? -1 : 0}
        >
          <span className="pmap-dock__weather-icon" aria-hidden>
            {weatherActive ? "🌤️" : "⛅"}
          </span>
          <span className="pmap-dock__weather-caption">Weather</span>
        </button>
      ) : null}

      {onHelpClick ? (
        <button
          type="button"
          className={"pmap-dock__help" + (expanded ? " pmap-dock__help--hidden" : "")}
          onClick={onHelpClick}
          aria-label="Open passenger quick guide"
          tabIndex={expanded ? -1 : 0}
        >
          <span className="pmap-dock__help-icon" aria-hidden>
            ?
          </span>
          <span className="pmap-dock__help-caption">Need Help?</span>
        </button>
      ) : null}

      <div className="pmap-dock__rail" ref={railRef} aria-label="Map type">
        <div
          className={"pmap-dock__options" + (expanded ? " pmap-dock__options--open" : "")}
          role="group"
          aria-label="Map style"
          aria-hidden={!expanded}
        >
          {OPTIONS.map((opt) => {
            const active = basemap === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                className={"pmap-dock__option" + (active ? " pmap-dock__option--active" : "")}
                onClick={() => {
                  onBasemapChange(opt.mode);
                  setExpanded(false);
                }}
                aria-pressed={active}
                tabIndex={expanded ? 0 : -1}
              >
                <span className={"pmap-dock__option-swatch " + opt.swatchClass} aria-hidden />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={"pmap-dock__trigger" + (expanded ? " pmap-dock__trigger--active" : "")}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-haspopup="true"
        >
          <IconLayers />
          <span className="pmap-dock__trigger-caption">More</span>
        </button>
      </div>
    </div>
  );
}
