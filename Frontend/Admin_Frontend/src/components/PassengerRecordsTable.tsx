import type { TicketRow } from "@/lib/types";

type Props = { rows: TicketRow[] };

export function PassengerRecordsTable({ rows }: Props) {
  return (
    <div className="dg-table-wrap">
      <table className="dg-table">
        <thead>
          <tr>
            <th>Passenger ID</th>
            <th>Start</th>
            <th>Destination</th>
            <th>Bus operator</th>
            <th>Fare</th>
            <th>Issued</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="dg-table__muted" style={{ padding: "1rem 0.85rem" }}>
                No records match the current filters.
              </td>
            </tr>
          ) : (
            rows.map((t) => (
              <tr key={String(t.id)}>
                <td className="dg-table__mono">{t.passengerId}</td>
                <td>{t.startLocation}</td>
                <td>{t.destination}</td>
                <td>{t.busOperatorName || "—"}</td>
                <td>₱{t.fare.toFixed(2)}</td>
                <td className="dg-table__muted">{new Date(t.createdAt).toLocaleString()}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
