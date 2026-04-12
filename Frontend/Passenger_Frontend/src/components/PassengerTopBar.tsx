import "./PassengerTopBar.css";

type Props = {
  onNotificationsClick?: () => void;
  notificationCount?: number;
};

export function PassengerTopBar({
  onNotificationsClick,
  notificationCount = 0,
}: Props) {
  return (
    <div className="passenger-notif-fab" aria-label="Passenger notifications">
      <button
        type="button"
        className="passenger-notif-fab__btn"
        aria-label="Notifications"
        onClick={onNotificationsClick}
      >
        <span className="passenger-notif-fab__icon" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </span>
        {notificationCount > 0 ? (
          <span className="passenger-notif-fab__badge">{notificationCount > 9 ? "9+" : notificationCount}</span>
        ) : null}
      </button>
    </div>
  );
}
