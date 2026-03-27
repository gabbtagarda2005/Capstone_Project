import type { DatePreset, FilterState } from "@/lib/filterTickets";

type Props = {
  value: FilterState;
  onChange: (next: FilterState) => void;
  /** Passenger module: glass strip, search icon, pulsing date preset */
  variant?: "default" | "glass";
};

function SearchIcon() {
  return (
    <svg className="dg-filter__search-icon" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="dg-filter__date-icon" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function FilterBar({ value, onChange, variant = "default" }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const glass = variant === "glass";
  const selectClass =
    "dg-filter__select" + (glass && value.preset !== "all" ? " dg-filter__select--pulse" : "");

  return (
    <div className={"dg-filter" + (glass ? " dg-filter--passenger-glass" : "")}>
      <label className="dg-filter__field" style={glass ? { flex: "1 1 220px", minWidth: "min(100%, 240px)" } : undefined}>
        <span className="dg-filter__label">Search Passenger ID</span>
        {glass ? (
          <div className="dg-filter__search-wrap">
            <SearchIcon />
            <input
              className="dg-filter__input"
              type="search"
              placeholder="e.g. PID-302359"
              value={value.passengerIdQuery}
              onChange={(e) => set({ passengerIdQuery: e.target.value })}
            />
          </div>
        ) : (
          <input
            className="dg-filter__input"
            type="search"
            placeholder="e.g. PID-302359"
            value={value.passengerIdQuery}
            onChange={(e) => set({ passengerIdQuery: e.target.value })}
          />
        )}
      </label>

      <label className="dg-filter__field">
        <span className="dg-filter__label">Date mode</span>
        <select
          className={selectClass}
          value={value.preset}
          onChange={(e) => set({ preset: e.target.value as DatePreset })}
        >
          <option value="all">All dates</option>
          <option value="day">Single day</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
        </select>
      </label>

      {value.preset === "day" && (
        <label className="dg-filter__field">
          <span className="dg-filter__label">Day</span>
          {glass ? (
            <div className="dg-filter__date-wrap">
              <CalendarIcon />
              <input
                className="dg-filter__input dg-filter__input--date"
                type="date"
                value={value.day}
                onChange={(e) => set({ day: e.target.value })}
              />
            </div>
          ) : (
            <input
              className="dg-filter__input"
              type="date"
              value={value.day}
              onChange={(e) => set({ day: e.target.value })}
            />
          )}
        </label>
      )}

      {value.preset === "month" && (
        <label className="dg-filter__field">
          <span className="dg-filter__label">Month</span>
          <input
            className="dg-filter__input"
            type="month"
            value={value.month}
            onChange={(e) => set({ month: e.target.value })}
          />
        </label>
      )}

      {value.preset === "year" && (
        <label className="dg-filter__field">
          <span className="dg-filter__label">Year</span>
          <input
            className="dg-filter__input"
            type="number"
            placeholder="2026"
            value={value.year}
            onChange={(e) => set({ year: e.target.value })}
            style={{ maxWidth: 120 }}
          />
        </label>
      )}

      <label className="dg-filter__field">
        <span className="dg-filter__label">From</span>
        {glass ? (
          <div className="dg-filter__date-wrap">
            <CalendarIcon />
            <input
              className="dg-filter__input dg-filter__input--date"
              type="date"
              value={value.from}
              onChange={(e) => set({ from: e.target.value })}
            />
          </div>
        ) : (
          <input
            className="dg-filter__input"
            type="date"
            value={value.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        )}
      </label>
      <label className="dg-filter__field">
        <span className="dg-filter__label">To</span>
        {glass ? (
          <div className="dg-filter__date-wrap">
            <CalendarIcon />
            <input
              className="dg-filter__input dg-filter__input--date"
              type="date"
              value={value.to}
              onChange={(e) => set({ to: e.target.value })}
            />
          </div>
        ) : (
          <input
            className="dg-filter__input"
            type="date"
            value={value.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        )}
      </label>
    </div>
  );
}
