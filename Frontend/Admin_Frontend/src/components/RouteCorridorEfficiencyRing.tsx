import { useId } from "react";
import "./RouteCorridorEfficiencyRing.css";

type Props = {
  /** 0–100 */
  efficiencyPct: number;
  /** Label under the percentage (e.g. "Passenger efficiency") */
  caption?: string;
};

export function RouteCorridorEfficiencyRing({ efficiencyPct, caption = "Efficiency" }: Props) {
  const gradId = useId().replace(/:/g, "");
  const pct = Math.min(100, Math.max(0, Math.round(efficiencyPct)));
  const r = 46;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  return (
    <div className="rte-eff-ring" aria-label={`${caption} ${pct} percent`}>
      <svg className="rte-eff-ring__svg" viewBox="0 0 108 108" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="50%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#1F5885" />
          </linearGradient>
        </defs>
        <circle className="rte-eff-ring__track" cx="54" cy="54" r={r} />
        <circle
          className="rte-eff-ring__arc"
          cx="54"
          cy="54"
          r={r}
          stroke={`url(#${gradId})`}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 54 54)"
        />
      </svg>
      <div className="rte-eff-ring__core">
        <span className="rte-eff-ring__pct">{pct}%</span>
        <span className="rte-eff-ring__cap">{caption}</span>
      </div>
    </div>
  );
}
