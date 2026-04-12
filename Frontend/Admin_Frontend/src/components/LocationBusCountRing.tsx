import { useId } from "react";
import "./LocationBusCountRing.css";

type Props = {
  count: number;
  /** Ring fills to 100% at this count */
  maxForScale?: number;
};

export function LocationBusCountRing({ count, maxForScale = 24 }: Props) {
  const gradId = useId().replace(/:/g, "");
  const pct = Math.min(100, Math.round((count / Math.max(1, maxForScale)) * 100));
  const r = 46;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);

  return (
    <div className="loc-bus-ring" aria-label={`${count} buses inside geofence`}>
      <svg className="loc-bus-ring__svg" viewBox="0 0 108 108" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="55%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#1F5885" />
          </linearGradient>
        </defs>
        <circle className="loc-bus-ring__track" cx="54" cy="54" r={r} />
        <circle
          className="loc-bus-ring__arc"
          cx="54"
          cy="54"
          r={r}
          stroke={`url(#${gradId})`}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 54 54)"
        />
      </svg>
      <div className="loc-bus-ring__core">
        <span className="loc-bus-ring__count">{count}</span>
        <span className="loc-bus-ring__cap">Buses inside</span>
      </div>
    </div>
  );
}
