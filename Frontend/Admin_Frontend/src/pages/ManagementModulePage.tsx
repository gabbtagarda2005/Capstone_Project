import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FilterBar } from "@/components/FilterBar";
import { PassengerRecordsTable } from "@/components/PassengerRecordsTable";
import { StatCards } from "@/components/StatCards";
import { api } from "@/lib/api";
import { filterTickets, sumFare, type FilterState } from "@/lib/filterTickets";
import type { TicketRow } from "@/lib/types";
import "./DashboardPage.css";
import "./ManagementModulePage.css";

const MODULE_COPY: Record<
  string,
  {
    title: string;
    subtitle: string;
  }
> = {
  passengers: {
    title: "Passenger Management",
    subtitle: "Search, review, and manage passenger profiles and ticket history.",
  },
  buses: {
    title: "Bus Management",
    subtitle: "Fleet status, ticket load, and preventive maintenance tracking.",
  },
  attendants: {
    title: "Bus Attendant Management",
    subtitle: "Assign attendants to routes, shifts, and on-board duties.",
  },
  drivers: {
    title: "Driver Management",
    subtitle: "Licenses, assignments, and driver availability.",
  },
  locations: {
    title: "Location management",
    subtitle: "Terminals, stops, and geographic coverage for Bukidnon routes.",
  },
  routes: {
    title: "Route management",
    subtitle: "Create and edit routes, timetables, and corridor definitions.",
  },
  fares: {
    title: "Fare management",
    subtitle: "Fare tables, discounts, and payment rules.",
  },
  admins: {
    title: "Admin management",
    subtitle: "Portal administrators, roles, and access policies.",
  },
};

const FARE_HISTORY = [
  { at: "2026-01-01", route: "Malaybalay → Valencia", from: 12, to: 15, by: "Super Admin" },
  { at: "2026-02-14", route: "Valencia → Maramag", from: 15, to: 16, by: "Manager" },
  { at: "2026-03-03", route: "Maramag → Don Carlos", from: 16, to: 18, by: "Super Admin" },
];

const ROUTE_POPULARITY = [
  { route: "dulogon → wdadwad", tickets: 212 },
  { route: "Malaybalay → Valencia", tickets: 171 },
  { route: "Valencia → Maramag", tickets: 128 },
];

const DRIVER_SHIFT_LOGS = [
  { driver: "esfrsef dwadawd awdwad", hours: 46 },
  { driver: "John D. Ramos", hours: 38 },
  { driver: "Luis M. Catindig", hours: 33 },
];

type Stats = { totalTicketCount: number; filteredCount: number; filteredRevenue: number };

