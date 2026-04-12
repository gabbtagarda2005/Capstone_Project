type Props = {
  /** All-time ticket rows (volume tracking) */
  totalTicketCount: number;
  /** Sum of fare for the current filter (cash drawer audit) */
  filteredRevenue: number;
  /** Rows matching current filter (shown under revenue card) */
  filteredCount: number;
};

export function StatCards({ totalTicketCount, filteredRevenue, filteredCount }: Props) {
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="dg-stat-grid">
      <article className="dg-stat">
        <div className="dg-stat__label">Total ticket count</div>
        <div className="dg-stat__value">{totalTicketCount}</div>
        <div className="dg-stat__meta">All passengers served (all time)</div>
      </article>
      <article className="dg-stat">
        <div className="dg-stat__label">Revenue</div>
        <div className="dg-stat__value">₱{fmt(filteredRevenue)}</div>
        <div className="dg-stat__meta">
          Matching filters: {filteredCount} record{filteredCount === 1 ? "" : "s"}
        </div>
      </article>
    </div>
  );
}
