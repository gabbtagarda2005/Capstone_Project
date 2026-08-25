import type { TicketRow } from "@/lib/types";
import "./TicketDetailModal.css";

type Props = {
  ticket: TicketRow | null;
  onClose: () => void;
};

function formatIssuedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TicketDetailModal({ ticket, onClose }: Props) {
  if (!ticket) return null;

  return (
    <div className="ticket-detail-modal__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="ticket-detail-modal"
        role="dialog"
        aria-labelledby="ticket-detail-modal-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="ticket-detail-modal__header">
          <h2 id="ticket-detail-modal-title" className="ticket-detail-modal__title">
            Ticket details
          </h2>
          <span className="ticket-detail-modal__id">#{String(ticket.id)}</span>
        </div>

        <div className="ticket-detail-modal__fare">
          <span className="ticket-detail-modal__fare-value">₱{ticket.fare.toFixed(2)}</span>
          <span className="ticket-detail-modal__fare-label">Fare collected</span>
        </div>

        <dl className="ticket-detail-modal__grid">
          <div className="ticket-detail-modal__row">
            <dt>Passenger ID</dt>
            <dd>{ticket.passengerId}</dd>
          </div>
          <div className="ticket-detail-modal__row">
            <dt>Start location</dt>
            <dd>{ticket.startLocation}</dd>
          </div>
          <div className="ticket-detail-modal__row">
            <dt>Destination</dt>
            <dd>{ticket.destination}</dd>
          </div>
          <div className="ticket-detail-modal__row">
            <dt>Bus attendant</dt>
            <dd>{ticket.busOperatorName || "—"}</dd>
          </div>
          <div className="ticket-detail-modal__row">
            <dt>Bus</dt>
            <dd>{ticket.busNumber || "—"}</dd>
          </div>
          <div className="ticket-detail-modal__row">
            <dt>Issued at</dt>
            <dd>{formatIssuedAt(ticket.createdAt)}</dd>
          </div>
        </dl>

        <div className="ticket-detail-modal__actions">
          <button type="button" className="ticket-detail-modal__btn ticket-detail-modal__btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
