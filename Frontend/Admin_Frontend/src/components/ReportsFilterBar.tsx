import type { ReportsAnalyticsFilters } from "@/lib/api";
import "./ReportsFilterBar.css";

type Props = {
  value: ReportsAnalyticsFilters;
  onChange: (next: ReportsAnalyticsFilters) => void;
  buses: string[];
  routes: string[];
};

export function ReportsFilterBar({ value, onChange, buses, routes }: Props) {
  const hasActiveFilter = Boolean(value.startDate || value.endDate || value.busNumber || value.route);

  function set(patch: Partial<ReportsAnalyticsFilters>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="reports-filter-bar" role="group" aria-label="Report filters">
      <label className="reports-filter-bar__field">
        <span className="reports-filter-bar__label">Start date</span>
        <input
          type="date"
          className="reports-hub__export-date-input"
          value={value.startDate ?? ""}
          onChange={(e) => set({ startDate: e.target.value || undefined })}
        />
      </label>

      <label className="reports-filter-bar__field">
        <span className="reports-filter-bar__label">End date</span>
        <input
          type="date"
          className="reports-hub__export-date-input"
          value={value.endDate ?? ""}
          onChange={(e) => set({ endDate: e.target.value || undefined })}
        />
      </label>

      <label className="reports-filter-bar__field">
        <span className="reports-filter-bar__label">Bus</span>
        <select
          className="reports-hub__export-date-input reports-filter-bar__select"
          value={value.busNumber ?? ""}
          onChange={(e) => set({ busNumber: e.target.value || undefined })}
        >
          <option value="">All buses</option>
          {buses.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>

      <label className="reports-filter-bar__field">
        <span className="reports-filter-bar__label">Route</span>
        <select
          className="reports-hub__export-date-input reports-filter-bar__select"
          value={value.route ?? ""}
          onChange={(e) => set({ route: e.target.value || undefined })}
        >
          <option value="">All routes</option>
          {routes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="reports-filter-bar__reset"
        onClick={() => onChange({})}
        disabled={!hasActiveFilter}
      >
        Reset
      </button>
    </div>
  );
}
