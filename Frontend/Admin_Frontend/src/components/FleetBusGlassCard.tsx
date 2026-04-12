import { Link } from "react-router-dom";
import type { BusRow } from "@/lib/types";
import "./FleetBusGlassCard.css";

type Props = {
  bus: BusRow;
  attendantLabel: string;
  healthTone: "healthy" | "maintenance" | "inspection";
  onEdit: () => void;
  onDelete: () => void;
  busy?: boolean;
};

function maskImei(imei: string | null) {
  if (!imei || imei.length < 4) return "—";
  return `···${imei.slice(-4)}`;
}

function healthClass(tone: Props["healthTone"]): string {
  if (tone === "maintenance") return "fleet-u3__health--maint";
  if (tone === "inspection") return "fleet-u3__health--inspect";
  return "fleet-u3__health--good";
}

function IconEye() {
  return (
    <svg className="fleet-u3__cbtn-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
      />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg className="fleet-u3__cbtn-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg className="fleet-u3__cbtn-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
      />
    </svg>
  );
}

function IconBusBadge() {
  return (
    <svg className="fleet-u3__logo-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M4 16c0 .88.39 1.67 1 2.2V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.8c.61-.53 1-1.32 1-2.2V6c0-2.21-1.79-4-4-4H8C5.79 2 4 3.79 4 6v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5-7H6V6h12v4z"
      />
    </svg>
  );
}

export function FleetBusGlassCard({ bus, attendantLabel, healthTone, onEdit, onDelete, busy }: Props) {
  const healthLabel = bus.healthStatus || (healthTone === "healthy" ? "Good" : healthTone === "maintenance" ? "Maint" : "Inspect");
  const detailPath = `/dashboard/management/buses/${encodeURIComponent(bus.id)}`;

  return (
    <article className="fleet-u3">
      <div className="fleet-u3__parent">
        <div className="fleet-u3__card">
          <div className="fleet-u3__logo" aria-hidden>
            <span className="fleet-u3__circle fleet-u3__circle--1" />
            <span className="fleet-u3__circle fleet-u3__circle--2" />
            <span className="fleet-u3__circle fleet-u3__circle--3" />
            <span className="fleet-u3__circle fleet-u3__circle--4" />
            <span className="fleet-u3__circle fleet-u3__circle--5">
              <IconBusBadge />
            </span>
          </div>
          <div className="fleet-u3__glass" aria-hidden />
          <div className="fleet-u3__content">
            <span className="fleet-u3__title">{bus.busNumber}</span>
            <div className="fleet-u3__plate-row">
              <span className="fleet-u3__plate-label">Plate</span>
              <span
                className="fleet-u3__plate-value"
                title={bus.plateNumber?.trim() ? undefined : "No license plate on file"}
              >
                {bus.plateNumber?.trim() || "—"}
              </span>
            </div>
            <span className={`fleet-u3__health ${healthClass(healthTone)}`}>{healthLabel}</span>
            <span className="fleet-u3__text">
              <span className="fleet-u3__line">
                <strong>IMEI</strong> {maskImei(bus.imei)}
              </span>
              <span className="fleet-u3__line">
                <strong>Attendant</strong> {attendantLabel}
              </span>
              <span className="fleet-u3__line fleet-u3__line--route" title={bus.route || undefined}>
                <strong>Route</strong> {bus.route || "Not assigned"}
              </span>
            </span>
          </div>
          <div className="fleet-u3__bottom">
            <div className="fleet-u3__social-buttons">
              <Link to={detailPath} className="fleet-u3__social-button" title="View" aria-label={`View ${bus.busNumber}`}>
                <IconEye />
              </Link>
              <button type="button" className="fleet-u3__social-button" title="Edit" aria-label="Edit bus" disabled={busy} onClick={onEdit}>
                <IconPencil />
              </button>
              <button
                type="button"
                className="fleet-u3__social-button fleet-u3__social-button--danger"
                title="Remove bus from registry"
                aria-label={`Delete ${bus.busNumber}`}
                disabled={busy}
                onClick={onDelete}
              >
                <IconTrash />
              </button>
            </div>
            <div className="fleet-u3__labels">
              <Link to={detailPath} className="fleet-u3__label-link">
                View
              </Link>
              <span className="fleet-u3__label-sep" aria-hidden>
                ·
              </span>
              <button type="button" className="fleet-u3__label-btn" disabled={busy} onClick={onEdit}>
                Edit
              </button>
              <span className="fleet-u3__label-sep" aria-hidden>
                ·
              </span>
              <button type="button" className="fleet-u3__label-btn fleet-u3__label-btn--danger" disabled={busy} onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