function defaultFilter(): FilterState {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = `${y}-${m}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    passengerIdQuery: "",
    preset: "all",
    day,
    month: `${y}-${m}`,
    year: String(y),
    from: "",
    to: "",
  };
}

function PassengerManagementPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [st, list] = await Promise.all([api<Stats>("/api/tickets/stats"), api<{ items: TicketRow[] }>("/api/tickets")]);
        if (!cancelled) {
          setStats(st);
          setTickets(list.items);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load passenger operations");
          setStats(null);
          setTickets([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => filterTickets(tickets, filter), [tickets, filter]);
  const filteredRevenue = sumFare(filtered);
  const frequentTravelers = useMemo(() => {
    const map = new Map<string, number>();
    tickets.forEach((t) => {
      map.set(t.passengerId, (map.get(t.passengerId) ?? 0) + 1);
    });
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([passengerId, trips]) => ({ passengerId, trips }));
  }, [tickets]);

  return (
    <div className="mgmt-passenger-panel">
      <section className="dash-section-gap">
        <h2 className="dash-h2">Live operations</h2>
        <p className="dash-hint">Ticket filters, passenger records, and operator accounts for day-to-day work.</p>
      </section>

      {error ? <p className="dash-error-banner">{error}</p> : null}

      <StatCards totalTicketCount={stats?.totalTicketCount ?? 0} filteredRevenue={filteredRevenue} filteredCount={filtered.length} />
      <FilterBar value={filter} onChange={setFilter} />
      <section>
        <h2 className="dash-h2">Passenger records</h2>
        <p className="dash-hint">Filtered results are shown below. Use filters above to narrow by date or passenger ID.</p>
        <PassengerRecordsTable rows={filtered} />
      </section>

      <section className="dash-section-gap">
        <h2 className="dash-h2">Frequent travelers</h2>
        <p className="dash-hint">Passenger loyalty ranking by total trips issued.</p>
        <ol className="mgmt-mod__rank">
          {frequentTravelers.length === 0 ? <li>No frequent traveler data yet.</li> : null}
          {frequentTravelers.map((p) => (
            <li key={p.passengerId}>
              <span>{p.passengerId}</span>
              <strong>{p.trips} trips</strong>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function BusManagementPanel() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: TicketRow[] }>("/api/tickets");
        if (!cancelled) setTickets(res.items);
      } catch {
        if (!cancelled) setTickets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buses = useMemo(() => {
    const byOperator = new Map<number, number>();
    tickets.forEach((t) => {
      byOperator.set(t.issuedByOperatorId, (byOperator.get(t.issuedByOperatorId) ?? 0) + 1);
    });
    return [...byOperator.entries()]
      .slice(0, 12)
      .map(([busId, issued]) => {
        const status = issued > 1000 ? "Due for Inspection" : issued > 100 ? "Needs Maintenance" : "Active";
        return { busId: String(busId), issued, status };
      });
  }, [tickets]);

  return (
    <section>
      <h2 className="dash-h2">Maintenance tracker</h2>
      <p className="dash-hint">If a bus has issued over 100 tickets, status changes to Needs Maintenance.</p>
      <table className="mgmt-mod__table">
        <thead>
          <tr>
            <th>Bus ID</th>
            <th>Tickets Issued</th>
            <th>Health Status</th>
          </tr>
        </thead>
        <tbody>
          {buses.length === 0 ? (
            <tr>
              <td colSpan={3}>No bus ticket data yet.</td>
            </tr>
          ) : (
            buses.map((b) => (
              <tr key={b.busId}>
                <td>{b.busId}</td>
                <td>{b.issued}</td>
                <td>{b.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}

export function ManagementModulePage() {
  const { moduleId } = useParams();
  const key = moduleId ?? "";
  const copy = MODULE_COPY[key];

  if (!copy) {
    return (
      <div className="admin-mgmt">
        <div className="mgmt-mod">
          <p className="mgmt-mod__unknown">Unknown module.</p>
          <Link to="/dashboard/management" className="mgmt-mod__back">
            ← Back to management
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-mgmt">
      <div className="mgmt-mod">
        <Link to="/dashboard/management" className="mgmt-mod__back">
          ← Back to management
        </Link>
        <header className="mgmt-mod__head">
          <h1 className="mgmt-mod__title">{copy.title}</h1>
          <p className="mgmt-mod__sub">{copy.subtitle}</p>
        </header>
        <div className="mgmt-mod__placeholder">
          {key === "passengers" ? <PassengerManagementPanel /> : null}
          {key === "buses" ? <BusManagementPanel /> : null}

          {key === "fares" ? (
            <>
              <p className="mgmt-mod__block-title">Fare history</p>
              <table className="mgmt-mod__table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Route</th>
                    <th>Change</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {FARE_HISTORY.map((f) => (
                    <tr key={f.at + f.route}>
                      <td>{f.at}</td>
                      <td>{f.route}</td>
                      <td>
                        ₱{f.from.toFixed(2)} → ₱{f.to.toFixed(2)}
                      </td>
                      <td>{f.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {key === "routes" ? (
            <>
              <p className="mgmt-mod__block-title">Route popularity</p>
              <ol className="mgmt-mod__rank">
                {ROUTE_POPULARITY.map((r) => (
                  <li key={r.route}>
                    <span>{r.route}</span>
                    <strong>{r.tickets} tickets</strong>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          {key === "admins" ? (
            <>
              <p className="mgmt-mod__block-title">Permission roles</p>
              <ul className="mgmt-mod__roles">
                <li>
                  <strong>Super Admin</strong> — full access, including operator deletion and fare changes.
                </li>
                <li>
                  <strong>Manager</strong> — can view analytics and reports, but cannot delete operators.
                </li>
              </ul>
              <p className="mgmt-mod__block-title">Auto-backup</p>
              <p>Daily database backup can be scheduled here (email integration hook for backend).</p>
            </>
          ) : null}

          {key === "drivers" ? (
            <>
              <p className="mgmt-mod__block-title">Driver shift logs (weekly)</p>
              <table className="mgmt-mod__table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Total Hours (week)</th>
                  </tr>
                </thead>
                <tbody>
                  {DRIVER_SHIFT_LOGS.map((d) => (
                    <tr key={d.driver}>
                      <td>{d.driver}</td>
                      <td>{d.hours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {key !== "passengers" && key !== "buses" && key !== "drivers" && key !== "fares" && key !== "routes" && key !== "admins" ? (
            <p>Detailed tools for this area will be connected here.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
