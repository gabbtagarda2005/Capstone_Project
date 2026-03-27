import type { CorridorRouteRow } from "@/lib/types";
import "@/components/AttendantGlassCard.css";

type Props = {
  route: CorridorRouteRow;
  initials: string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy?: boolean;
  canDelete?: boolean;
};

export function CorridorRouteGlassCard({ route, initials, onView, onEdit, onDelete, busy, canDelete }: Props) {
  const title = route.displayName?.trim() ? route.displayName : "Corridor route";

  return (
    <div className="att-glass-parent">
      <div className="att-glass-card">
        <div className="att-glass-card__logo" aria-hidden>
          <span className="att-glass-card__circle att-glass-card__circle--1" />
          <span className="att-glass-card__circle att-glass-card__circle--2" />
          <span className="att-glass-card__circle att-glass-card__circle--3" />
          <span className="att-glass-card__circle att-glass-card__circle--4" />
          <span className="att-glass-card__circle att-glass-card__circle--5">
            <span className="att-glass-card__avatar-initials">{initials}</span>
          </span>
        </div>
        <div className="att-glass-card__glass" />
        <div className="att-glass-card__content att-glass-card__content--route">
          <span className="att-glass-card__title">{title}</span>
          <div className="att-glass-card__route-body">
            <div className="att-glass-card__route-section">
              <span className="att-glass-card__route-k">Origin</span>
              <span className="att-glass-card__route-v">{route.originLabel}</span>
            </div>
            <div className="att-glass-card__route-section">
              <span className="att-glass-card__route-k">Destination</span>
              <span className="att-glass-card__route-v">{route.destLabel}</span>
            </div>
            {route.viaLabels && route.viaLabels.length > 0 ? (
              <div className="att-glass-card__route-section">
                <span className="att-glass-card__route-k">Via</span>
                <span className="att-glass-card__route-v">{route.viaLabels.join(" · ")}</span>
              </div>
            ) : null}
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
            {canDelete ? (
              <button
                type="button"
                className="att-glass-card__action att-glass-card__action--delete"
                disabled={busy}
                onClick={onDelete}
              >
                Delete
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
