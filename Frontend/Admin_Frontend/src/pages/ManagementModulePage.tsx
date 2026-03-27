import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { AddAttendantWizard } from "@/components/AddAttendantWizard";
import "@/components/AttendantGlassCard.css";
import { AttendantGlassCard } from "@/components/AttendantGlassCard";
import { DriverGlassCard } from "@/components/DriverGlassCard";
import { EditAttendantModal } from "@/components/EditAttendantModal";
import { AddDriverWizard } from "@/components/AddDriverWizard";
import { AddBusModal, type AddBusFormState } from "@/components/AddBusModal";
import { RouteManagementPanel } from "@/components/RouteManagementPanel";
import { ViewDetailsModal, ViewDetailsDl, ViewDetailsRow } from "@/components/ViewDetailsModal";
import { FareManagementPanel } from "@/components/FareManagementPanel";
import { AdminAuditLogPanel } from "@/components/AdminAuditLogPanel";
import { FilterBar } from "@/components/FilterBar";
import { LiveTicketCards } from "@/components/LiveTicketCards";
import { PassengerBentoStats } from "@/components/PassengerBentoStats";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { filterTickets, sumFare, type FilterState } from "@/lib/filterTickets";
import {
  NOMINATIM_BUKIDNON_VIEWBOX,
  NOMINATIM_FETCH_HEADERS,
  nominatimCompressedLabel,
  searchNominatimBukidnon,
  type NominatimMappedHit,
  type NominatimSearchRow,
} from "@/lib/nominatimBukidnon";
import { LS_DEV_SHOW_TECHNICAL, readLsBool } from "@/lib/settingsPrefs";
import type { AttendantVerifiedSummary, BusRow, DriverSummary, OperatorSummary, TicketRow } from "@/lib/types";
import "./DashboardPage.css";
import "./ManagementModulePage.css";
import "./PassengerManagementPanel.css";

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

function locationSearchMatchesQuery(displayName: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const dl = displayName.toLowerCase();
  if (dl.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return dl.includes(q);
  return tokens.every((t) => dl.includes(t));
}

function LocationMapJump({ jump }: { jump: { lat: number; lng: number; key: number; zoom?: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!jump) return;
    map.flyTo([jump.lat, jump.lng], jump.zoom ?? 15, { duration: 0.85 });
  }, [jump, map]);
  return null;
}

