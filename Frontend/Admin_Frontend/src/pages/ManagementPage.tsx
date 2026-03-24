import { Link } from "react-router-dom";
import "./DashboardPage.css";
import "./ManagementPage.css";

const MANAGEMENT_MODULES = [
  { to: "passengers", label: "Passenger Management", hint: "Profiles, tickets, and history" },
  { to: "buses", label: "Bus Management", hint: "Fleet health and maintenance" },
  { to: "attendants", label: "Bus Attendant Management", hint: "Assignments and shifts" },
  { to: "drivers", label: "Driver Management", hint: "Licenses and route assignments" },
  { to: "locations", label: "Location management", hint: "Terminals and stops" },
  { to: "routes", label: "Route management", hint: "Corridors and timetables" },
  { to: "fares", label: "Fare management", hint: "Pricing and rules" },
  { to: "admins", label: "Admin management", hint: "Portal admins and access" },
] as const;

export function ManagementPage() {
  return (
    <div className="admin-mgmt">
      <header className="dash-topbar">
        <div>
          <h1 className="dash-topbar__title">Operations &amp; management</h1>
          <p className="dash-topbar__sub">Open a module to manage passengers, staff, routes, fares, and admins.</p>
        </div>
      </header>

      <section aria-label="Management areas">
        <h2 className="dash-h2">Management areas</h2>
        <p className="dash-hint">Open a module to configure passengers, staff, routes, fares, and admins.</p>
        <div className="mgmt-module-grid">
          {MANAGEMENT_MODULES.map((m) => (
            <Link key={m.to} to={`/dashboard/management/${m.to}`} className="mgmt-module-card">
              <span className="mgmt-module-card__label">{m.label}</span>
              <span className="mgmt-module-card__hint">{m.hint}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
