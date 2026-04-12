import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./TacticalMapLegendHud.css";

export function TacticalMapLegendHud() {
  const panelId = useId();
  const [open, setOpen] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  return (
    <div className="tactical-map-hud-wrap" ref={wrapRef}>
      <button
        type="button"
        className="tactical-map-hud-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        title="Tactical map legend"
      >
        <span className="tactical-map-hud-trigger__glyph" aria-hidden>
          i
        </span>
        <span className="tactical-map-hud-trigger__label">Legend</span>
      </button>

      {open ? (
        <div className="tactical-map-hud" id={panelId} role="region" aria-label="Tactical map legend HUD">
          <div className="tactical-map-hud__header">
            <span className="tactical-map-hud__title">TACTICAL MAP · STATUS</span>
            <button type="button" className="tactical-map-hud__close" onClick={close} aria-label="Close legend">
              ×
            </button>
          </div>

          <table className="tactical-map-hud-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Indicator</th>
                <th scope="col" className="tactical-map-hud-table__status">
                  Operational status
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="tactical-map-hud-table__cat">Terminal activity</td>
                <td>
                  <span className="tactical-hud-ind tactical-hud-ind--terminal" title="Load tiers" aria-hidden>
                    <span className="tactical-hud-ind__dot tactical-hud-ind__dot--high" />
                    <span className="tactical-hud-ind__dot tactical-hud-ind__dot--med" />
                    <span className="tactical-hud-ind__dot tactical-hud-ind__dot--low" />
                  </span>
                </td>
                <td className="tactical-map-hud-mono">HIGH · MED · LOW PAX LOAD</td>
              </tr>
              <tr>
                <td className="tactical-map-hud-table__cat">Terminal arrival</td>
                <td>
                  <span className="tactical-hud-ind tactical-hud-ind--arrival" aria-hidden>
                    <span className="tactical-hud-ind__arrival-ring" />
                  </span>
                </td>
                <td className="tactical-map-hud-mono">GEOFENCE · EMERALD RING · SCHEDULE ARRIVING</td>
              </tr>
              <tr>
                <td className="tactical-map-hud-table__cat">Speed alert</td>
                <td>
                  <span className="tactical-hud-ind tactical-hud-ind--speed" aria-hidden>
                    <span className="tactical-hud-ind__speed-core" />
                  </span>
                </td>
                <td className="tactical-map-hud-mono">&gt;80 KM/H · RED PULSE · REPORTS LOG</td>
              </tr>
              <tr>
                <td className="tactical-map-hud-table__cat">Emergency</td>
                <td>
                  <span className="tactical-hud-ind tactical-hud-ind--sos" aria-hidden>
                    <span className="tactical-hud-ind__sos-ring" />
                    <span className="tactical-hud-ind__sos-core" />
                  </span>
                </td>
                <td className="tactical-map-hud-mono">SOS · 100M PERIMETER</td>
              </tr>
            </tbody>
          </table>

          <div className="tactical-map-hud__section-label">LAYER INTEL · MAP DOCK</div>

          <table className="tactical-map-hud-table tactical-map-hud-table--layers">
            <tbody>
              <tr>
                <td className="tactical-map-hud-table__cat">Geofence</td>
                <td className="tactical-map-hud-mono tactical-map-hud-table__desc">
                  Emerald perimeter · terminal detection zone (m)
                </td>
              </tr>
              <tr>
                <td className="tactical-map-hud-table__cat">Corridor policy</td>
                <td className="tactical-map-hud-mono tactical-map-hud-table__desc">
                  Solid cyan line · strict segment · dashed / teal glow · flexible free-pickup zone
                </td>
              </tr>
              <tr>
                <td className="tactical-map-hud-table__cat">Traffic / Heat</td>
                <td className="tactical-map-hud-mono tactical-map-hud-table__desc">
                  Orange traffic risk pinpoints · cyan hub intensity glow
                </td>
              </tr>
              <tr>
                <td className="tactical-map-hud-table__cat">Delays</td>
                <td className="tactical-map-hud-mono tactical-map-hud-table__desc">
                  <span className="tactical-map-hud-pill tactical-map-hud-pill--orange">ORANGE PATH</span> wx delay risk on route
                </td>
              </tr>
              <tr>
                <td className="tactical-map-hud-table__cat">Buses</td>
                <td className="tactical-map-hud-mono tactical-map-hud-table__desc">
                  <span className="tactical-map-hud-pill tactical-map-hud-pill--cyan">CYAN TRAIL</span> normal ·{" "}
                  <span className="tactical-map-hud-pill tactical-map-hud-pill--red">RED</span> violation
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
