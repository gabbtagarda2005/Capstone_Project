import type { TicketRow } from "@/lib/types";
import { shortLocationLabel } from "@/lib/shortLocationLabel";
import "./LiveTicketOperationsTable.css";

const HUB_CHIPS = ["Malaybalay", "Maramag", "Valencia"] as const;

function isMongoTicketId(id: TicketRow["id"]): boolean {
  return /^[a-f0-9]{24}$/i.test(String(id));
}

type Props = {
  tickets: TicketRow[];
  hubChip: string | null;
  onHubChipChange: (hub: string | null) => void;
  attendantNameOverride?: string | null;
  /** When ticket rows omit bus_number, show assigned fleet label (e.g. attendant dossier). */
  busNumberFallback?: string | null;
  /** Passenger management: edit/delete Mongo ticket rows (admin portal). */
  onEditTicket?: (t: TicketRow) => void;
  onDeleteTicket?: (t: TicketRow) => void;
};

function IconPencilTiny() {
  return (
    <svg className="live-ops-table__icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
      />
    </svg>
  );
}

function IconTrashTiny() {
  return (
    <svg className="live-ops-table__icon-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
      />
    </svg>
  );
}

export function LiveTicketOperationsTable({
  tickets,
  hubChip,
  onHubChipChange,
  attendantNameOverride,
  busNumberFallback,
  onEditTicket,
  onDeleteTicket,
}: Props) {
  const rowActions = Boolean(onEditTicket || onDeleteTicket);
  const sorted = [...tickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (sorted.length === 0) {
    return (
      <div className="live-ops-table-wrap">
        <div className="live-ops-table__chips" role="group" aria-label="Quick filter by hub">
          {HUB_CHIPS.map((hub) => (
            <button
              key={hub}
              type="button"
              className={"live-ops-table__chip" + (hubChip === hub ? " live-ops-table__chip--active" : "")}
              onClick={() => onHubChipChange(hubChip === hub ? null : hub)}
            >
              {hub}
            </button>
          ))}
        </div>
        <p className="live-ops-table__empty">No records match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="live-ops-table-wrap">
      <div className="live-ops-table__chips" role="group" aria-label="Quick filter by hub">
        {HUB_CHIPS.map((hub) => (
          <button
            key={hub}
            type="button"
            className={"live-ops-table__chip" + (hubChip === hub ? " live-ops-table__chip--active" : "")}
            onClick={() => onHubChipChange(hubChip === hub ? null : hub)}
          >
            {hub}
          </button>
        ))}
      </div>
      <div className="live-ops-table__scroll">
        <table className="live-ops-table">
          <colgroup>
            <col className="live-ops-table__col-num" />
            <col className="live-ops-table__col-pax" />
            <col className="live-ops-table__col-start" />
            <col className="live-ops-table__col-dest" />
            <col className="live-ops-table__col-attendant" />
            <col className="live-ops-table__col-bus" />
            <col className="live-ops-table__col-fare" />
            {rowActions ? <col className="live-ops-table__col-actions" /> : null}
          </colgroup>
          <thead>
            <tr>
              <th className="live-ops-table__th-num" scope="col">
                #
              </th>
              <th scope="col">Passenger ID</th>
              <th scope="col">Start location</th>
              <th scope="col">Destination</th>
              <th scope="col">Bus attendant</th>
              <th scope="col">Bus</th>
              <th className="live-ops-table__th-fare" scope="col">
                Fare
              </th>
              {rowActions ? (
                <th className="live-ops-table__th-actions" scope="col">
                  Actions
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const attendantName = attendantNameOverride?.trim() || t.busOperatorName?.trim() || "—";
              const busRaw = t.busNumber != null && String(t.busNumber).trim() ? String(t.busNumber).trim() : "";
              const bus = busRaw || (busNumberFallback?.trim() ? busNumberFallback.trim() : "—");
              return (
                <tr key={String(t.id)}>
                  <td className="live-ops-table__num">{i + 1}</td>
                  <td className="live-ops-table__mono" title={t.passengerId}>
                    {t.passengerId}
                  </td>
                  <td className="live-ops-table__loc">
                    <div className="live-ops-table__loc-inner">
                      <span className="live-ops-table__dot live-ops-table__dot--start" aria-hidden />
                      <span className="live-ops-table__loc-text" title={t.startLocation}>
                        {shortLocationLabel(t.startLocation)}
                      </span>
                    </div>
                  </td>
                  <td className="live-ops-table__loc">
                    <div className="live-ops-table__loc-inner">
                      <span className="live-ops-table__pin" aria-hidden title="Destination" />
                      <span className="live-ops-table__loc-text" title={t.destination}>
                        {shortLocationLabel(t.destination)}
                      </span>
                    </div>
                  </td>
                  <td className="live-ops-table__attendant-cell" title={attendantName}>
                    {attendantName}
                  </td>
                  <td className="live-ops-table__bus" title={`Ticket #${String(t.id)}`}>
                    {bus}
                  </td>
                  <td className="live-ops-table__fare">₱{t.fare.toFixed(2)}</td>
                  {rowActions ? (
                    <td className="live-ops-table__actions">
                      <div className="live-ops-table__action-btns">
                        {onEditTicket ? (
                          <button
                            type="button"
                            className="live-ops-table__icon-btn"
                            title={isMongoTicketId(t.id) ? "Edit ticket" : "Legacy ticket — edit unavailable"}
                            aria-label="Edit ticket"
                            disabled={!isMongoTicketId(t.id)}
                            onClick={() => isMongoTicketId(t.id) && onEditTicket(t)}
                          >
                            <IconPencilTiny />
                          </button>
                        ) : null}
                        {onDeleteTicket ? (
                          <button
                            type="button"
                            className="live-ops-table__icon-btn live-ops-table__icon-btn--danger"
                            title={isMongoTicketId(t.id) ? "Delete ticket" : "Legacy ticket — delete unavailable"}
                            aria-label="Delete ticket"
                            disabled={!isMongoTicketId(t.id)}
                            onClick={() => isMongoTicketId(t.id) && onDeleteTicket(t)}
                          >
                            <IconTrashTiny />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
