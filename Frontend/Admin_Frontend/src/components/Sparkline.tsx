type Props = {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
};

/** Minimal SVG sparkline; values should be non-negative (e.g. latency ms). */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  stroke = "rgba(34, 211, 238, 0.9)",
  fill = "rgba(34, 211, 238, 0.12)",
  className,
}: Props) {
  const w = width;
  const h = height;
  const pad = 2;
  if (!values.length) {
    return (
      <svg className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
      </svg>
    );
  }
  const vmax = Math.max(...values, 1);
  const vmin = Math.min(...values);
  const span = Math.max(vmax - vmin, vmax * 0.15, 8);
  const n = values.length;
  const step = n > 1 ? (w - pad * 2) / (n - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const t = (v - vmin) / span;
    const y = pad + (1 - t) * (h - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const lineD = `M ${pts.join(" L ")}`;
  const areaD = `${lineD} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`;

  return (
    <svg className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={areaD} fill={fill} stroke="none" />
      <path d={lineD} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
