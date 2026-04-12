import "./CorridorTrafficLoadBar.css";

export type TrafficSegmentLevel = "clear" | "light" | "heavy" | "critical";

type Props = {
  label?: string;
  segments: TrafficSegmentLevel[];
};

export function CorridorTrafficLoadBar({ label = "TRA · corridor load", segments }: Props) {
  return (
    <div className="rte-tra" aria-label="Corridor traffic load visualization">
      <div className="rte-tra__head">
        <span className="rte-tra__label">{label}</span>
        <span className="rte-tra__mono">{segments.length} segments</span>
      </div>
      <div className="rte-tra__bar" role="img">
        {segments.map((lvl, i) => (
          <div key={i} className={`rte-tra__seg rte-tra__seg--${lvl}`} title={lvl} />
        ))}
      </div>
      <div className="rte-tra__legend">
        <span>
          <i className="rte-tra__dot rte-tra__dot--clear" /> Clear
        </span>
        <span>
          <i className="rte-tra__dot rte-tra__dot--light" /> Light
        </span>
        <span>
          <i className="rte-tra__dot rte-tra__dot--heavy" /> Heavy
        </span>
        <span>
          <i className="rte-tra__dot rte-tra__dot--critical" /> Critical
        </span>
      </div>
    </div>
  );
}
