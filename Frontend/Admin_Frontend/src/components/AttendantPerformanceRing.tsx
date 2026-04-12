import { useId } from "react";
import "./AttendantPerformanceRing.css";

type Props = {
  /** 0–100 */
  percent: number;
  caption: string;
};

export function AttendantPerformanceRing({ percent, caption }: Props) {
  const gradId = useId().replace(/:/g, "");
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const r = 46;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);

  return (
    <div className="att-perf-ring" aria-label={`${caption} ${p} percent`}>
      <svg className="att-perf-ring__svg" viewBox="0 0 108 108" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="55%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#1F5885" />
          </linearGradient>
        </defs>
        <circle className="att-perf-ring__track" cx="54" cy="54" r={r} />
        <circle
          className="att-perf-ring__arc"
          cx="54"
          cy="54"
          r={r}
          stroke={`url(#${gradId})`}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 54 54)"
        />
      </svg>
      <div className="att-perf-ring__core">
        <span className="att-perf-ring__pct">{p}%</span>
        <span className="att-perf-ring__cap">{caption}</span>
      </div>
    </div>
  );
}
