import { useAuth } from "@/context/AuthContext";
import { ManagementHubCard } from "@/components/ManagementHubCard";
import { pushAdminAudit, type AuditLevel } from "@/lib/adminAudit";
import "./DashboardPage.css";
import "./ManagementPage.css";

type HubModule = {
  to: string;
  title: string;
  hint: string;
  icon: string;
  metricA: string;
  metricB: string;
  metricC: string;
};

/** Static hub metrics (demo / MA3 presentation) — same layout as original management cards. */
const MANAGEMENT_MODULES: HubModule[] = [
  {
    to: "passengers",
    title: "Passenger Management",
    hint: "Profiles, tickets, and history",
    icon: "🧾",
    metricA: "2,626",
    metricB: "records",
    metricC: "live",
  },
  {
    to: "buses",
    title: "Bus Management",
    hint: "Fleet health and maintenance",
    icon: "🚌",
    metricA: "0",
    metricB: "fleet",
    metricC: "active",
  },
  {
    to: "attendants",
    title: "Bus Attendant Management",
    hint: "Assignments and shifts",
    icon: "👤",
    metricA: "64",
    metricB: "staff",
    metricC: "on duty",
  },
  {
    to: "drivers",
    title: "Driver Management",
    hint: "Licenses and route assignments",
    icon: "🛞",
    metricA: "112",
    metricB: "drivers",
    metricC: "verified",
  },
  {
    to: "locations",
    title: "Location management",
    hint: "Terminals and stops",
    icon: "📍",
    metricA: "24",
    metricB: "hubs",
    metricC: "mapped",
  },
  {
    to: "routes",
    title: "Route management",
    hint: "Corridors and timetables",
    icon: "🧭",
    metricA: "38",
    metricB: "routes",
    metricC: "optimized",
  },
  {
    to: "fares",
    title: "Fare management",
    hint: "Pricing and rules",
    icon: "💸",
    metricA: "12",
    metricB: "fares",
    metricC: "audited",
  },
  {
    to: "admins",
    title: "Admin management",
    hint: "Portal admins and access",
    icon: "🛡️",
    metricA: "6",
    metricB: "admins",
    metricC: "secured",
  },
];

export function ManagementPage() {
  const { user } = useAuth();

  const logModuleOpen = (label: string) => {
    let level: AuditLevel = "INFO";
    if (label.toLowerCase().includes("fare")) level = "WARNING";
    if (label.toLowerCase().includes("bus")) level = "CRITICAL";
    pushAdminAudit({
      admin: user?.email ?? "admin@local",
      level,
      action: `opened ${label} module`,
    });
  };

  return (
    <div className="admin-mgmt">
      <section aria-label="Management areas">
        <div className="mgmt-module-grid mgmt-module-grid--uverse">
          {MANAGEMENT_MODULES.map((m, i) => (
            <ManagementHubCard
              key={m.to}
              to={`/dashboard/management/${m.to}`}
              title={m.title}
              description={m.hint}
              metricA={m.metricA}
              metricB={m.metricB}
              metricC={m.metricC}
              icon={m.icon}
              variant={i}
              onNavigate={() => logModuleOpen(m.title)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
