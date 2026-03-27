import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./PeakLoadChart.css";

const PEAK_DATA = [
  { time: "6AM", passengers: 450 },
  { time: "8AM", passengers: 920 },
  { time: "10AM", passengers: 510 },
  { time: "12PM", passengers: 680 },
  { time: "2PM", passengers: 550 },
  { time: "4PM", passengers: 1050 },
  { time: "6PM", passengers: 810 },
] as const;

const CYAN = "#06b6d4";
const PEAK_ORANGE = "#fb923c";

type Props = {
  /** When true, 4PM bar is emphasized (school/work dismissal window). */
  corridorPeakActive?: boolean;
  smartEtaText?: string;
};

export function PeakLoadChart({ corridorPeakActive, smartEtaText }: Props) {
  const h = new Date().getHours();
  const dismissNow = h >= 15 && h <= 18;
  const emphasize4pm = Boolean(corridorPeakActive ?? dismissNow);

  return (
    <section className="peak-load-chart" aria-labelledby="peak-load-chart-title">
      <div className="peak-load-chart__head">
        <div>
          <h3 id="peak-load-chart-title" className="peak-load-chart__title">
            Peak load windows
          </h3>
          <p className="peak-load-chart__sub">Malaybalay & Valencia corridor</p>
        </div>
        <span className="peak-load-chart__chip">Predictive</span>
      </div>
      {emphasize4pm ? (
        <p className="peak-load-chart__banner">
          Valencia corridor is in a high-dismissal window — prioritize spare units if geofence alerts fire.
        </p>
      ) : null}
      {smartEtaText ? <p className="peak-load-chart__eta">{smartEtaText}</p> : null}
      <div className="peak-load-chart__plot">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[...PEAK_DATA]} barGap={8} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: "#6b7280", fontSize: 11 }} />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0B0E14",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
              }}
              itemStyle={{ color: "#fff" }}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar dataKey="passengers" radius={[10, 10, 0, 0]} style={{ filter: "drop-shadow(0 0 6px rgba(6, 182, 212, 0.35))" }}>
              {PEAK_DATA.map((entry) => (
                <Cell
                  key={entry.time}
                  fill={emphasize4pm && entry.time === "4PM" ? PEAK_ORANGE : CYAN}
                  fillOpacity={emphasize4pm && entry.time === "4PM" ? 0.95 : 0.82}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
