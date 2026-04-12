import { useSosInterceptOptional } from "@/context/SosInterceptContext";
import "./SosCriticalOverlay.css";

/**
 * Active SOS incident controls (Security → Incident alerts).
 * Mirrors tactical feed formatting: CRITICAL SOS line, PLATE / ATT / GPS, mute & resolve.
 */
export function SosIncidentSettingsCard() {
  const sos = useSosInterceptOptional();
  const incident = sos?.activeIncident;
  if (!incident) return null;

  const lat = sos.liveLat ?? incident.latitude;
  const lng = sos.liveLng ?? incident.longitude;
  const attLine =
    incident.attendantEmail != null && String(incident.attendantEmail).trim()
      ? String(incident.attendantEmail).trim()
      : incident.attendantName;

  return (
    <div className="sos-incident-panel" aria-live="polite">
      <div className="sos-banner__main">
        <span className="sos-banner__pulse-dot" aria-hidden />
        <p className="sos-banner__critical">
          CRITICAL SOS: {incident.busId} — {incident.driverName}
        </p>
      </div>
      <div className="sos-banner__meta">
        <span>PLATE {incident.plateNumber}</span>
        <span>ATT {attLine}</span>
        <span>
          GPS {lat.toFixed(6)}, {lng.toFixed(6)}
        </span>
      </div>
      <div className="sos-banner__actions">
        <button type="button" className="sos-banner__btn sos-banner__btn--mute" onClick={() => sos.setMuted(!sos.muted)}>
          {sos.muted ? "Unmute ping" : "Mute ping"}
        </button>
        <button type="button" className="sos-banner__btn sos-banner__btn--resolve" onClick={() => sos.openResolveModal()}>
          Resolve incident…
        </button>
      </div>
    </div>
  );
}
