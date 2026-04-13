import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ManagementHubCard } from "@/components/ManagementHubCard";
import { fetchManagementHubStats } from "@/lib/api";
import type { ManagementHubStatsDto } from "@/lib/types";
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

const MODULE_BASE: Omit<HubModule, "metricA" | "metricB" | "metricC">[] = [
  {
    to: "passengers",
    title: "Passenger Management",
    hint: "Search, review, and manage passenger profiles and ticket history.",
    icon: "🧾",
  },
  {
    to: "buses",
    title: "Bus Management",
    hint: "Fleet status, ticket load, and preventive maintenance tracking.",
    icon: "🚌",
  },
  {
    to: "attendants",
    title: "Bus Attendant Management",
    hint: "Assign attendants to routes, shifts, and on-board duties.",
    icon: "👤",
  },
  {
    to: "drivers",
    title: "Driver Management",
    hint: "Licenses, assignments, and driver availability.",
    icon: "🛞",
  },
  {
    to: "locations",
    title: "Location management",
    hint: "Terminals, stops, and geographic coverage for corridor routes.",
    icon: "📍",
  },
  {
    to: "routes",
    title: "Route management",
    hint: "Corridors, timetables, and service patterns across the network.",
    icon: "🧭",
  },
  {
    to: "schedules",
    title: "Schedule management",
    hint: "Departure boards, headways, and timetable exceptions by corridor.",
    icon: "🕒",
  },
  {
    to: "fares",
    title: "Fare management",
    hint: "Fare tables, discounts, and payment rules.",
    icon: "💸",
  },
  {
    to: "admins",
    title: "Admin management",
    hint: "Portal administrators, roles, and access policies.",
    icon: "🛡️",
  },
];

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

function buildModules(stats: ManagementHubStatsDto | null): HubModule[] {
  const s = stats;
  const dash = "—";

  return MODULE_BASE.map((b) => {
    switch (b.to) {
      case "passengers":
        return {
          ...b,
          metricA: s ? fmt(s.ticketRecords) : dash,
          metricB: "tickets issued",
          metricC: "MongoDB · live count",
        };
      case "buses":
        return {
          ...b,
          metricA: s ? fmt(s.busesActive) : dash,
          metricB: "active buses",
          metricC: s ? `${fmt(s.busesTotal)} total registered` : dash,
        };
      case "attendants":
        return {
          ...b,
          metricA: s ? fmt(s.attendantsRoster) : dash,
          metricB: "attendants",
          metricC:
            s && s.attendantsOnActiveBuses > 0
              ? `${fmt(s.attendantsOnActiveBuses)} assigned to active buses`
              : "none assigned to active buses",
        };
      case "drivers":
        return {
          ...b,
          metricA: s ? fmt(s.driversVerified) : dash,
          metricB: "drivers",
          metricC: s ? `OTP-verified · ${fmt(s.driversTotal)} active on roster` : dash,
        };
      case "locations":
        return {
          ...b,
          metricA: s ? fmt(s.hubs) : dash,
          metricB: "hubs",
          metricC: "RouteCoverage · terminals & stops",
        };
      case "routes":
        return {
          ...b,
          metricA: s ? fmt(s.routeDefinitions) : dash,
          metricB: "routes",
          metricC:
            s && (s.corridorRoutes > 0 || s.fareRoutes > 0)
              ? `${fmt(s.corridorRoutes)} corridor · ${fmt(s.fareRoutes)} fare-route`
              : "corridor + fare-route documents",
        };
      case "schedules":
        return {
          ...b,
          metricA: s ? fmt(s.tripsPlanned) : dash,
          metricB: "dispatch rows",
          metricC: "planned · today (Manila) · live board",
        };
      case "fares":
        return {
          ...b,
          metricA: s ? fmt(s.faresMatrix) : dash,
          metricB: "fare rows",
          metricC: "FareMatrixEntry · audited in Fare Mgmt",
        };
      case "admins":
        return {
          ...b,
          metricA: s ? fmt(s.adminAccounts) : dash,
          metricB: "admins",
          metricC: "RBAC assignments · portal Admin role",
        };
      default:
        return { ...b, metricA: dash, metricB: "", metricC: "" };
    }
  });
}

export function ManagementPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<ManagementHubStatsDto | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchManagementHubStats();
        if (!cancelled) {
          setStats(data);
          setStatsErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setStats(null);
          setStatsErr(e instanceof Error ? e.message : "Could not load stats");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const modules = useMemo(() => buildModules(stats), [stats]);

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
      {statsErr ? (
        <p className="mgmt-hub-stats-err" role="status">
          {statsErr}
        </p>
      ) : null}
      <section aria-label="Management areas">
        <div className="mgmt-module-grid mgmt-module-grid--uverse">
          {modules.map((m) => (
            <ManagementHubCard
              key={m.to}
              to={`/dashboard/management/${m.to}`}
              title={m.title}
              description={m.hint}
              metricA={m.metricA}
              metricB={m.metricB}
              metricC={m.metricC}
              icon={m.icon}
              onNavigate={() => logModuleOpen(m.title)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
