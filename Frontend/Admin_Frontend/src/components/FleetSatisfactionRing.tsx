import { useId } from "react";
import "./FleetSatisfactionRing.css";

type Props = {
  /** 0–100 share of 4–5★ ratings */
  positivePct: number;
  caption?: string;
};

export function FleetSatisfactionRing({ positivePct, caption = "Overall fleet satisfaction" }: Props) {
  const gradId = `fsr-${useId().replace(/\W/g, "")}`;
  const p = Math.min(100, Math.max(0, Math.round(positivePct)));
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);

  return (
    <div className="fleet-sat-ring" aria-label={`${caption}: ${p} percent positive`}>
      <svg className="fleet-sat-ring__svg" viewBox="0 0 120 120" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="50%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#1F5885" />
          </linearGradient>
          <filter id={`${gradId}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle className="fleet-sat-ring__track" cx="60" cy="60" r={r} />
        <circle
          className="fleet-sat-ring__arc"
          cx="60"
          cy="60"
          r={r}
          stroke={`url(#${gradId})`}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          filter={`url(#${gradId}-glow)`}
        />
      </svg>
      <div className="fleet-sat-ring__core">
        <span className="fleet-sat-ring__pct">{p}%</span>
        <span className="fleet-sat-ring__sub">Positive</span>
        <span className="fleet-sat-ring__cap">{caption}</span>
      </div>
    </div>
  );
}
