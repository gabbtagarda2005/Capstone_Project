import { useId } from "react";

type Props = {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
};

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

  // Convert a hex or rgb(a) stroke string to rgb components so we can apply consistent gradient opacity.
  function colorToRgbParts(color: string): { r: number; g: number; b: number } | null {
    const c = color.trim();
    if (c.startsWith("#")) {
      const hex = c.slice(1);
      const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
      if (full.length !== 6) return null;
      const n = Number.parseInt(full, 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return { r, g, b };
    }
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (!m || !m[1]) return null;
    const parts = m[1].split(",").map((x) => x.trim());
    if (parts.length < 3) return null;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    return { r, g, b };
  }

  const strokeParts = colorToRgbParts(stroke) ?? { r: 34, g: 211, b: 238 };

  const vmax = Math.max(...values, 1);
  const vmin = Math.min(...values);
  const span = Math.max(vmax - vmin, vmax * 0.15, 8);
  const n = values.length;
  const step = n > 1 ? (w - pad * 2) / (n - 1) : 0;

  const points = values.map((v, i) => {
    const x = pad + i * step;
    const t = (v - vmin) / span;
    const y = pad + (1 - t) * (h - pad * 2);
    return { x, y };
  });

  // Smooth "Liquid Light" curve using Catmull-Rom -> Bezier.
  // Chart.js tension (0.4) feel: lower values are more "tight" and less bouncy.
  const tension = 0.4;
  function catmullRomToBezierPath(p: { x: number; y: number }[]): string {
    if (p.length < 2) return "";
    const d: string[] = [`M ${p[0]!.x.toFixed(2)} ${p[0]!.y.toFixed(2)}`];

    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] ?? p[i]!;
      const p1 = p[i]!;
      const p2 = p[i + 1]!;
      const p3 = p[i + 2] ?? p2;

      const cp1x = p1.x + ((p2.x - p0.x) * tension) / 6;
      const cp1y = p1.y + ((p2.y - p0.y) * tension) / 6;
      const cp2x = p2.x - ((p3.x - p1.x) * tension) / 6;
      const cp2y = p2.y - ((p3.y - p1.y) * tension) / 6;

      d.push(
        `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
      );
    }
    return d.join(" ");
  }

  const lineD = catmullRomToBezierPath(points);
  const areaD = `${lineD} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`;

  // Peaks: mark top values with a subtle pulse (liquid highlight).
  const peakCount = Math.min(3, Math.max(1, Math.round(n * 0.12)));
  const peakIndices = [...values]
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, peakCount)
    .map((x) => x.i)
    .sort((a, b) => a - b);

  const uid = useId().replace(/:/g, "");
  const gradId = `spark-fill-${uid}`;
  const glowId = `spark-glow-${uid}`;

  const strokeBaseRgba = `rgba(${strokeParts.r}, ${strokeParts.g}, ${strokeParts.b}, 1)`;
  // Use the provided `fill` alpha as an intensity hint.
  function getAlphaFromRgba(c: string): number | null {
    const m = c.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/i);
    if (!m) return null;
    const a = Number(m[1]);
    return Number.isFinite(a) ? a : null;
  }
  const fillAlpha = getAlphaFromRgba(fill) ?? 0.18;
  // When fillAlpha is around 0.18 (our "Slide Ocean" baseline), top mist hits ~50%.
  const areaOpacity = Math.min(1, Math.max(0.25, fillAlpha / 0.18));

  return (
    <svg className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeBaseRgba} stopOpacity={0.5} />
          <stop offset="100%" stopColor={strokeBaseRgba} stopOpacity={0} />
        </linearGradient>
        <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <style>{`
          @keyframes sparkPulse_${uid} {
            0%, 100% { opacity: 0.45; transform: scale(0.85); }
            50% { opacity: 1; transform: scale(1.35); }
          }
        `}</style>
      </defs>

      <path d={areaD} fill={`url(#${gradId})`} stroke="none" opacity={areaOpacity} />

      {/* Liquid Light stroke */}
      <path d={lineD} fill="none" stroke={stroke} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${glowId})`} />

      {/* Pulsing peaks */}
      {peakIndices.map((i, idx) => {
        const pt = points[i]!;
        const delay = idx * 0.18;
        return (
          <circle
            key={`${uid}-peak-${i}`}
            cx={pt.x}
            cy={pt.y}
            r="2.25"
            fill={strokeBaseRgba}
            opacity={0.75}
            style={{
              animation: `sparkPulse_${uid} 1.6s ease-in-out ${delay}s infinite`,
              transformOrigin: `${pt.x}px ${pt.y}px`,
            }}
          />
        );
      })}
    </svg>
  );
}
