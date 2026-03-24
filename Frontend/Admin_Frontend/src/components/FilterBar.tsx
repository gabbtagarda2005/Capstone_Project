import type { DatePreset, FilterState } from "@/lib/filterTickets";

type Props = {
  value: FilterState;
  onChange: (next: FilterState) => void;
};

export function FilterBar({ value, onChange }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="dg-filter">
      <label className="dg-filter__field">
        <span className="dg-filter__label">Search Passenger ID</span>
        <input
          className="dg-filter__input"
          type="search"
          placeholder="e.g. PID-302359"
          value={value.passengerIdQuery}
          onChange={(e) => set({ passengerIdQuery: e.target.value })}
        />
      </label>

      <label className="dg-filter__field">
        <span className="dg-filter__label">Date mode</span>
        <select
          className="dg-filter__select"
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
          <input
            className="dg-filter__input"
            type="date"
            value={value.day}
            onChange={(e) => set({ day: e.target.value })}
          />
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
        <input
          className="dg-filter__input"
          type="date"
          value={value.from}
          onChange={(e) => set({ from: e.target.value })}
        />
      </label>
      <label className="dg-filter__field">
        <span className="dg-filter__label">To</span>
        <input
          className="dg-filter__input"
          type="date"
          value={value.to}
          onChange={(e) => set({ to: e.target.value })}
        />
      </label>
      <p className="dg-filter__hint">
        If <strong>From</strong>/<strong>To</strong> are set, they override Day/Month/Year presets.
      </p>
    </div>
  );
}
