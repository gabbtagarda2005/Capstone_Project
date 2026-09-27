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
              <span className="fleet-u3__line fleet-u3__line--attendant" title={attendantLabel}>
                <strong>Attendant</strong> {attendantLabel}
              </span>
              <span className="fleet-u3__line fleet-u3__line--route" title={bus.route || undefined}>
                <strong>Route</strong> {bus.route || "Not assigned"}
              </span>
            </span>
          </div>
          <div className="fleet-u3__bottom">
            <div className="fleet-u3__pill-buttons">
              <Link to={detailPath} className="fleet-u3__pill-btn" aria-label={`View ${bus.busNumber}`}>
                View
              </Link>
              <button type="button" className="fleet-u3__pill-btn" aria-label="Edit bus" disabled={busy} onClick={onEdit}>
                Edit
              </button>
              <button
                type="button"
                className="fleet-u3__pill-btn fleet-u3__pill-btn--danger"
                aria-label={`Delete ${bus.busNumber}`}
                disabled={busy}
                onClick={onDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