function LocationMapFitBounds({ points, fallbackCenter }: { points: [number, number][]; fallbackCenter: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    const uniq: [number, number][] = [];
    const seen = new Set<string>();
    for (const [la, lo] of points) {
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      const k = `${la.toFixed(5)}|${lo.toFixed(5)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push([la, lo]);
    }
    if (uniq.length === 0) {
      map.flyTo(fallbackCenter, 11, { duration: 0.75 });
      return;
    }
    if (uniq.length === 1) {
      map.flyTo(uniq[0]!, 14, { duration: 0.85 });
      return;
    }
    map.fitBounds(uniq, { padding: [48, 48], maxZoom: 14 });
  }, [points, fallbackCenter, map]);
  return null;
}

function shouldSilenceTicketingUnavailable(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("mysql not configured") ||
    m.includes("ticketing data unavailable") ||
    // Old/new variants depending on which code path is throwing.
    m.includes("non-json response") ||
    m.includes("received html instead of json") ||
    m.includes("unexpected token '<'") ||
    m.includes("invalid json")
  );
}

/** OTP-verified roster (Mongo) + optional MySQL `bus_operators` not already in registry. */
function mergeAttendantRoster(
  verified: AttendantVerifiedSummary[],
  ticketing: OperatorSummary[] | null
): AttendantVerifiedSummary[] {
  const byEmail = new Map<string, AttendantVerifiedSummary>();
  for (const v of verified) {
    byEmail.set(v.email.trim().toLowerCase(), { ...v, otpVerified: true });
  }
  if (ticketing) {
    for (const o of ticketing) {
      const key = o.email.trim().toLowerCase();
      if (byEmail.has(key)) continue;
      byEmail.set(key, {
        operatorId: String(o.operatorId),
        firstName: o.firstName,
        lastName: o.lastName,
        middleName: o.middleName,
        email: o.email,
        phone: o.phone,
        role: o.role,
        otpVerified: Boolean(o.otpVerified),
        profileImageUrl: null,
      });
    }
  }
  return Array.from(byEmail.values()).sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName);
    return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName);
  });
}

function PassengerManagementPanel() {
  const { showError } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [filter, setFilter] = useState<FilterState>(defaultFilter);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [st, list] = await Promise.all([api<Stats>("/api/tickets/stats"), api<{ items: TicketRow[] }>("/api/tickets")]);
        if (!cancelled) {
          setStats(st);
          setTickets(list.items);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load passenger operations";
          if (shouldSilenceTicketingUnavailable(msg)) {
            setStats(null);
            setTickets([]);
            return;
          }
          showError(msg);
          setStats(null);
          setTickets([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showError]);

  const filtered = useMemo(() => filterTickets(tickets, filter), [tickets, filter]);
  const filteredRevenue = sumFare(filtered);
  const showFrequentTravelers = stats !== null && tickets.length > 0;
  const frequentTravelers = useMemo(() => {
    const DEMO_NAMES = [
      "Maria Reyes",
      "John Ramos",
      "Luis Catindig",
      "Ana Bautista",
      "Carlos Sarmiento",
      "Elena Dela Cruz",
      "Miguel Omblero",
      "Rosa Valencia",
      "Pedro Maramag",
      "Grace Malaybalay",
      "Daniel Dulogan",
      "Sofia Don Carlos",
    ];
    function hashPid(pid: string) {
      let h = 0;
      for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) >>> 0;
      return h;
    }
    function tierForTrips(trips: number): "gold" | "silver" | "bronze" | "standard" {
      if (trips >= 100) return "gold";
      if (trips >= 40) return "silver";
      if (trips >= 15) return "bronze";
      return "standard";
    }
    function loyaltyTierText(t: ReturnType<typeof tierForTrips>) {
      const map = { gold: "Gold", silver: "Silver", bronze: "Bronze", standard: "Standard" } as const;
      return `Loyalty Tier: ${map[t]}`;
    }
    const map = new Map<string, { trips: number; revenue: number }>();
    tickets.forEach((t) => {
      const cur = map.get(t.passengerId) ?? { trips: 0, revenue: 0 };
      cur.trips += 1;
      cur.revenue += t.fare;
      map.set(t.passengerId, cur);
    });
    return [...map.entries()]
      .sort((a, b) => b[1].trips - a[1].trips)
      .slice(0, 8)
      .map(([passengerId, { trips, revenue }]) => {
        const tier = tierForTrips(trips);
        const displayName = DEMO_NAMES[hashPid(passengerId) % DEMO_NAMES.length]!;
        const avgFare = trips > 0 ? revenue / trips : 0;
        return { passengerId, trips, displayName, tier, tierLabel: loyaltyTierText(tier), avgFare };
      });
  }, [tickets]);

  return (
    <div className="mgmt-passenger-panel">
      <section>
        <h2 className="passenger-section__title">Live operations</h2>
        <PassengerBentoStats
          totalTicketCount={stats?.totalTicketCount ?? 0}
          filteredRevenue={filteredRevenue}
          filteredCount={filtered.length}
        />
        <FilterBar value={filter} onChange={setFilter} variant="glass" />
      </section>

      <section className="passenger-section--spaced">
        <h2 className="passenger-section__title">Live ticketed operations</h2>
        <LiveTicketCards tickets={filtered} />
      </section>

      {showFrequentTravelers ? (
        <section className="passenger-section--spaced">
          <h2 className="passenger-section__title">Frequent travelers</h2>
          <p className="passenger-section__sub">Top passengers by trip count with estimated loyalty tier and average fare.</p>
          <div className="passenger-freq">
            <table className="passenger-freq__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Passenger name</th>
                  <th>Total trips</th>
                  <th>Status</th>
                  <th>Avg. fare</th>
                </tr>
              </thead>
              <tbody>
                {frequentTravelers.map((p, i) => (
                  <tr key={p.passengerId}>
                    <td className="passenger-freq__rank">{i + 1}</td>
                    <td>
                      <div className="passenger-freq__person">
                        <div className="passenger-freq__avatar" aria-hidden>
                          {p.displayName
                            .split(" ")
                            .map((w) => w[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div className="passenger-freq__name-wrap">
                          <span className="passenger-freq__name">{p.displayName}</span>
                          <span className="passenger-freq__id">{p.passengerId}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="passenger-freq__trips">{p.trips} trips</span>
                    </td>
                    <td>
                      <span className={"passenger-freq__tier passenger-freq__tier--" + p.tier}>{p.tierLabel}</span>
                    </td>
                    <td className="passenger-freq__fare">₱{p.avgFare.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DriverManagementPanel() {
  const { showError, showSuccess, showInfo } = useToast();
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [viewingDriver, setViewingDriver] = useState<DriverSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const dRes = await api<{ items: DriverSummary[] }>("/api/drivers");
      setDrivers(dRes.items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load drivers";
      if (!shouldSilenceTicketingUnavailable(msg)) showError(msg);
      setDrivers([]);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function initials(first: string, last: string) {
    const a = first?.[0] ?? "D";
    const b = last?.[0] ?? "R";
    return `${a}${b}`.toUpperCase();
  }

  async function handleDeleteDriver(d: DriverSummary) {
    if (!window.confirm(`Remove ${d.firstName} ${d.lastName} from the fleet roster? They will be hidden from lists.`)) return;
    setDeletingId(d.id);
    try {
      await api(`/api/drivers/${encodeURIComponent(d.id)}`, { method: "DELETE" });
      showSuccess("Driver removed.");
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mgmt-drv-panel">
      <section className="dash-section-gap">
        <div className="mgmt-bus-panel__toolbar mgmt-bus-panel__toolbar--glass">
          <div>
            <h2 className="dash-h2">Fleet drivers</h2>
          </div>
          <button type="button" className="mgmt-bus-panel__cta" onClick={() => setWizardOpen(true)}>
            + Add driver (OTP)
          </button>
        </div>
      </section>

      <section>
        {drivers.length === 0 ? (
          <div className="mgmt-drv-panel__empty">
            <div className="mgmt-drv-panel__empty-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                <path d="M20 20l-4.2-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <p className="mgmt-drv-panel__empty-title">No drivers in MongoDB yet</p>
            <p className="mgmt-drv-panel__empty-sub">Launch the OTP wizard to onboard verified fleet drivers.</p>
          </div>
        ) : (
          <div className="mgmt-att-panel__cards">
            {drivers.map((d) => (
              <DriverGlassCard
                key={d.id}
                driver={d}
                initials={initials(d.firstName, d.lastName)}
                busy={deletingId === d.id}
                onView={() => setViewingDriver(d)}
                onEdit={() =>
                  showInfo("Driver profile editing is coming soon. Use Add driver (OTP) to onboard a replacement if needed.")
                }
                onDelete={() => void handleDeleteDriver(d)}
              />
            ))}
          </div>
        )}
      </section>

      <ViewDetailsModal
        open={Boolean(viewingDriver)}
        title={viewingDriver ? `${viewingDriver.firstName} ${viewingDriver.lastName}`.trim() : ""}
        onClose={() => setViewingDriver(null)}
      >
        {viewingDriver ? (
          <ViewDetailsDl>
            <ViewDetailsRow label="Email" value={viewingDriver.email || "—"} />
            <ViewDetailsRow label="Phone" value={viewingDriver.phone || "—"} />
            <ViewDetailsRow label="Role" value="Driver" />
            <ViewDetailsRow label="Driver ID" value={viewingDriver.driverId} />
            <ViewDetailsRow label="License" value={viewingDriver.licenseNumber || "—"} />
            <ViewDetailsRow
              label="Experience"
              value={
                viewingDriver.yearsExperience != null ? `${viewingDriver.yearsExperience} years` : "—"
              }
            />
            <ViewDetailsRow label="Status" value={viewingDriver.otpVerified ? "Verified" : "Legacy"} />
          </ViewDetailsDl>
        ) : null}
      </ViewDetailsModal>

      <AddDriverWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onSaved={() => void refresh()} />
    </div>
  );
}

function AttendantManagementPanel() {
  const { showError, showSuccess } = useToast();
  const [operators, setOperators] = useState<AttendantVerifiedSummary[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AttendantVerifiedSummary | null>(null);
  const [viewingAtt, setViewingAtt] = useState<AttendantVerifiedSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    let verified: AttendantVerifiedSummary[] = [];
    try {
      const vRes = await api<{ items: AttendantVerifiedSummary[] }>("/api/attendants/verified");
      verified = vRes.items;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load verified attendants";
      if (!shouldSilenceTicketingUnavailable(msg)) showError(msg);
    }

    let ticketing: OperatorSummary[] | null = null;
    try {
      const oRes = await api<{ items: OperatorSummary[] }>("/api/operators");
      ticketing = oRes.items;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg && !shouldSilenceTicketingUnavailable(msg)) showError(msg);
    }

    setOperators(mergeAttendantRoster(verified, ticketing));
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function initials(first: string, last: string, middle: string | null) {
    const a = first?.[0] ?? "A";
    const b = last?.[0] ?? middle?.[0] ?? "T";
    return `${a}${b}`.toUpperCase();
  }

  async function persistAttendantEdit(
    a: AttendantVerifiedSummary,
    payload: { firstName: string; lastName: string; middleName: string; phone: string }
  ) {
    const id = a.operatorId;
    const body = {
      firstName: payload.firstName,
      lastName: payload.lastName,
      middleName: payload.middleName ? payload.middleName : null,
      phone: payload.phone ? payload.phone : null,
    };
    if (a.otpVerified) {
      await api(`/api/attendants/registry/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
      return;
    }
    if (/^\d+$/.test(id)) {
      await api(`/api/operators/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
      return;
    }
    throw new Error("This profile cannot be edited here.");
  }

  async function handleDeleteAttendant(a: AttendantVerifiedSummary) {
    if (!window.confirm(`Remove ${a.firstName} ${a.lastName} from the roster? This cannot be undone.`)) return;
    setDeletingId(a.operatorId);
    try {
      await api(`/api/attendants/registry/${encodeURIComponent(a.operatorId)}`, { method: "DELETE" });
      showSuccess("Attendant removed.");
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mgmt-att-panel">
      <section className="dash-section-gap">
        <div className="mgmt-bus-panel__toolbar mgmt-bus-panel__toolbar--glass">
          <div>
            <h2 className="dash-h2">Attendant roster</h2>
          </div>
          <div className="mgmt-att-panel__actions">
            <button type="button" className="mgmt-bus-panel__cta" onClick={() => setWizardOpen(true)}>
              + Add attendant (OTP)
            </button>
          </div>
        </div>
      </section>

      <section>
        {operators.length === 0 ? (
          <div className="mgmt-att-panel__empty">
            <div className="mgmt-att-panel__empty-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="5" y="3" width="14" height="18" rx="3" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="12" cy="9" r="2.3" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8.8 16.2c.9-1.6 2.1-2.3 3.2-2.3 1.1 0 2.3.7 3.2 2.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <p className="mgmt-att-panel__empty-title">No verified attendants found</p>
            <p className="mgmt-att-panel__empty-sub">
              Use <strong>Add attendant (OTP)</strong> to onboard someone — they appear here as soon as they are saved (Mongo). MySQL ticketing is optional
              and adds legacy operators from <code>bus_operators</code> when configured.
            </p>
          </div>
        ) : (
          <div className="mgmt-att-panel__cards">
            {operators.map((o) => (
              <AttendantGlassCard
                key={`${o.operatorId}-${o.email}`}
                attendant={o}
                initials={initials(o.firstName, o.lastName, o.middleName)}
                busy={deletingId === o.operatorId}
                onView={() => setViewingAtt(o)}
                onEdit={() => setEditing(o)}
                onDelete={() => void handleDeleteAttendant(o)}
              />
            ))}
          </div>
        )}
      </section>

      <EditAttendantModal
        attendant={editing}
        onClose={() => setEditing(null)}
        onSave={async (payload) => {
          if (!editing) return;
          try {
            await persistAttendantEdit(editing, payload);
            showSuccess("Attendant updated.");
            await refresh();
          } catch (e) {
            showError(e instanceof Error ? e.message : "Update failed");
            throw e;
          }
        }}
      />

      <ViewDetailsModal
        open={Boolean(viewingAtt)}
        title={viewingAtt ? `${viewingAtt.firstName} ${viewingAtt.lastName}`.trim() : ""}
        onClose={() => setViewingAtt(null)}
      >
        {viewingAtt ? (
          <ViewDetailsDl>
            <ViewDetailsRow label="Email" value={viewingAtt.email} />
            <ViewDetailsRow label="Phone" value={viewingAtt.phone || "—"} />
            <ViewDetailsRow
              label="Role"
              value={viewingAtt.role === "Operator" ? "Bus attendant" : viewingAtt.role}
            />
            <ViewDetailsRow label="Middle name" value={viewingAtt.middleName || "—"} />
            <ViewDetailsRow label="Operator ID" value={viewingAtt.operatorId} />
            <ViewDetailsRow label="Status" value={viewingAtt.otpVerified ? "Verified" : "Legacy"} />
          </ViewDetailsDl>
        ) : null}
      </ViewDetailsModal>

      <AddAttendantWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onSaved={() => void refresh()} />
    </div>
  );
}

function LocationManagementPanel() {
  const { showError, showSuccess, showInfo } = useToast();
  type PickupStop = {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    sequence: number;
    pickupOnly: boolean;
  };

  type CoverageDoc = {
    _id: string;
    updatedAt?: string;
    locationName: string;
    pointType: "terminal" | "stop";
    terminal: {
      name: string;
      latitude: number;
      longitude: number;
      geofenceRadiusM?: number;
      pickupOnly?: boolean;
    };
    stops: Array<{
      name: string;
      latitude: number;
      longitude: number;
      sequence: number;
      geofenceRadiusM?: number;
      pickupOnly?: boolean;
    }>;
  };
  type GeoSuggestion = {
    id: string;
    label: string;
    lat: number;
    lng: number;
    /** Full Nominatim display line (tooltip / secondary) */
    detail?: string;
  };

  const [name, setName] = useState("");
  const [terminalName, setTerminalName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [saving, setSaving] = useState(false);
  const [mapJumpTo, setMapJumpTo] = useState<{ lat: number; lng: number; key: number; zoom?: number } | null>(null);
  const [viewLocation, setViewLocation] = useState<{ id: string; name: string; lat: number; lng: number } | null>(
    null
  );

  const [coverageDocs, setCoverageDocs] = useState<CoverageDoc[]>([]);
  const [, setCoverageLoading] = useState(false);
  const [locationAcOpen, setLocationAcOpen] = useState(false);
  const [terminalAcOpen, setTerminalAcOpen] = useState(false);
  const [hubId, setHubId] = useState<string | null>(null);
  const [terminalRadiusM, setTerminalRadiusM] = useState("500");
  const [globalPickupOnly, setGlobalPickupOnly] = useState(true);
  const [locationSearchSuggestions, setLocationSearchSuggestions] = useState<GeoSuggestion[]>([]);
  const [terminalSearchSuggestions, setTerminalSearchSuggestions] = useState<GeoSuggestion[]>([]);

  const [stopSearch, setStopSearch] = useState("");
  const [stopAcOpen, setStopAcOpen] = useState(false);
  const [selectedStops, setSelectedStops] = useState<PickupStop[]>([]);
  const [stopSearchSuggestions, setStopSearchSuggestions] = useState<GeoSuggestion[]>([]);
  type MapPin = { lat: number; lng: number; label: string };
  const [pickedLocationPin, setPickedLocationPin] = useState<MapPin | null>(null);
  const [pickedTerminalPin, setPickedTerminalPin] = useState<MapPin | null>(null);

  const [coordsLockedFromPlaces, setCoordsLockedFromPlaces] = useState(false);
  const [coordsPulse, setCoordsPulse] = useState(false);
  const coordsPulseTimerRef = useRef<number | null>(null);

  const triggerCoordsPulse = useCallback(() => {
    if (coordsPulseTimerRef.current != null) window.clearTimeout(coordsPulseTimerRef.current);
    setCoordsPulse(true);
    coordsPulseTimerRef.current = window.setTimeout(() => {
      setCoordsPulse(false);
      coordsPulseTimerRef.current = null;
    }, 900);
  }, []);

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const hasValidCoords =
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    Math.abs(latNum) <= 90 &&
    Math.abs(lngNum) <= 180 &&
    !(latNum === 0 && lngNum === 0);

  const GENERIC_TERMINAL_QUERY_WORDS = new Set(["terminal", "bus", "station", "transport", "stop", "poi"]);

  function meaningfulTerminalTokens(rawQuery: string): string[] {
    const q = rawQuery.trim().toLowerCase();
    return q.split(/\s+/).filter((t) => t.length >= 2 && !GENERIC_TERMINAL_QUERY_WORDS.has(t));
  }

  function tokensMatchHay(hay: string, rawQuery: string): boolean {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return true;
    const tokens = meaningfulTerminalTokens(rawQuery);
    if (tokens.length === 0) return hay.includes(q);
    return tokens.every((t) => hay.includes(t));
  }

  const terminalSuggestions = useMemo(() => {
    const terminalQ = terminalName.trim().toLowerCase();
    if (coverageDocs.length === 0) return [];
    return coverageDocs
      .filter((c) => {
        const loc = String(c.locationName || "").toLowerCase();
        const term = String(c.terminal?.name || "").toLowerCase();
        return tokensMatchHay(`${loc} ${term}`, terminalQ);
      })
      .slice(0, 10);
  }, [terminalName, coverageDocs]);

  /** Coverage rows that match the *Search Location* query only (never show unrelated terminals). */
  const locationCoverageMatches = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q || coverageDocs.length === 0) return [];
    return coverageDocs
      .filter((c) => {
        const loc = String(c.locationName || "").toLowerCase();
        const term = String(c.terminal?.name || "").toLowerCase();
        return loc.includes(q) || term.includes(q);
      })
      .slice(0, 10);
  }, [name, coverageDocs]);

  const selectedHub = useMemo(() => coverageDocs.find((c) => c._id === hubId) ?? null, [coverageDocs, hubId]);

  const recentDeployedDisplay = useMemo(() => {
    return coverageDocs
      .filter((c) => Number.isFinite(c.terminal?.latitude) && Number.isFinite(c.terminal?.longitude))
      .slice(0, 4)
      .map((c) => ({
        id: c._id,
        // Card title = main hub address (locationName), not the terminal label.
        name: String(c.locationName || "Location"),
        lat: Number(c.terminal!.latitude),
        lng: Number(c.terminal!.longitude),
      }));
  }, [coverageDocs]);

  const safeHubStops = useMemo(() => {
    const raw = selectedHub?.stops;
    if (!Array.isArray(raw)) return [] as CoverageDoc["stops"];
    return raw.filter(
      (s) =>
        Boolean(s) &&
        typeof s.name === "string" &&
        s.name.trim().length > 0 &&
        Number.isFinite(s.latitude) &&
        Number.isFinite(s.longitude)
    );
  }, [selectedHub]);
  const stopLocalSuggestions = useMemo(() => {
    const q = stopSearch.trim().toLowerCase();
    if (!q) return [] as GeoSuggestion[];
    // Local fallback from known coverage docs (safe in this module).
    const flattened = coverageDocs.flatMap((c) =>
      Array.isArray(c.stops)
        ? c.stops.map((s, i) => ({
            id: `local-stop-${c._id}-${i}-${s.name}`,
            label: s.name,
            lat: Number(s.latitude),
            lng: Number(s.longitude),
          }))
        : []
    );
    return flattened
      .filter((s) => s.label.toLowerCase().includes(q) && Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .slice(0, 8);
  }, [stopSearch, coverageDocs]);
  const stopSuggestions = useMemo(() => {
    const q = stopSearch.trim().toLowerCase();
    if (!q) return [] as CoverageDoc["stops"];
    return safeHubStops.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 10);
  }, [safeHubStops, stopSearch]);
  const terminalLocalSuggestions = useMemo(() => {
    const q = terminalName.trim();
    if (!q) return [] as GeoSuggestion[];
    return coverageDocs
      .map((c) => ({
        id: `local-terminal-${c._id}`,
        label: c.locationName || c.terminal?.name || "Location",
        lat: Number(c.terminal?.latitude),
        lng: Number(c.terminal?.longitude),
      }))
      .filter((t) => tokensMatchHay(t.label.toLowerCase(), q) && Number.isFinite(t.lat) && Number.isFinite(t.lng))
      .slice(0, 8);
  }, [terminalName, coverageDocs]);
  const terminalScopedSuggestion = useMemo(() => {
    const q = terminalName.trim().toLowerCase();
    const base = name.trim();
    if (!q || !base || !hasValidCoords) return [] as GeoSuggestion[];
    const primary = base.split(",")[0]?.trim();
    if (!primary) return [] as GeoSuggestion[];
    const baseLower = base.toLowerCase();
    const candidate = baseLower.includes("city") || baseLower.includes("municipality")
      ? `${primary} Integrated Terminal`
      : `${primary} Bus Terminal`;
    // Show this scoped synthetic terminal when query is empty or matches the selected place.
    if (q && !candidate.toLowerCase().includes(q) && !primary.toLowerCase().includes(q)) return [] as GeoSuggestion[];
    return [{ id: `scoped-terminal-${primary.toLowerCase()}`, label: candidate, lat: latNum, lng: lngNum }];
  }, [terminalName, name, hasValidCoords, latNum, lngNum]);

  function compressAddress(address: string): string {
    if (!address) return "";
    const parts = address
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length > 2 ? `${parts[0]}, ${parts[1]}` : address;
  }

  const mergedLocationSuggestions = useMemo(() => {
    const fromCoverage = locationCoverageMatches.map((c) => ({
      id: `cov-${c._id}`,
      label: compressAddress(c.terminal?.name ?? c.locationName),
      detail: c.locationName,
      lat: c.terminal.latitude,
      lng: c.terminal.longitude,
    }));
    const fromGeo = locationSearchSuggestions;
    const seen = new Set<string>();
    const out: GeoSuggestion[] = [];
    [...fromCoverage, ...fromGeo].forEach((s) => {
      const key = `${s.label.toLowerCase()}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    });
    return out.slice(0, 10);
  }, [locationCoverageMatches, locationSearchSuggestions]);
  const mergedTerminalSuggestions = useMemo(() => {
    const fromCoverage = terminalSuggestions.map((c) => ({
      id: `cov-terminal-${c._id}`,
      label: compressAddress(c.locationName || c.terminal?.name || "Location"),
      detail: c.locationName || c.terminal?.name,
      lat: c.terminal.latitude,
      lng: c.terminal.longitude,
    }));
    const seen = new Set<string>();
    const out: GeoSuggestion[] = [];
    [...terminalScopedSuggestion, ...fromCoverage, ...terminalSearchSuggestions, ...terminalLocalSuggestions].forEach((s) => {
      const key = `${s.label.toLowerCase()}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    });
    return out.slice(0, 14);
  }, [terminalScopedSuggestion, terminalSuggestions, terminalSearchSuggestions, terminalLocalSuggestions]);

  const totalRouteKm = useMemo(() => {
    if (!hasValidCoords || selectedStops.length === 0) return 0;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const metersBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const R = 6371e3;
      const p1 = toRad(aLat);
      const p2 = toRad(bLat);
      const dp = toRad(bLat - aLat);
      const dl = toRad(bLng - aLng);
      const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };
    let totalM = 0;
    let prevLat = latNum;
    let prevLng = lngNum;
    [...selectedStops]
      .sort((a, b) => a.sequence - b.sequence)
      .forEach((s) => {
        totalM += metersBetween(prevLat, prevLng, s.latitude, s.longitude);
        prevLat = s.latitude;
        prevLng = s.longitude;
      });
    return totalM / 1000;
  }, [hasValidCoords, latNum, lngNum, selectedStops]);

  const mapFallbackCenter: [number, number] = useMemo(() => {
    if (hasValidCoords) return [latNum, lngNum];
    if (pickedLocationPin) return [pickedLocationPin.lat, pickedLocationPin.lng];
    return [7.9072, 125.0928];
  }, [hasValidCoords, latNum, lngNum, pickedLocationPin]);

  const mapFitPoints = useMemo(() => {
    const pts: [number, number][] = [];
    if (pickedLocationPin) {
      let la = pickedLocationPin.lat;
      let lo = pickedLocationPin.lng;
      if (
        hasValidCoords &&
        Math.abs(pickedLocationPin.lat - latNum) < 1e-5 &&
        Math.abs(pickedLocationPin.lng - lngNum) < 1e-5
      ) {
        la += 0.00028;
        lo -= 0.00028;
      }
      pts.push([la, lo]);
    }
    if (hasValidCoords) pts.push([latNum, lngNum]);
    selectedStops.forEach((s) => {
      if (Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) pts.push([s.latitude, s.longitude]);
    });
    coverageDocs.forEach((c) => {
      const la = c.terminal?.latitude;
      const lo = c.terminal?.longitude;
      if (Number.isFinite(la) && Number.isFinite(lo)) pts.push([la, lo]);
    });
    return pts;
  }, [pickedLocationPin, hasValidCoords, latNum, lngNum, selectedStops, coverageDocs]);

  const mapCoordDisplay = useMemo(() => {
    if (hasValidCoords) return { lat: latNum, lng: lngNum };
    if (pickedLocationPin) return { lat: pickedLocationPin.lat, lng: pickedLocationPin.lng };
    return { lat: 7.9072, lng: 125.0928 };
  }, [hasValidCoords, latNum, lngNum, pickedLocationPin]);

  const mapPinsActive = hasValidCoords || pickedLocationPin !== null || selectedStops.length > 0;

  function filterMappedTerminalHits(hits: NominatimMappedHit[], rawQuery: string): NominatimMappedHit[] {
    if (!Array.isArray(hits) || hits.length === 0) return [];
    const q = rawQuery.trim().toLowerCase();
    const tokens = meaningfulTerminalTokens(rawQuery);
    const withCoords = hits.filter(
      (h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && String(h.detail || h.label || "").trim().length > 0
    );
    if (withCoords.length === 0) return [];
    const labelOk = (text: string) => {
      const label = text.toLowerCase();
      if (tokens.length === 0) return q.length < 2 || label.includes(q);
      return tokens.every((t) => label.includes(t));
    };
    const ranked = withCoords.filter((h) => labelOk(String(h.detail || h.label || "").toLowerCase()));
    if (ranked.length > 0) return ranked.slice(0, 12);
    const first = tokens[0] ?? q;
    if (first.length >= 2) {
      return withCoords.filter((h) => String(h.detail || h.label || "").toLowerCase().includes(first)).slice(0, 12);
    }
    return withCoords.slice(0, 10);
  }

  const loadCoverageDocs = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const cov = await api<{ items: CoverageDoc[] }>("/api/locations/coverage");
      setCoverageDocs(cov.items);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load location coverage");
    } finally {
      setCoverageLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadCoverageDocs();
  }, [loadCoverageDocs]);

  useEffect(() => {
    const q = name.trim();
    if (q.length < 2) {
      setLocationSearchSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const hits = await searchNominatimBukidnon(q, ctl.signal);
        setLocationSearchSuggestions(
          hits
            .filter((h) => locationSearchMatchesQuery(h.detail || h.label, q))
            .map((h) => ({ id: h.id, label: h.label, lat: h.lat, lng: h.lng, detail: h.detail }))
        );
      } catch {
        /* network suggestions are optional */
      }
    }, 220);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [name]);

  useEffect(() => {
    const q = terminalName.trim();
    if (q.length < 1) {
      setTerminalSearchSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const ctx = name.trim();
    const t = window.setTimeout(async () => {
      const queryVariants = [
        ctx ? `${q} ${ctx} bus terminal` : `${q} bus terminal`,
        ctx ? `${q} ${ctx}` : q,
        q,
      ];
      try {
        for (const queryText of queryVariants) {
          if (ctl.signal.aborted) return;
          const hits = await searchNominatimBukidnon(queryText, ctl.signal);
          const picked = filterMappedTerminalHits(hits, q);
          if (picked.length > 0) {
            setTerminalSearchSuggestions(
              picked.map((h) => ({ id: h.id, label: h.label, lat: h.lat, lng: h.lng, detail: h.detail }))
            );
            return;
          }
        }
        setTerminalSearchSuggestions([]);
      } catch {
        setTerminalSearchSuggestions([]);
      }
    }, 220);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [terminalName, name]);

  useEffect(() => {
    const q = stopSearch.trim();
    if (q.length < 1) {
      setStopSearchSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const scoped = selectedHub?.locationName ? `${q} ${selectedHub.locationName} bus stop point of interest` : `${q} bus stop point of interest`;
        const vb = NOMINATIM_BUKIDNON_VIEWBOX;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=ph&viewbox=${vb}&bounded=1&q=${encodeURIComponent(scoped)}`;
        const res = await fetch(url, { signal: ctl.signal, headers: NOMINATIM_FETCH_HEADERS });
        if (!res.ok) return;
        const rows = (await res.json()) as NominatimSearchRow[];
        let filtered = rows.filter((r) => {
          const label = String(r.display_name || "").toLowerCase();
          const cls = String(r.class || "").toLowerCase();
          const typ = String(r.type || "").toLowerCase();
          const addrType = String(r.addresstype || "").toLowerCase();
          const isStopLike =
            ["bus_stop", "platform", "halt", "stop_position", "transport_stop", "stop"].includes(typ) ||
            (cls === "highway" && ["bus_stop", "platform", "stop"].includes(typ)) ||
            cls === "public_transport" ||
            ["bus_stop", "platform", "stop_position", "stop", "transport_stop"].includes(addrType) ||
            label.includes("bus stop") ||
            label.includes("jeepney stop") ||
            /\bstop\b/.test(label);
          return isStopLike;
        });
        // Fallback pass for sparse areas: keep explicit stop text matches from raw rows.
        if (filtered.length === 0) {
          filtered = rows.filter((r) => /\b(bus stop|jeepney stop|terminal stop|stop)\b/i.test(String(r.display_name || "")));
        }
        // Last fallback: allow local place matches so suggestions are not empty while typing.
        if (filtered.length === 0) {
          const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=ph&viewbox=${vb}&bounded=1&q=${encodeURIComponent(
            selectedHub?.locationName ? `${q} ${selectedHub.locationName}` : q
          )}`;
          const fallbackRes = await fetch(fallbackUrl, { signal: ctl.signal, headers: NOMINATIM_FETCH_HEADERS });
          if (fallbackRes.ok) {
            filtered = (await fallbackRes.json()) as NominatimSearchRow[];
          }
        }
        setStopSearchSuggestions(
          filtered
            .map((r) => ({
              id: `stop-${r.place_id}`,
              label: nominatimCompressedLabel(r),
              detail: String(r.display_name || "").trim(),
              lat: Number(r.lat),
              lng: Number(r.lon),
            }))
            .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && String(r.label || "").trim().length > 0)
        );
      } catch {
        /* optional */
      }
    }, 220);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [stopSearch, selectedHub?.locationName]);

  function onPickTerminalSuggestion(cov: CoverageDoc) {
    const termName = cov.terminal?.name ?? cov.locationName;
    setCoordsLockedFromPlaces(false);
    setTerminalName(termName);
    setLat(String(cov.terminal.latitude));
    setLng(String(cov.terminal.longitude));
    setTerminalRadiusM(String(Number(cov.terminal.geofenceRadiusM || 500)));
    setPickedTerminalPin({
      lat: cov.terminal.latitude,
      lng: cov.terminal.longitude,
      label: termName,
    });

    setLocationAcOpen(false);
    setTerminalAcOpen(false);

    setHubId(cov._id);
    setSelectedStops([]);
    setStopSearch("");
    setStopAcOpen(false);
    triggerCoordsPulse();
    setMapJumpTo({ lat: cov.terminal.latitude, lng: cov.terminal.longitude, key: Date.now(), zoom: 18 });
  }

  /** Load a saved coverage hub into the form (same fields as picking from Search). */
  function loadCoverageIntoForm(cov: CoverageDoc) {
    const termName = cov.terminal?.name ?? cov.locationName;
    setCoordsLockedFromPlaces(false);
    setName(cov.locationName);
    setTerminalName(termName);
    setLat(String(cov.terminal.latitude));
    setLng(String(cov.terminal.longitude));
    setTerminalRadiusM(String(Number(cov.terminal.geofenceRadiusM || 500)));
    setPickedTerminalPin({
      lat: cov.terminal.latitude,
      lng: cov.terminal.longitude,
      label: termName,
    });
    setPickedLocationPin({
      lat: cov.terminal.latitude,
      lng: cov.terminal.longitude,
      label: cov.locationName,
    });
    setHubId(cov._id);
    const nextStops: PickupStop[] = (Array.isArray(cov.stops) ? cov.stops : []).map((s) => ({
      id: `cov-${cov._id}-${s.sequence}-${s.name}`,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      sequence: s.sequence,
      pickupOnly: s.pickupOnly !== false,
    }));
    setSelectedStops(nextStops.sort((a, b) => a.sequence - b.sequence));
    setLocationAcOpen(false);
    setTerminalAcOpen(false);
    setStopSearch("");
    setStopAcOpen(false);
    triggerCoordsPulse();
    setMapJumpTo({ lat: cov.terminal.latitude, lng: cov.terminal.longitude, key: Date.now(), zoom: 18 });
    showInfo("Loaded into the form above — change fields and save to update this location.");
  }

  function onPickGeoTerminal(s: GeoSuggestion) {
    setCoordsLockedFromPlaces(true);
    // Keep "Search Location" as selected by admin; only fill terminal field + coordinates.
    setTerminalName(s.label);
    setLat(String(s.lat));
    setLng(String(s.lng));
    setPickedTerminalPin({ lat: s.lat, lng: s.lng, label: s.label });
    setTerminalAcOpen(false);
    triggerCoordsPulse();
    setMapJumpTo({ lat: s.lat, lng: s.lng, key: Date.now(), zoom: 18 });
  }

  function onPickGeoLocation(s: GeoSuggestion) {
    setCoordsLockedFromPlaces(true);
    setName(s.label);
    // Intentionally do NOT auto-fill "Search terminal".
    // Admin must type terminal explicitly after selecting a location.
    setLat(String(s.lat));
    setLng(String(s.lng));
    setPickedLocationPin({ lat: s.lat, lng: s.lng, label: s.label });
    setPickedTerminalPin(null);
    setLocationAcOpen(false);
    setHubId(null);
    triggerCoordsPulse();
    setMapJumpTo({ lat: s.lat, lng: s.lng, key: Date.now(), zoom: 18 });
  }

  function addStopFromSuggestion(s: CoverageDoc["stops"][number]) {
    if (!selectedHub) return;
    setSelectedStops((prev) => {
      const exists = prev.some((p) => p.name === s.name && p.sequence === s.sequence && p.latitude === s.latitude && p.longitude === s.longitude);
      if (exists) return prev;
      return [
        ...prev,
        {
          id: `cov-${selectedHub._id}-${s.sequence}-${s.name}`,
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          sequence: s.sequence,
          pickupOnly: globalPickupOnly,
        },
      ].sort((a, b) => a.sequence - b.sequence);
    });
    setStopSearch("");
    setStopAcOpen(false);
  }

  function addStopFromGeoSuggestion(s: GeoSuggestion) {
    setSelectedStops((prev) => {
      const exists = prev.some((p) => p.name === s.label && p.latitude === s.lat && p.longitude === s.lng);
      if (exists) return prev;
      const maxSeq = prev.reduce((m, x) => Math.max(m, x.sequence), 0);
      return [
        ...prev,
        {
          id: `geo-${s.id}`,
          name: s.label,
          latitude: s.lat,
          longitude: s.lng,
          sequence: maxSeq + 1,
          pickupOnly: globalPickupOnly,
        },
      ];
    });
    setStopSearch("");
    setStopAcOpen(false);
  }

  function removeSelectedStop(stopId: string) {
    setSelectedStops((prev) => prev.filter((s) => s.id !== stopId));
  }

  function setAllStopsPickupOnly(next: boolean) {
    setGlobalPickupOnly(next);
    setSelectedStops((prev) => prev.map((s) => ({ ...s, pickupOnly: next })));
  }

  async function handleDeleteCoverage(coverageId: string) {
    if (!window.confirm("Remove this deployed terminal and its saved route coverage?")) return;
    try {
      await api(`/api/locations/coverage/${coverageId}`, { method: "DELETE" });
      showSuccess("Location coverage removed");
      if (hubId === coverageId) {
        setHubId(null);
        setSelectedStops([]);
      }
      void loadCoverageDocs();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to delete coverage");
    }
  }

  async function handleSavePoint() {
    const mainLocationLabel = name.trim();
    const terminalLabel = terminalName.trim();
    const locationNameForDoc = mainLocationLabel || terminalLabel;
    const terminalNameForDoc = terminalLabel || mainLocationLabel;
    if (!locationNameForDoc || !terminalNameForDoc) {
      showError("Enter Search location and/or Search terminal, then pick coordinates.");
      return;
    }
    if (!hasValidCoords) {
      showError("Enter valid latitude/longitude coordinates (or pick a suggestion).");
      return;
    }

    setSaving(true);
    try {
      const radiusNum = Number(terminalRadiusM);
      await api("/api/locations/coverage", {
        method: "POST",
        json: {
          locationName: locationNameForDoc,
          pointType: "terminal",
          terminal: {
            name: terminalNameForDoc,
            latitude: latNum,
            longitude: lngNum,
            geofenceRadiusM: Number.isFinite(radiusNum) && radiusNum > 0 ? radiusNum : 500,
            pickupOnly: true,
          },
          stops: selectedStops.map((s) => ({
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            sequence: s.sequence,
            geofenceRadiusM: 100,
            pickupOnly: s.pickupOnly,
          })),
        },
      });
      await api("/api/locations", { method: "POST", json: { locationName: locationNameForDoc } }).catch(() => {});
      showSuccess(`Location deployed: ${locationNameForDoc}`);
      void loadCoverageDocs();

      setName("");
      setTerminalName("");
      setLat("");
      setLng("");
      setTerminalRadiusM("500");
      setHubId(null);
      setStopSearch("");
      setSelectedStops([]);
      setGlobalPickupOnly(true);
      setLocationAcOpen(false);
      setTerminalAcOpen(false);
      setStopAcOpen(false);
      setPickedLocationPin(null);
      setPickedTerminalPin(null);
      setCoordsLockedFromPlaces(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to deploy location");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mgmt-loc-panel">
      <div className="mgmt-loc-grid">
        <section className="mgmt-loc-card">
          <h2 className="mgmt-loc-card__title">Register new point</h2>
          <p className="mgmt-loc-policy" style={{ marginTop: "-0.35rem" }}>
            Search uses OpenStreetMap Nominatim (Bukidnon-biased). Pick a row to set the pin, coordinates, and map zoom.
          </p>

          <div className="mgmt-loc-field">
            <span className="mgmt-loc-field__label">Search Location</span>
            <div className="mgmt-loc-ac">
              <input
                className="mgmt-loc-field__input"
                type="text"
                placeholder="Search (e.g. Valencia, Maramag)"
                value={name}
                onChange={(e) => {
                  setCoordsLockedFromPlaces(false);
                  setName(e.target.value);
                  setLocationAcOpen(true);
                }}
                onFocus={() => {
                  if (name.trim().length > 0) setLocationAcOpen(true);
                }}
                onBlur={() => window.setTimeout(() => setLocationAcOpen(false), 120)}
              />

              {name.trim().length > 0 && locationCoverageMatches.length > 0 ? (
                <div className="mgmt-loc-deployed-chips" role="group" aria-label="Deployed locations matching search">
                  {locationCoverageMatches.map((c) => (
                    <button
                      key={c._id}
                      type="button"
                      className="mgmt-loc-chip"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPickTerminalSuggestion(c)}
                    >
                      {compressAddress(c.locationName || c.terminal?.name || "Location")}
                    </button>
                  ))}
                </div>
              ) : null}

              {locationAcOpen && name.trim().length > 0 && mergedLocationSuggestions.length > 0 ? (
                <div className="mgmt-loc-ac__menu" role="listbox" aria-label="Location suggestions">
                  {mergedLocationSuggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="mgmt-loc-ac__item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const cov = locationCoverageMatches.find((x) => `cov-${x._id}` === c.id);
                        if (cov) {
                          onPickTerminalSuggestion(cov);
                        } else {
                          onPickGeoLocation(c);
                        }
                      }}
                    >
                      <div className="mgmt-loc-ac__item-title">{c.label}</div>
                      {c.detail && c.detail !== c.label ? (
                        <div className="mgmt-loc-ac__item-sub mgmt-loc-ac__item-sub--detail">{c.detail}</div>
                      ) : null}
                      <div className="mgmt-loc-ac__item-sub">
                        {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mgmt-loc-field">
            <span className="mgmt-loc-field__label">Search terminal</span>
            <div className="mgmt-loc-ac">
              <input
                className="mgmt-loc-field__input"
                type="text"
                placeholder="Search terminal…"
                value={terminalName}
                onChange={(e) => {
                  setCoordsLockedFromPlaces(false);
                  setTerminalName(e.target.value);
                  setTerminalAcOpen(true);
                  // Clear pinned coords only; keep hub/stops until admin picks another terminal or saves.
                  setLat("");
                  setLng("");
                  setPickedTerminalPin(null);
                }}
                onFocus={() => {
                  if (terminalName.trim().length > 0) setTerminalAcOpen(true);
                }}
                onBlur={() => window.setTimeout(() => setTerminalAcOpen(false), 120)}
              />
              {terminalName.trim().length > 0 && terminalSuggestions.length > 0 ? (
                <div className="mgmt-loc-deployed-chips" role="group" aria-label="Deployed terminals matching search">
                  {terminalSuggestions.map((c) => (
                    <button
                      key={c._id}
                      type="button"
                      className="mgmt-loc-chip"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPickTerminalSuggestion(c)}
                    >
                      {compressAddress(c.locationName || c.terminal?.name || "Terminal")}
                    </button>
                  ))}
                </div>
              ) : null}

              {terminalAcOpen && terminalName.trim().length > 0 ? (
                <div className="mgmt-loc-ac__menu" role="listbox" aria-label="Search terminal suggestions">
                  {mergedTerminalSuggestions.length > 0 ? (
                    mergedTerminalSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="mgmt-loc-ac__item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const cov = terminalSuggestions.find((x) => `cov-terminal-${x._id}` === c.id);
                          if (cov) onPickTerminalSuggestion(cov);
                          else onPickGeoTerminal(c);
                        }}
                      >
                        <div className="mgmt-loc-ac__item-title">{c.label}</div>
                        {c.detail && c.detail !== c.label ? (
                          <div className="mgmt-loc-ac__item-sub mgmt-loc-ac__item-sub--detail">{c.detail}</div>
                        ) : null}
                        <div className="mgmt-loc-ac__item-sub">
                          {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="mgmt-loc-ac__item mgmt-loc-ac__item--muted" style={{ cursor: "default" }}>
                      <div className="mgmt-loc-ac__item-title">No matches yet</div>
                      <div className="mgmt-loc-ac__item-sub">Try a place name (e.g. Don Carlos) or pick a deployed location above.</div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className={"mgmt-loc-coords-row" + (coordsPulse ? " mgmt-loc-coords-row--pulse" : "")}>
            <div className="mgmt-loc-field-grid">
              <label className="mgmt-loc-field">
                <span className="mgmt-loc-field__label">Latitude</span>
                <input
                  className={
                    "mgmt-loc-field__input" + (coordsLockedFromPlaces ? " mgmt-loc-field__input--coords-locked" : "")
                  }
                  type="number"
                  step="0.000001"
                  placeholder="7.9064"
                  value={lat}
                  onChange={(e) => {
                    setCoordsLockedFromPlaces(false);
                    setLat(e.target.value);
                  }}
                />
              </label>
              <label className="mgmt-loc-field">
                <span className="mgmt-loc-field__label">Longitude</span>
                <input
                  className={
                    "mgmt-loc-field__input" + (coordsLockedFromPlaces ? " mgmt-loc-field__input--coords-locked" : "")
                  }
                  type="number"
                  step="0.000001"
                  placeholder="125.0933"
                  value={lng}
                  onChange={(e) => {
                    setCoordsLockedFromPlaces(false);
                    setLng(e.target.value);
                  }}
                />
              </label>
            </div>
            {coordsLockedFromPlaces ? (
              <span className="mgmt-loc-precision-badge" title="Coordinates set from a search pick (Nominatim); edit fields to unlock.">
                From search
              </span>
            ) : null}
          </div>

          <label className="mgmt-loc-field">
            <span className="mgmt-loc-field__label">Default geofence radius (terminal)</span>
            <input
              className="mgmt-loc-field__input"
              type="number"
              min={1}
              step={10}
              value={terminalRadiusM}
              onChange={(e) => setTerminalRadiusM(e.target.value)}
            />
          </label>

          <div style={{ marginTop: "0.5rem" }}>
            <div className="mgmt-loc-field">
              <span className="mgmt-loc-field__label">
                Search Bus Stops{selectedHub ? ` in ${selectedHub.terminal?.name ?? selectedHub.locationName}` : ""}
              </span>
              <div className="mgmt-loc-ac">
                <input
                  className="mgmt-loc-field__input"
                  type="text"
                  placeholder="Search bus stop name…"
                  value={stopSearch}
                  onChange={(e) => {
                    setStopSearch(e.target.value);
                    setStopAcOpen(true);
                  }}
                  onFocus={() => setStopAcOpen(true)}
                  onBlur={() => window.setTimeout(() => setStopAcOpen(false), 120)}
                />

                {stopAcOpen &&
                stopSearch.trim() &&
                (stopSuggestions.filter((s) => String(s.name || "").trim().length > 0).length > 0 ||
                  stopSearchSuggestions.length > 0 ||
                  stopLocalSuggestions.length > 0) ? (
                  <div className="mgmt-loc-ac__menu" role="listbox" aria-label="Stop suggestions">
                    {stopSuggestions
                      .filter((s) => String(s.name || "").trim().length > 0)
                      .map((s) => (
                      <button
                        key={`cov-stop-${s.sequence}-${s.name}-${s.latitude}-${s.longitude}`}
                        type="button"
                        className="mgmt-loc-ac__item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addStopFromSuggestion(s)}
                      >
                        <div className="mgmt-loc-ac__item-title">{s.name}</div>
                        <div className="mgmt-loc-ac__item-sub">
                          {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                        </div>
                      </button>
                    ))}
                    {stopSearchSuggestions.map((s) => (
                      <button
                        key={`geo-stop-${s.id}`}
                        type="button"
                        className="mgmt-loc-ac__item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addStopFromGeoSuggestion(s)}
                      >
                        <div className="mgmt-loc-ac__item-title">{s.label}</div>
                        {s.detail && s.detail !== s.label ? (
                          <div className="mgmt-loc-ac__item-sub mgmt-loc-ac__item-sub--detail">{s.detail}</div>
                        ) : null}
                        <div className="mgmt-loc-ac__item-sub">
                          {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                        </div>
                      </button>
                    ))}
                    {stopLocalSuggestions.map((s) => (
                      <button
                        key={`fallback-stop-${s.id}`}
                        type="button"
                        className="mgmt-loc-ac__item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addStopFromGeoSuggestion(s)}
                      >
                        <div className="mgmt-loc-ac__item-title">{s.label}</div>
                        <div className="mgmt-loc-ac__item-sub">
                          {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {stopAcOpen &&
                stopSearch.trim() &&
                stopSuggestions.filter((s) => String(s.name || "").trim().length > 0).length === 0 &&
                stopSearchSuggestions.length === 0 &&
                stopLocalSuggestions.length === 0 ? (
                  <div className="mgmt-loc-ac__menu" role="status" aria-live="polite">
                    <div className="mgmt-loc-ac__item">
                      <div className="mgmt-loc-ac__item-title">No bus stop matches</div>
                      <div className="mgmt-loc-ac__item-sub">Try another keyword</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {selectedStops.length > 0 ? (
              <div className="mgmt-loc-stop-list">
                <div className="mgmt-loc-stop-list__head">
                  <div className="mgmt-loc-stop-list__title">Selected bus stops</div>
                </div>
                {selectedStops.map((s, idx) => (
                  <div key={s.id} className="mgmt-loc-stop-item">
                    <div className="mgmt-loc-stop-item__main">
                      <div className="mgmt-loc-stop-item__name">
                        <span className="mgmt-loc-stop-item__index">{idx + 1}</span>
                        {compressAddress(s.name)}
                      </div>
                      <code className="mgmt-loc-stop-item__coords">
                        {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                      </code>
                    </div>
                    <div className="mgmt-loc-stop-item__right">
                      <button
                        type="button"
                        className="mgmt-loc-stop-item__remove"
                        onClick={() => removeSelectedStop(s.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mgmt-loc-policy" style={{ margin: 0 }}>
                Select bus stops from suggestions to build the waypoint list.
              </p>
            )}

            {selectedStops.length > 0 ? <div className="mgmt-loc-policy-dash" aria-hidden /> : null}

            <section className="mgmt-loc-policy-card" aria-label="Global pickup policy">
              <div className="mgmt-loc-policy-card__left">
                <h4 className="mgmt-loc-policy-card__title">
                  <svg viewBox="0 0 24 24" className="mgmt-loc-policy-card__shield" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M12 2l8 4v6c0 5-3.4 9.6-8 10-4.6-.4-8-5-8-10V6l8-4zm0 6a1 1 0 0 0-1 1v3.2l-1.5-1.5a1 1 0 1 0-1.4 1.4l3.2 3.2a1 1 0 0 0 1.4 0l3.2-3.2a1 1 0 1 0-1.4-1.4L13 12.2V9a1 1 0 0 0-1-1z"
                    />
                  </svg>
                  Fleet Policy
                </h4>
                <p className="mgmt-loc-policy-card__sub">Terminal & Bus Stops Pickup Only</p>
              </div>
              <label className="mgmt-loc-policy-card__toggle">
                <input type="checkbox" checked={globalPickupOnly} onChange={(e) => setAllStopsPickupOnly(e.target.checked)} />
                <span />
              </label>
            </section>

            <section className="mgmt-loc-route-summary" aria-label="Route summary">
              <span>Total route: {totalRouteKm > 0 ? `${totalRouteKm.toFixed(1)} km` : "0.0 km"}</span>
              <span className="mgmt-loc-route-summary__led" aria-hidden />
              <span>Geofence active</span>
            </section>
          </div>

          <button type="button" className="mgmt-loc-btn" disabled={saving} onClick={() => void handleSavePoint()}>
            {saving ? "Deploying..." : "Deploy location"}
          </button>
        </section>

        <section className="mgmt-loc-map">
          <div className="mgmt-loc-map__head">
            <h3>GPS visualizer</h3>
            <span className="mgmt-loc-map__status">{mapPinsActive ? "Pins active" : "Awaiting coordinates"}</span>
          </div>
          <div className="mgmt-loc-map__frame">
            <MapContainer center={mapFallbackCenter} zoom={12} scrollWheelZoom className="mgmt-loc-map__leaflet">
              <LocationMapFitBounds points={mapFitPoints} fallbackCenter={mapFallbackCenter} />
              <LocationMapJump jump={mapJumpTo} />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {coverageDocs.map((c) => {
                const la = c.terminal.latitude;
                const lo = c.terminal.longitude;
                if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
                return (
                  <CircleMarker
                    key={`deployed-${c._id}`}
                    center={[la, lo]}
                    radius={6}
                    pathOptions={{
                      color: "rgba(148, 163, 184, 0.95)",
                      fillColor: "rgba(71, 85, 105, 0.55)",
                      fillOpacity: 0.65,
                      weight: 1,
                    }}
                  >
                    <Popup>
                      <strong>Deployed terminal</strong>
                      <br />
                      {c.terminal?.name ?? c.locationName}
                    </Popup>
                  </CircleMarker>
                );
              })}
              {pickedLocationPin ? (
                <CircleMarker
                  center={[
                    hasValidCoords &&
                    Math.abs(pickedLocationPin.lat - latNum) < 1e-5 &&
                    Math.abs(pickedLocationPin.lng - lngNum) < 1e-5
                      ? pickedLocationPin.lat + 0.00028
                      : pickedLocationPin.lat,
                    hasValidCoords &&
                    Math.abs(pickedLocationPin.lat - latNum) < 1e-5 &&
                    Math.abs(pickedLocationPin.lng - lngNum) < 1e-5
                      ? pickedLocationPin.lng - 0.00028
                      : pickedLocationPin.lng,
                  ]}
                  radius={10}
                  pathOptions={{
                    color: "#0ea5e9",
                    fillColor: "#38bdf8",
                    fillOpacity: 0.92,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <strong>Search Location</strong>
                    <br />
                    {pickedLocationPin.label}
                  </Popup>
                </CircleMarker>
              ) : null}
              {hasValidCoords ? (
                <CircleMarker
                  center={[latNum, lngNum]}
                  radius={11}
                  pathOptions={{
                    color: "#87a8da",
                    fillColor: "#1f5885",
                    fillOpacity: 0.92,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <strong>Search Terminal</strong>
                    <br />
                    {pickedTerminalPin?.label || terminalName.trim() || name.trim() || "Terminal coordinates"}
                  </Popup>
                </CircleMarker>
              ) : null}
              {selectedStops.map((s) => (
                <CircleMarker
                  key={s.id}
                  center={[s.latitude, s.longitude]}
                  radius={8}
                  pathOptions={{ color: "#c4b5fd", fillColor: "#7c3aed", fillOpacity: 0.9, weight: 2 }}
                >
                  <Popup>
                    <strong>Bus stop</strong>
                    <br />
                    {compressAddress(s.name)}
                  </Popup>
                </CircleMarker>
              ))}
              {selectedStops.length > 0 && hasValidCoords ? (
                <Polyline
                  positions={[
                    [latNum, lngNum],
                    ...selectedStops
                      .slice()
                      .sort((a, b) => a.sequence - b.sequence)
                      .map((s) => [s.latitude, s.longitude] as [number, number]),
                  ]}
                  pathOptions={{ color: "#4a6bbe", weight: 3, opacity: 0.85, dashArray: "6 8" }}
                />
              ) : null}
            </MapContainer>
          </div>
          <p className="mgmt-loc-map__coord">
            {mapCoordDisplay.lat.toFixed(6)}, {mapCoordDisplay.lng.toFixed(6)}
          </p>
          <div className="mgmt-loc-map__legend" aria-label="Map pin legend">
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--loc" /> Location
            </span>
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--term" /> Terminal
            </span>
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--stop" /> Bus stop
            </span>
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--dep" /> Deployed
            </span>
          </div>
        </section>
      </div>

      {recentDeployedDisplay.length > 0 ? (
        <section className="mgmt-loc-recent">
          <h3 className="mgmt-loc-recent__title">Recently deployed points</h3>
          <div className="mgmt-loc-recent__list">
              {recentDeployedDisplay.map((p) => {
                const cov = coverageDocs.find((c) => c._id === p.id);
                return (
                  <div key={p.id} className="mgmt-loc-recent__parent">
                    <article className="mgmt-loc-recent__item">
                      <div className="mgmt-loc-recent__logo" aria-hidden>
                        <span className="mgmt-loc-recent__circle mgmt-loc-recent__circle--1" />
                        <span className="mgmt-loc-recent__circle mgmt-loc-recent__circle--2" />
                        <span className="mgmt-loc-recent__circle mgmt-loc-recent__circle--3" />
                        <span className="mgmt-loc-recent__circle mgmt-loc-recent__circle--4" />
                        <span className="mgmt-loc-recent__circle mgmt-loc-recent__circle--5">
                          <svg viewBox="0 0 24 24" className="mgmt-loc-recent__logo-svg" aria-hidden>
                            <path
                              fill="currentColor"
                              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
                            />
                          </svg>
                        </span>
                      </div>
                      <div className="mgmt-loc-recent__glass-sheet" aria-hidden />
                      <div className="mgmt-loc-recent__content">
                        <span className="mgmt-loc-recent__card-title">{p.name}</span>
                        <span className="mgmt-loc-recent__card-text">Main location · route coordinates saved</span>
                        <code className="mgmt-loc-recent__card-coords">
                          {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                        </code>
                      </div>
                      <div className="mgmt-loc-recent__bottom mgmt-loc-recent__bottom--glass-actions">
                        <div className="att-glass-card__actions">
                          <button
                            type="button"
                            className="att-glass-card__action att-glass-card__action--view"
                            onClick={() => setViewLocation({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="att-glass-card__action"
                            disabled={!cov}
                            onClick={() => {
                              if (cov) loadCoverageIntoForm(cov);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="att-glass-card__action att-glass-card__action--delete"
                            onClick={() => void handleDeleteCoverage(p.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  </div>
                );
              })}
          </div>
        </section>
      ) : null}

      <ViewDetailsModal
        open={Boolean(viewLocation)}
        title={viewLocation?.name ?? "Location"}
        onClose={() => setViewLocation(null)}
      >
        {viewLocation ? (
          <ViewDetailsDl>
            <ViewDetailsRow label="Main location" value={viewLocation.name} />
            <ViewDetailsRow label="Status" value="Main location · route coordinates saved" />
            <ViewDetailsRow
              label="Coordinates"
              value={
                <span className="view-details-row__value--mono">
                  {viewLocation.lat.toFixed(5)}, {viewLocation.lng.toFixed(5)}
                </span>
              }
            />
            <ViewDetailsRow label="Coverage ID" value={viewLocation.id} />
          </ViewDetailsDl>
        ) : null}
      </ViewDetailsModal>
    </div>
  );
}

function BusManagementPanel() {
  const { showError, showSuccess } = useToast();
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [operators, setOperators] = useState<AttendantVerifiedSummary[]>([]);
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [developerMode] = useState(() => readLsBool(LS_DEV_SHOW_TECHNICAL, false));

  const refresh = useCallback(async () => {
    try {
      const [bRes, oRes, dRes] = await Promise.all([
        api<{ items: BusRow[] }>("/api/buses"),
        api<{ items: AttendantVerifiedSummary[] }>("/api/attendants/verified"),
        api<{ items: DriverSummary[] }>("/api/drivers/verified"),
      ]);
      setBuses(bRes.items);
      setOperators(oRes.items);
      setDrivers(dRes.items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load bus management data";
      if (!shouldSilenceTicketingUnavailable(msg)) showError(msg);
      setBuses([]);
      setOperators([]);
      setDrivers([]);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const operatorName = useMemo(() => {
    const m = new Map<string, string>();
    operators.forEach((o) => {
      m.set(o.operatorId, `${o.firstName} ${o.lastName}`.trim());
    });
    return m;
  }, [operators]);

  function maskImei(imei: string | null) {
    if (!imei || imei.length < 4) return "—";
    return `···${imei.slice(-4)}`;
  }

  function initials(name: string | null | undefined) {
    const cleaned = (name ?? "").trim();
    if (!cleaned) return "NA";
    const parts = cleaned.split(/\s+/);
    const a = parts[0]?.[0] ?? "N";
    const b = parts[1]?.[0] ?? (parts[0]?.[1] ?? "A");
    return (a + b).toUpperCase();
  }

  function healthTone(status: string, ticketsIssued: number): "healthy" | "maintenance" | "inspection" {
    const s = status.toLowerCase();
    if (s.includes("inspection") || ticketsIssued > 1000) return "inspection";
    if (s.includes("maintenance") || ticketsIssued > 100) return "maintenance";
    return "healthy";
  }

  async function handleSaveBus(data: AddBusFormState) {
    setSaving(true);
    try {
      await api("/api/buses", {
        method: "POST",
        json: {
          busNumber: data.busNumber,
          imei: data.imei,
          operatorId: data.operatorId,
          driverId: data.driverId,
          route: data.route,
          strictPickup: data.strictPickup,
        },
      });
      showSuccess("Bus registered in fleet.");
      setModalOpen(false);
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save bus");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mgmt-bus-panel">
      <section className="dash-section-gap">
        <div className="mgmt-bus-panel__toolbar mgmt-bus-panel__toolbar--glass">
          <div>
            <h2 className="dash-h2">Fleet registry</h2>
            {developerMode ? (
              <p className="mgmt-bus-panel__dev-note">
                Technical routes: <code>GET /api/drivers/verified</code>, <code>GET /api/attendants/verified</code>,{" "}
                <code>POST /api/tickets/issue</code>.
              </p>
            ) : null}
          </div>
          <button type="button" className="mgmt-bus-panel__cta" onClick={() => setModalOpen(true)}>
            + Register new bus
          </button>
        </div>
      </section>

      <section>
        <h2 className="dash-h2">Maintenance tracker</h2>
        {buses.length === 0 ? (
          <div className="mgmt-bus-empty">
            <div className="mgmt-bus-empty__icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 17V9.5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 9.5V17" stroke="currentColor" strokeWidth="1.7" />
                <path d="M7 17h10M7 7V5m10 2V5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <circle cx="8" cy="18" r="1.7" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="16" cy="18" r="1.7" stroke="currentColor" strokeWidth="1.7" />
              </svg>
            </div>
            <p className="mgmt-bus-empty__title">No buses registered yet</p>
            <p className="mgmt-bus-empty__sub">Ready to deploy? Link your first GPS IMEI and verified crew to start tracking.</p>
          </div>
        ) : (
          <div className="mgmt-bus-grid">
            {buses.map((b) => {
              const tone = healthTone(b.healthStatus, b.ticketsIssued);
              const attendant = b.operatorId != null ? operatorName.get(b.operatorId) ?? `ID ${b.operatorId}` : "Unassigned";
              return (
                <article key={b.id} className={`mgmt-bus-card mgmt-bus-card--${tone}`}>
                  <div className="mgmt-bus-card__top">
                    <div>
                      <p className="mgmt-bus-card__bus">{b.busNumber}</p>
                      <p className="mgmt-bus-card__imei" title={b.imei || undefined}>
                        IMEI {maskImei(b.imei)}
                      </p>
                    </div>
                    <span className={`mgmt-bus-card__health mgmt-bus-card__health--${tone}`}>{b.healthStatus}</span>
                  </div>

                  <div className="mgmt-bus-card__crew">
                    <div className="mgmt-bus-card__crew-person">
                      <span className="mgmt-bus-card__avatar" aria-hidden>
                        {initials(attendant)}
                      </span>
                      <div>
                        <p className="mgmt-bus-card__crew-k">Attendant</p>
                        <p className="mgmt-bus-card__crew-v">{attendant}</p>
                      </div>
                    </div>
                    <div className="mgmt-bus-card__crew-person">
                      <span className="mgmt-bus-card__avatar mgmt-bus-card__avatar--driver" aria-hidden>
                        {initials(b.driverName)}
                      </span>
                      <div>
                        <p className="mgmt-bus-card__crew-k">Driver</p>
                        <p className="mgmt-bus-card__crew-v">
                          {b.driverName || "Unassigned"}
                          {b.driverLicense ? <span className="mgmt-bus-panel__muted"> · {b.driverLicense}</span> : null}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mgmt-bus-card__metrics">
                    <div>
                      <p className="mgmt-bus-card__metric-k">Tickets</p>
                      <p className="mgmt-bus-card__ticket">{b.ticketsIssued.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="mgmt-bus-card__metric-k">Route</p>
                      <p className="mgmt-bus-card__route">{b.route || "Not assigned"}</p>
                    </div>
                  </div>

                  <div className="mgmt-bus-card__policy">
                    <span className="mgmt-bus-card__policy-chip">
                      <span aria-hidden>🏢</span>
                      Terminals
                    </span>
                    <span className="mgmt-bus-card__policy-chip">
                      <span aria-hidden>🪧</span>
                      Bus stops
                    </span>
                    <span className="mgmt-bus-card__policy-state">
                      {b.strictPickup === false ? "Flexible pickup" : "Restricted pickup"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <AddBusModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveBus}
        operators={operators}
        drivers={drivers}
        saving={saving}
      />
    </div>
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
      <div
        className={
          "mgmt-mod" +
          (key === "passengers" ||
          key === "buses" ||
          key === "attendants" ||
          key === "drivers" ||
          key === "locations" ||
          key === "routes" ||
          key === "fares"
            ? " mgmt-mod--wide"
            : "") +
          (key === "passengers" ? " mgmt-mod--passenger" : "")
        }
      >
        <Link to="/dashboard/management" className="mgmt-mod__back">
          ← Back to management
        </Link>
        <header className="mgmt-mod__head">
          <h1 className="mgmt-mod__title">{copy.title}</h1>
          <p className="mgmt-mod__sub">{copy.subtitle}</p>
        </header>
        <div className={"mgmt-mod__placeholder" + (key === "passengers" ? " mgmt-mod__placeholder--passenger" : "")}>
          {key === "passengers" ? <PassengerManagementPanel /> : null}
          {key === "locations" ? <LocationManagementPanel /> : null}
          {key === "buses" ? <BusManagementPanel /> : null}
          {key === "attendants" ? <AttendantManagementPanel /> : null}
          {key === "drivers" ? <DriverManagementPanel /> : null}

          {key === "fares" ? <FareManagementPanel /> : null}

          {key === "routes" ? <RouteManagementPanel /> : null}

          {key === "admins" ? (
            <div className="mgmt-mod__audit-log">
              <AdminAuditLogPanel />
            </div>
          ) : null}

          {key !== "passengers" &&
          key !== "buses" &&
          key !== "attendants" &&
          key !== "drivers" &&
          key !== "locations" &&
          key !== "fares" &&
          key !== "routes" &&
          key !== "admins" ? (
            <p>Detailed tools for this area will be connected here.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
