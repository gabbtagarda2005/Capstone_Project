import { shortFareLocationLabel } from "@/lib/fareLocationLabel";
import type { FareMatrixRowDto } from "@/lib/types";
import "./DriverGlassCard.css";
import "./FareGlassCard.css";

type Props = {
  row: FareMatrixRowDto;
  onView: () => void;
  onEditHint: () => void;
  onDelete: () => void;
  canDelete?: boolean;
  busy?: boolean;
};

export function FareGlassCard({ row, onView, onEditHint, onDelete, canDelete = true, busy }: Props) {
  const startShort = shortFareLocationLabel(row.startLabel);
  const endShort = shortFareLocationLabel(row.endLabel);
  const fare = Number(row.baseFarePesos);
  const fareText = Number.isFinite(fare) ? fare.toFixed(2) : "—";

  return (
    <div className="drv-glass-parent fare-glass-card-wrap">
      <div className="drv-glass-card">
        <div className="drv-glass-card__logo" aria-hidden>
          <span className="drv-glass-card__circle drv-glass-card__circle--1" />
          <span className="drv-glass-card__circle drv-glass-card__circle--2" />
          <span className="drv-glass-card__circle drv-glass-card__circle--3" />
          <span className="drv-glass-card__circle drv-glass-card__circle--4" />
          <span className="drv-glass-card__circle drv-glass-card__circle--5">
            <span className="fare-glass-card__peso-avatar" aria-hidden>
              ₱
            </span>
          </span>
        </div>
        <div className="drv-glass-card__glass" />
        <div className="drv-glass-card__content drv-glass-card__content--stack">
          <span className="drv-glass-card__title fare-glass-card__route-title" title={`${row.startLabel} → ${row.endLabel}`}>
            {startShort} → {endShort}
          </span>
          <div className="drv-glass-card__fields">
            <span className="drv-glass-card__meta drv-glass-card__meta--role">Fare route</span>
            <span className="drv-glass-card__meta">
              <span className="drv-glass-card__k">Start</span> {startShort}
            </span>
            <span className="drv-glass-card__meta">
              <span className="drv-glass-card__k">Destination</span> {endShort}
            </span>
            <span className="drv-glass-card__meta">
              <span className="drv-glass-card__k">Base fare</span> ₱{fareText}
            </span>
          </div>
        </div>
        <div className="drv-glass-card__bottom">
          <div className="drv-glass-card__actions">
            <button type="button" className="drv-glass-card__action drv-glass-card__action--view" disabled={busy} onClick={onView}>
              View
            </button>
            <button type="button" className="drv-glass-card__action" disabled={busy} onClick={onEditHint}>
              Edit
            </button>
            <button
              type="button"
              className="drv-glass-card__action drv-glass-card__action--delete"
              disabled={busy || !canDelete}
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
