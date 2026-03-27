import { useEffect, useState, type MouseEvent, type MouseEventHandler } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { GeofenceBreachAlert } from "@/components/GeofenceBreachAlert";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import { useAuth } from "@/context/AuthContext";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import "./AdminLayout.css";

function SidebarBrandMark() {
  const { branding } = useAdminBranding();
  const [imgFailed, setImgFailed] = useState(false);
  const { companyName, logoUrl, sidebarLogoUrl } = branding;
  const markSrc = sidebarLogoUrl?.trim() || logoUrl?.trim() || "";
  const letter = (companyName.trim().charAt(0) || "B").toUpperCase();

  useEffect(() => {
    setImgFailed(false);
  }, [markSrc]);

  const showImg = Boolean(markSrc && !imgFailed);

  return (
    <div className="admin-sidebar__logo">
      {showImg ? (
        <img src={markSrc} alt="" className="admin-sidebar__logo-img" onError={() => setImgFailed(true)} />
      ) : (
        <span className="admin-sidebar__logo-fallback">{letter}</span>
      )}
    </div>
  );
}

function SidebarBrand({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { branding } = useAdminBranding();
  return (
    <button
      type="button"
      className="admin-sidebar__brand"
      onClick={onToggle}
      title={branding.companyName}
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={open}
    >
      <SidebarBrandMark />
      <span className="admin-sidebar__brand-text">{branding.companyName}</span>
    </button>
  );
}

/** Analytics-style dashboard: panel + line chart + bars + pie + list (line art) */
function IconDashboard() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Main rounded frame */}
        <rect x="5" y="2.5" width="14" height="13.5" rx="2" />
        {/* Line chart — upward trend, four nodes */}
        <path d="M 6.75 11.75 L 8.75 9.75 L 10.75 10.25 L 12.75 7.75" />
        {/* Bar chart — three bars, increasing height */}
        <path d="M 14.75 16.25 V 11.25 M 16.75 16.25 V 9.25 M 18.75 16.25 V 7.25" />
        {/* Pie — circle + three radii (three segments) */}
        <circle cx="6.25" cy="16.75" r="3.65" />
        <path d="M 6.25 16.75 L 9.9 16.75 M 6.25 16.75 L 4.42 13.59 M 6.25 16.75 L 4.42 19.91" />
        {/* List / legend — bullets + lines */}
        <line x1="17.25" y1="5.75" x2="19.75" y2="5.75" />
        <line x1="17.25" y1="7.75" x2="19.75" y2="7.75" />
        <line x1="17.25" y1="9.75" x2="19.75" y2="9.75" />
      </g>
      <circle cx="6.75" cy="11.75" r="1" fill="currentColor" />
      <circle cx="8.75" cy="9.75" r="1" fill="currentColor" />
      <circle cx="10.75" cy="10.25" r="1" fill="currentColor" />
      <circle cx="12.75" cy="7.75" r="1" fill="currentColor" />
      <circle cx="16.25" cy="5.75" r="0.85" fill="currentColor" />
      <circle cx="16.25" cy="7.75" r="0.85" fill="currentColor" />
      <circle cx="16.25" cy="9.75" r="0.85" fill="currentColor" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconCommand() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5" width="17" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 10l2 2-2 2M11.5 15h5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconReports() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" fill="currentColor" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.49-.42h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.09.63-.09.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 17h5l-1.4-1.4c-.39-.39-.6-.9-.6-1.45V11a6 6 0 10-12 0v3.15c0 .55-.21 1.06-.6 1.45L4 17h5m6 0H9m6 0a3 3 0 11-6 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: IconDashboard, end: true },
  { to: "/dashboard/locations", label: "View Location", icon: IconMap, end: false },
  { to: "/dashboard/command", label: "Command Center", icon: IconCommand, end: false },
  { to: "/dashboard/management", label: "Management", icon: IconUsers, end: false },
  { to: "/dashboard/reports", label: "Reports", icon: IconReports, end: false },
  { to: "/dashboard/settings", label: "Settings", icon: IconSettings, end: false },
] as const;

function getTopbarTitle(pathname: string) {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "Dashboard";
  const matched = NAV.find((x) => x.to !== "/dashboard" && pathname.startsWith(x.to));
  return matched?.label ?? "Dashboard";
}

export function AdminLayout() {
  const { logout, user } = useAuth();
  const { branding } = useAdminBranding();
  useSessionTimeout(branding.sessionTimeoutMinutes);
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = () => setSidebarOpen((v) => !v);

  useEffect(() => {
    const href = branding.faviconUrl?.trim();
    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!href) {
      return;
    }
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [branding.faviconUrl]);

  const onSidebarClick: MouseEventHandler<HTMLElement> = (e) => {
    const target = e.target as HTMLElement;
    // Keep normal nav/logout clicks; toggle when clicking other sidebar areas.
    if (target.closest(".admin-nav-link") || target.closest(".admin-sidebar__logout")) return;
    toggleSidebar();
  };

  const onNavClick = (e: MouseEvent<HTMLAnchorElement>, to: string) => {
    // If sidebar is hidden, first click only expands it.
    if (!sidebarOpen) {
      e.preventDefault();
      setSidebarOpen(true);
      return;
    }
    // Hide sidebar when clicking the same active button again.
    if (location.pathname === to) {
      e.preventDefault();
      setSidebarOpen(false);
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-shell__bg" aria-hidden />
      <aside className={"admin-sidebar" + (sidebarOpen ? " admin-sidebar--open" : "")} onClick={onSidebarClick}>
        <SidebarBrand open={sidebarOpen} onToggle={toggleSidebar} />
        <div className="admin-sidebar__divider" aria-hidden />
        <nav className="admin-sidebar__nav" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={(e) => onNavClick(e, to)}
              className={({ isActive }) => "admin-nav-link" + (isActive ? " admin-nav-link--active" : "")}
            >
              <span className="admin-nav-link__icon">
                <Icon />
              </span>
              <span className="admin-nav-link__label">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar__footer">
          <button
            type="button"
            className="admin-sidebar__logout"
            onClick={() => {
              toggleSidebar();
              void logout();
            }}
          >
            <IconLogout />
            <span>Logout</span>
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar__title">{getTopbarTitle(location.pathname)}</div>
          <div className="admin-topbar__right">
            <button type="button" className="admin-topbar__bell" aria-label="Notifications">
              <IconBell />
              <span className="admin-topbar__bell-dot" />
            </button>
            <div className="admin-topbar__identity">
              <div className="admin-topbar__meta-label">
                {user?.rbacRole === "super_admin"
                  ? "Super Admin"
                  : user?.rbacRole === "fleet_manager"
                    ? "Fleet Manager"
                    : user?.rbacRole === "auditor"
                      ? "Auditor"
                      : "Administrator"}
              </div>
              <div className="admin-topbar__meta">{user?.email ?? "Admin"}</div>
            </div>
            <div className="admin-topbar__avatar-wrap" aria-hidden>
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="admin-topbar__avatar" />
              ) : (
                <span className="admin-topbar__avatar-fallback">{(user?.email?.charAt(0) || "A").toUpperCase()}</span>
              )}
            </div>
          </div>
        </header>
        <div className="admin-content">
          <Outlet />
        </div>
      </main>
      <GeofenceBreachAlert />
    </div>
  );
}
