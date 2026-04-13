import { useSosInterceptOptional } from "@/context/SosInterceptContext";
import "./SosEmergencyBlockingModal.css";

/** Blocks the entire admin UI until the operator acknowledges — SOS stays active until resolved separately. */
export function SosEmergencyBlockingModal() {
  const sos = useSosInterceptOptional();
  if (!sos?.activeIncident || !sos.emergencyBlockingOpen) return null;

  const inc = sos.activeIncident;
  const mapsHref = `https://www.google.com/maps?q=${encodeURIComponent(`${inc.latitude},${inc.longitude}`)}`;

  return (
    <div className="sos-emergency-block" role="alertdialog" aria-modal="true" aria-labelledby="sos-emergency-title">
      <div className="sos-emergency-block__panel">
        <div className="sos-emergency-block__icon-wrap" aria-hidden>
          <svg className="sos-emergency-block__icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
        </div>
        <h1 id="sos-emergency-title" className="sos-emergency-block__title">
          Emergency — attendant SOS
        </h1>
        <p className="sos-emergency-block__lead">
          Bus <strong>{inc.busId}</strong>
          {inc.plateNumber && inc.plateNumber !== "—" ? (
            <>
              {" "}
              · Plate <strong>{inc.plateNumber}</strong>
            </>
          ) : null}
        </p>
        <ul className="sos-emergency-block__meta">
          <li>
            Driver: <strong>{inc.driverName}</strong>
          </li>
          <li>
            Attendant: <strong>{inc.attendantName}</strong>
          </li>
          <li>
            Coordinates:{" "}
            <strong>
              {inc.latitude.toFixed(5)}, {inc.longitude.toFixed(5)}
            </strong>
          </li>
        </ul>
        <a className="sos-emergency-block__maps" href={mapsHref} target="_blank" rel="noreferrer">
          Open in Google Maps
        </a>
        <p className="sos-emergency-block__hint">Acknowledge to access the dashboard. Use the tactical feed to mute audio or resolve the incident with required notes.</p>
        <button type="button" className="sos-emergency-block__ack" onClick={() => sos.acknowledgeEmergency()}>
          I acknowledge — continue
        </button>
      </div>
    </div>
  );
}
