import type { AttendantVerifiedSummary } from "@/lib/types";
import "./AttendantGlassCard.css";

type Props = {
  attendant: AttendantVerifiedSummary;
  initials: string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy?: boolean;
};

export function AttendantGlassCard({ attendant, initials, onView, onEdit, onDelete, busy }: Props) {
  const fullName = `${attendant.firstName} ${attendant.lastName}`.trim();
  const photo = attendant.profileImageUrl?.trim() || null;

  return (
    <div className="att-glass-parent">
      <div className="att-glass-card">
        <div className="att-glass-card__logo" aria-hidden>
          <span className="att-glass-card__circle att-glass-card__circle--1" />
          <span className="att-glass-card__circle att-glass-card__circle--2" />
          <span className="att-glass-card__circle att-glass-card__circle--3" />
          <span className="att-glass-card__circle att-glass-card__circle--4" />
          <span className="att-glass-card__circle att-glass-card__circle--5">
            {photo ? (
              <img src={photo} alt="" className="att-glass-card__avatar-img" />
            ) : (
              <span className="att-glass-card__avatar-initials">{initials}</span>
            )}
          </span>
        </div>
        <div className="att-glass-card__glass" />
        <div className="att-glass-card__content att-glass-card__content--person">
          <span className="att-glass-card__title">{fullName}</span>
          <div className="att-glass-card__fields">
            <span className="att-glass-card__text">{attendant.email}</span>
            {attendant.phone ? <span className="att-glass-card__meta">{attendant.phone}</span> : null}
            <span className="att-glass-card__meta att-glass-card__meta--role">
              {attendant.role === "Operator" ? "Bus attendant" : attendant.role}
            </span>
          </div>
        </div>
        <div className="att-glass-card__bottom">
          <div className="att-glass-card__actions">
            <button type="button" className="att-glass-card__action att-glass-card__action--view" disabled={busy} onClick={onView}>
              View
            </button>
            <button type="button" className="att-glass-card__action" disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="att-glass-card__action att-glass-card__action--delete"
              disabled={busy}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
