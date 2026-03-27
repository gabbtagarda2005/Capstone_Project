type Props = {
  totalTicketCount: number;
  filteredRevenue: number;
  filteredCount: number;
};

function fmtCompactRecords(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M records`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k records`;
  return `${n.toLocaleString()} record${n === 1 ? "" : "s"}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function IconPeople() {
  return (
    <svg className="passenger-bento__icon" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM8 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M4.5 19.5v-.5a4 4 0 0 1 4-4h1m5.5 4.5v-.5a4 4 0 0 0-4-4h-1m-5 0a4 4 0 0 0-4 4v.5M19.5 19.5v-.5a4 4 0 0 0-3.2-3.92"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconRevenue() {
  return (
    <svg className="passenger-bento__icon passenger-bento__icon--green" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v18M8 7h6.5a2.5 2.5 0 0 1 0 5H8m8 4H8"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PassengerBentoStats({ totalTicketCount, filteredRevenue, filteredCount }: Props) {
  return (
    <div className="passenger-bento">
      <article className="passenger-bento__card passenger-bento__card--volume">
        <div className="passenger-bento__value passenger-bento__value--white">
          {totalTicketCount.toLocaleString()}
        </div>
        <div className="passenger-bento__card-head">
          <IconPeople />
          <span className="passenger-bento__card-label">All passengers served (all time)</span>
        </div>
      </article>
      <article className="passenger-bento__card passenger-bento__card--revenue">
        <div className="passenger-bento__value passenger-bento__value--green">₱{fmtMoney(filteredRevenue)}</div>
        <div className="passenger-bento__card-head">
          <IconRevenue />
          <span className="passenger-bento__card-label passenger-bento__card-label--green">
            Matching filters: {fmtCompactRecords(filteredCount)}
          </span>
        </div>
        <div className="passenger-bento__card-sub">Total revenue (filtered)</div>
      </article>
    </div>
  );
}
