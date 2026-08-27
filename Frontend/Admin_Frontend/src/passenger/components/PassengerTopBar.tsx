import type { ReactNode } from "react";
import "./PassengerTopBar.css";

type Props = {
  companyName: string;
  companyLogoUrl: string | null;
  logoBroken: boolean;
  onLogoError: () => void;
  onExit: () => void;
  onNotificationsClick?: () => void;
  notificationCount?: number;
  subtitle?: ReactNode;
};

export function PassengerTopBar({
  companyName,
  companyLogoUrl,
  logoBroken,
  onLogoError,
  onExit,
  onNotificationsClick,
  notificationCount = 0,
  subtitle,
}: Props) {
  const initial = (companyName.charAt(0) || "B").toUpperCase();

  return (
    <header className="passenger-top-bar" aria-label="Passenger header">
      <div className="passenger-top-bar__row">
        <div className="passenger-top-bar__brand">
          <span className="passenger-top-bar__logo" aria-hidden>
            {companyLogoUrl && !logoBroken ? (
              <img src={companyLogoUrl} alt="" className="passenger-top-bar__logo-img" onError={onLogoError} />
            ) : (
              <span className="passenger-top-bar__logo-fallback">{initial}</span>
            )}
          </span>
          <span className="passenger-top-bar__name">{companyName}</span>
        </div>
        <div className="passenger-top-bar__actions">
          <button type="button" className="passenger-top-bar__exit" onClick={onExit}>
            Exit
          </button>
          <button
            type="button"
            className="passenger-top-bar__notif"
            aria-label="Notifications"
            onClick={onNotificationsClick}
          >
            <span className="passenger-top-bar__notif-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            {notificationCount > 0 ? (
              <span className="passenger-top-bar__badge">{notificationCount > 9 ? "9+" : notificationCount}</span>
            ) : null}
          </button>
        </div>
      </div>
      {subtitle ? (
        <div className="passenger-top-bar__subtitle" role="status" aria-label="Map overview">
          {subtitle}
        </div>
      ) : null}
    </header>
  );
}
