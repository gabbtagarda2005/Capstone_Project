import dashboardSidebarIcon from "@/Images/dashboard-sidebar-icon.png";

/** Passenger sidebar dashboard control — matches provided analytics-style artwork. */
export function PassengerSidebarDashboardIcon({ className }: { className?: string }) {
  return (
    <img
      src={dashboardSidebarIcon}
      alt=""
      width={22}
      height={22}
      className={className}
      decoding="async"
      draggable={false}
    />
  );
}
