import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardMap } from "@/components/DashboardMap";
import {
  PassengerDepartureBoard,
  PassengerFeedbackConsole,
  PassengerNewsFeed,
  type TacticalPanelId,
} from "@/components/PassengerTacticalPanels";
import { PassengerSidebarDashboardIcon } from "@/components/PassengerSidebarDashboardIcon";
import { PassengerTopBar } from "@/components/PassengerTopBar";
import { PassengerLostFound, PassengerRouteCalculator } from "@/components/PassengerTacticalHub";
import { fetchPublicCompanyProfile } from "@/lib/fetchPublicCompanyProfile";
import { clearPassengerLocationGate } from "@/lib/passengerLocationGate";
import { fetchPassengerNotificationFeed, type PassengerNotificationItem } from "@/lib/passengerNotifications";
import "./PassengerLandingPage.css";
import "./PassengerDashboardPage.css";

type MainPanel = TacticalPanelId | "dashboard" | "buses" | "lost";

const API_BASE = (import.meta.env.VITE_PASSENGER_API_URL || "http://localhost:4000").replace(/\/+$/, "");

export function PassengerDashboardPage() {
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mainPanel, setMainPanel] = useState<MainPanel>("buses");
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<PassengerNotificationItem[]>([]);
  const [companyName, setCompanyName] = useState("Bukidnon Transit");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const dashboardActive = mainPanel === "dashboard";

  function handleLogout() {
    clearPassengerLocationGate();
    setNotifOpen(false);
    navigate("/", { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const items = await fetchPassengerNotificationFeed();
        if (!cancelled) setNotifications(items);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 28_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicCompanyProfile()
      .then((p) => {
        if (!cancelled) {
          setCompanyName(p.name);
          setCompanyLogoUrl(p.logoUrl);
          setLogoBroken(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={"pd" + (darkMode ? "" : " pd--light")}>
      <div className="pd__glow" aria-hidden />
      <PassengerTopBar
        onNotificationsClick={() => setNotifOpen(true)}
        notificationCount={notifications.length}
      />
      <main className="pd__inner pd__inner--dashboard">
        <div
          className="pd-dashboard-body"
          data-sidebar-expanded={sidebarOpen ? "true" : "false"}
        >
          <aside
            className={"pd-sidebar pd-sidebar--adminlike" + (sidebarOpen ? " pd-sidebar--open" : "")}
            aria-label="Passenger dashboard sidebar"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <div className="pd-console">
              <button type="button" className="pd-sidebar__brand-btn" aria-label="Toggle sidebar">
                <span className="pd-sidebar__logo">
                  {companyLogoUrl && !logoBroken ? (
                    <img
                      src={companyLogoUrl}
                      alt=""
                      className="pd-sidebar__logo-img"
                      onError={() => setLogoBroken(true)}
                    />
                  ) : (
                    <span className="pd-sidebar__logo-fallback">
                      {(companyName.charAt(0) || "B").toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="pd-sidebar__brand-text">{companyName}</span>
              </button>
              <div
                className="pd-util-list pd-console__section pd-sidebar__scroll"
                aria-label="Passenger utilities"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={"pd-util-btn" + (dashboardActive ? " pd-util-btn--active" : "")}
                  onClick={() => setMainPanel("dashboard")}
                >
                  <span className="pd-util-btn__icon pd-util-btn__icon--dashboard" aria-hidden>
                    <PassengerSidebarDashboardIcon />
                  </span>
                  <span className="pd-sidebar__item-label">Dashboard</span>
                </button>
                <button
                  type="button"
                  className={"pd-util-btn" + (mainPanel === "schedules" ? " pd-util-btn--active" : "")}
                  onClick={() => setMainPanel("schedules")}
                >
                  <span className="pd-util-btn__icon" aria-hidden>
                    🕒
                  </span>
                  <span className="pd-sidebar__item-label">Schedules</span>
                </button>
                <button
                  type="button"
                  className={"pd-util-btn" + (mainPanel === "buses" ? " pd-util-btn--active" : "")}
                  onClick={() => setMainPanel("buses")}
                >
                  <span className="pd-util-btn__icon" aria-hidden>
                    🚌
                  </span>
                  <span className="pd-sidebar__item-label">Check Buses</span>
                </button>
                <button
                  type="button"
                  className={"pd-util-btn" + (mainPanel === "news" ? " pd-util-btn--active" : "")}
                  onClick={() => setMainPanel("news")}
                >
                  <span className="pd-util-btn__icon" aria-hidden>
                    📰
                  </span>
                  <span className="pd-sidebar__item-label">News &amp; Updates</span>
                </button>
                <button
                  type="button"
                  className={"pd-util-btn" + (mainPanel === "feedback" ? " pd-util-btn--active" : "")}
                  onClick={() => setMainPanel("feedback")}
                >
                  <span className="pd-util-btn__icon" aria-hidden>
                    💬
                  </span>
                  <span className="pd-sidebar__item-label">Feedbacks</span>
                </button>
                <button
                  type="button"
                  className={"pd-util-btn" + (mainPanel === "lost" ? " pd-util-btn--active" : "")}
                  onClick={() => setMainPanel("lost")}
                >
                  <span className="pd-util-btn__icon" aria-hidden>
                    🎒
                  </span>
                  <span className="pd-sidebar__item-label">Left Something?</span>
                </button>
                <div className="pd-util-toggle">
                  <span className="pd-sidebar__item-label">{darkMode ? "Dark Mode" : "Light Mode"}</span>
                  <button
                    type="button"
                    className={"pd-util-switch" + (darkMode ? " pd-util-switch--on" : "")}
                    aria-pressed={darkMode}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDarkMode((v) => !v);
                    }}
                  >
                    <span className="pd-util-switch__knob" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="pd-logout-btn pd-console__section pd-sidebar__footer-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLogout();
                }}
              >
                <span className="pd-util-btn__icon" aria-hidden>
                  🏠
                </span>
                <span className="pd-sidebar__item-label">Logout</span>
              </button>
            </div>
          </aside>

          <div className={"pd-map-area" + (dashboardActive ? "" : " pd-map-area--tactical")}>
            {dashboardActive ? (
              <DashboardMap apiBase={API_BASE} />
            ) : (
              <div className="pd-tactical-main">
                {mainPanel === "buses" ? (
                  <PassengerRouteCalculator onClose={() => setMainPanel("dashboard")} />
                ) : null}
                {mainPanel === "lost" ? <PassengerLostFound /> : null}
                {mainPanel === "schedules" ? <PassengerDepartureBoard /> : null}
                {mainPanel === "news" ? <PassengerNewsFeed /> : null}
                {mainPanel === "feedback" ? <PassengerFeedbackConsole /> : null}
              </div>
            )}
          </div>
        </div>
      </main>
      {notifOpen ? (
        <div className="pd-notif-overlay" role="dialog" aria-modal="true" aria-label="Notifications">
          <button type="button" className="pd-notif-overlay__backdrop" onClick={() => setNotifOpen(false)} />
          <aside className="pd-notif-drawer">
            <header className="pd-notif-drawer__head">
              <h3>Notifications</h3>
              <button type="button" onClick={() => setNotifOpen(false)} aria-label="Close notifications">
                ×
              </button>
            </header>
            <div className="pd-notif-drawer__body">
              {notifications.length === 0 ? (
                <p className="pd-notif-drawer__empty">No notifications yet. We&apos;ll alert you to bus arrivals and schedule changes here.</p>
              ) : (
                notifications.map((n) => (
                  <article
                    key={n.id}
                    className={`pd-notif-drawer__item pd-notif-drawer__item--${n.kind}`}
                  >
                    <div className="pd-notif-drawer__item-head">
                      <strong>{n.title}</strong>
                      <span className="pd-notif-drawer__time">{n.timeLabel}</span>
                    </div>
                    <p>{n.body}</p>
                  </article>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
