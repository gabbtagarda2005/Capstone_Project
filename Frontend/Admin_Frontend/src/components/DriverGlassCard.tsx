import type { DriverSummary } from "@/lib/types";
import "./DriverGlassCard.css";

type Props = {
  driver: DriverSummary;
  initials: string;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy?: boolean;
};

export function DriverGlassCard({ driver, initials, onView, onEdit, onDelete, busy }: Props) {
  const fullName = `${driver.firstName} ${driver.lastName}`.trim();
  const photo = driver.profileImageUrl?.trim() || null;
  const exp = driver.yearsExperience != null ? `${driver.yearsExperience}y exp` : "Experience n/a";
  const phone = driver.phone?.trim() || null;

  return (
    <div className="drv-glass-parent">
      <div className="drv-glass-card">
        <div className="drv-glass-card__logo" aria-hidden>
          <span className="drv-glass-card__circle drv-glass-card__circle--1" />
          <span className="drv-glass-card__circle drv-glass-card__circle--2" />
          <span className="drv-glass-card__circle drv-glass-card__circle--3" />
          <span className="drv-glass-card__circle drv-glass-card__circle--4" />
          <span className="drv-glass-card__circle drv-glass-card__circle--5">
            {photo ? (
              <img src={photo} alt="" className="drv-glass-card__avatar-img" />
            ) : (
              <span className="drv-glass-card__avatar-initials">{initials}</span>
            )}
          </span>
        </div>
        <div className="drv-glass-card__glass" />
        <div className="drv-glass-card__content drv-glass-card__content--stack">
          <span className="drv-glass-card__title">{fullName}</span>
          <div className="drv-glass-card__fields">
            <span className="drv-glass-card__text">{driver.email || "No email"}</span>
            {phone ? <span className="drv-glass-card__meta">{phone}</span> : null}
            <span className="drv-glass-card__meta drv-glass-card__meta--role">Driver</span>
            <span className="drv-glass-card__meta">
              <span className="drv-glass-card__k">ID</span> {driver.driverId}
            </span>
            <span className="drv-glass-card__meta">
              <span className="drv-glass-card__k">License</span> {driver.licenseNumber || "n/a"}
            </span>
            <span className="drv-glass-card__meta">
              <span className="drv-glass-card__k">Experience</span> {exp}
            </span>
          </div>
        </div>
        <div className="drv-glass-card__bottom">
          <div className="drv-glass-card__actions">
            <button type="button" className="drv-glass-card__action drv-glass-card__action--view" disabled={busy} onClick={onView}>
              View
            </button>
            <button type="button" className="drv-glass-card__action" disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="drv-glass-card__action drv-glass-card__action--delete"
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
