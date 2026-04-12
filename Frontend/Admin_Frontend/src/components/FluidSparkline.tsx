import "./FluidSparkline.css";

type Props = {
  color?: string;
  /** 0–1 height variation seed */
  seed?: number;
  className?: string;
};

/** Compact animated sparkline — suggests live data velocity */
export function FluidSparkline({ color = "#38bdf8", seed = 0.5, className = "" }: Props) {
  const n = 28;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const wave = Math.sin(t * Math.PI * 3 + seed * 6) * 0.22 + Math.sin(t * Math.PI * 7 + seed) * 0.12;
    const y = 18 + wave * 14 + (i % 4) * 0.8;
    const x = 4 + (i / (n - 1)) * 92;
    pts.push(`${x},${y}`);
  }
  const d = `M ${pts.join(" L ")}`;

  return (
    <svg className={`fluid-sparkline ${className}`.trim()} viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`fs-fill-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="fluid-sparkline__area" d={`${d} L 96 34 L 4 34 Z`} fill={`url(#fs-fill-${seed})`} />
      <path className="fluid-sparkline__line" d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
