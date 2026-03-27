import { useCallback, useEffect, useState } from "react";
import { GEOFENCE_BREACH_EVENT, type GeofenceBreachDetail } from "@/lib/geofenceEvents";
import { isGeofenceGlobalAlertEnabled } from "@/lib/settingsPrefs";
import "./GeofenceBreachAlert.css";

export function GeofenceBreachAlert() {
  const [queue, setQueue] = useState<GeofenceBreachDetail[]>([]);

  useEffect(() => {
    const onBreach = (e: Event) => {
      if (!isGeofenceGlobalAlertEnabled()) return;
      const ce = e as CustomEvent<GeofenceBreachDetail>;
      if (!ce.detail?.busId) return;
      setQueue((q) => [...q, ce.detail]);
    };
    window.addEventListener(GEOFENCE_BREACH_EVENT, onBreach);
    return () => window.removeEventListener(GEOFENCE_BREACH_EVENT, onBreach);
  }, []);

  const acknowledge = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const active = queue[0];
  if (!active) return null;

  return (
    <div className="geofence-breach-alert" role="alertdialog" aria-labelledby="geofence-breach-title" aria-modal="false">
      <div className="geofence-breach-alert__glow" aria-hidden />
      <div className="geofence-breach-alert__card">
        <div className="geofence-breach-alert__icon-wrap" aria-hidden>
          <svg className="geofence-breach-alert__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="geofence-breach-alert__body">
          <div className="geofence-breach-alert__head">
            <h4 id="geofence-breach-title" className="geofence-breach-alert__title">
              Geofence breach
            </h4>
            <span className="geofence-breach-alert__pill">CRITICAL</span>
          </div>
          <p className="geofence-breach-alert__text">
            Vehicle <strong className="geofence-breach-alert__bus">{active.busId}</strong> is outside its assigned corridor (reported terminal:{" "}
            {active.currentTerminal}).
          </p>
          <div className="geofence-breach-alert__coords">
            <svg className="geofence-breach-alert__pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="geofence-breach-alert__mono">
              {active.latitude.toFixed(4)}° N, {active.longitude.toFixed(4)}° E
            </span>
            <span className="geofence-breach-alert__off">(off-route)</span>
          </div>
          {queue.length > 1 ? (
            <p className="geofence-breach-alert__queue">+{queue.length - 1} more in queue — acknowledge to see next</p>
          ) : null}
        </div>
        <button type="button" className="geofence-breach-alert__ack" onClick={acknowledge} aria-label="Acknowledge geofence alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
