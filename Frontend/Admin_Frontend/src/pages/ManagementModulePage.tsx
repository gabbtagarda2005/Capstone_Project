import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Swal from "sweetalert2";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { AddAttendantWizard } from "@/components/AddAttendantWizard";
import "@/components/AttendantGlassCard.css";
import { AttendantGlassCard } from "@/components/AttendantGlassCard";
import { FleetBusGlassCard } from "@/components/FleetBusGlassCard";
import { DriverGlassCard } from "@/components/DriverGlassCard";
import { EditAttendantModal } from "@/components/EditAttendantModal";
import { AddDriverWizard } from "@/components/AddDriverWizard";
import { EditDriverModal } from "@/components/EditDriverModal";
import { AddBusModal, type AddBusFormState } from "@/components/AddBusModal";
import { RouteManagementPanel } from "@/components/RouteManagementPanel";
import { ScheduleManagementPanel } from "@/components/ScheduleManagementPanel";
import { FareManagementPanel } from "@/components/FareManagementPanel";
import { FilterBar } from "@/components/FilterBar";
import { LiveTicketOperationsTable } from "@/components/LiveTicketOperationsTable";
import { PassengerBentoStats } from "@/components/PassengerBentoStats";
import { api, fetchAdminAuditLog, fetchCorridorRoutes } from "@/lib/api";
import { swalAlert, swalConfirm } from "@/lib/swal";
import { useToast } from "@/context/ToastContext";
import { filterTickets, sumFare, type FilterState } from "@/lib/filterTickets";
import {
  fetchNominatimRowsViaProxy,
  nominatimCompressedLabel,
  searchNominatimBukidnon,
  type NominatimMappedHit,
  type NominatimSearchRow,
} from "@/lib/nominatimBukidnon";
import type {
  AttendantVerifiedSummary,
  BusRow,
  CorridorRouteRow,
  DriverSummary,
  AdminAuditLogRowDto,
  OperatorSummary,
  TicketRow,
} from "@/lib/types";
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
  schedules: {
    title: "Schedule management",
    subtitle: "Departure boards, headways, and timetable exceptions across the network.",
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

function haversineMetersMgmt(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

/** Exclude major-terminal POIs from the Location (corridor / waypoint) search list. */
function isTerminalLikeNominatimHit(h: NominatimMappedHit): boolean {
  const t = `${h.detail || ""} ${h.label || ""}`.toLowerCase();
  if (/\bbus stop\b/i.test(t) || /\bjeepney stop\b/i.test(t)) return false;
  return (
    /\b(integrated terminal|central terminal|bus terminal|transport terminal|ferry terminal)\b/i.test(t) ||
    (/\bterminal\b/i.test(t) && /\b(bus|transport|ferry|integrated)\b/i.test(t))
  );
}

function filterNominatimLocationHits(hits: NominatimMappedHit[]): NominatimMappedHit[] {
  const avoid = hits.filter((h) => !isTerminalLikeNominatimHit(h));
  return avoid.length > 0 ? avoid : hits;
}

const MGMT_LOC_WAYPOINT_ICON = L.divIcon({
  className: "mgmt-loc-map__marker-icon mgmt-loc-map__waypoint",
  html: '<div class="mgmt-loc-map__waypoint-dot" aria-hidden="true"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});
const MGMT_LOC_WAYPOINT_FLEX_ICON = L.divIcon({
  className: "mgmt-loc-map__marker-icon mgmt-loc-map__waypoint mgmt-loc-map__waypoint--flex",
  html:
    '<div class="mgmt-loc-map__waypoint-flex" aria-hidden="true"><span class="mgmt-loc-map__waypoint-flex__ring"></span><span class="mgmt-loc-map__waypoint-flex__core"></span></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const MGMT_LOC_TERMINAL_HEX_ICON = L.divIcon({
  className: "mgmt-loc-map__marker-icon mgmt-loc-map__terminal-hex",
  html:
    '<div class="mgmt-loc-map__hex-wrap" aria-hidden="true">' +
    '<svg width="30" height="30" viewBox="-1.1 -1.1 2.2 2.2" focusable="false">' +
    '<polygon points="0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5" fill="#34d399" stroke="#065f46" stroke-width="0.14" />' +
    "</svg></div>",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const MGMT_LOC_DEPLOYED_HEX_ICON = L.divIcon({
  className: "mgmt-loc-map__marker-icon mgmt-loc-map__deployed-hex",
  html:
    '<div class="mgmt-loc-map__hex-wrap mgmt-loc-map__hex-wrap--muted" aria-hidden="true">' +
    '<svg width="22" height="22" viewBox="-1.1 -1.1 2.2 2.2" focusable="false">' +
    '<polygon points="0,-1 0.866,-0.5 0.866,0.5 0,1 -0.866,0.5 -0.866,-0.5" fill="#64748b" stroke="#94a3b8" stroke-width="0.2" />' +
    "</svg></div>",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

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
        employeeId: o.employeeId ?? null,
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
  const { showError, showSuccess } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [hubChip, setHubChip] = useState<string | null>(null);
  const [editingTicket, setEditingTicket] = useState<TicketRow | null>(null);
  const [editForm, setEditForm] = useState({ passengerId: "", startLocation: "", destination: "", fare: "" });
  const [savingTicket, setSavingTicket] = useState(false);

  const reloadPassengerData = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([api<Stats>("/api/tickets/stats"), api<{ items: TicketRow[] }>("/api/tickets")]);
      setStats(st);
      setTickets(list.items);
    } catch (e) {
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
  }, [showError]);

  useEffect(() => {
    void reloadPassengerData();
  }, [reloadPassengerData]);

  useEffect(() => {
    if (!editingTicket) return;
    setEditForm({
      passengerId: editingTicket.passengerId,
      startLocation: editingTicket.startLocation,
      destination: editingTicket.destination,
      fare: String(editingTicket.fare),
    });
  }, [editingTicket]);

  const filtered = useMemo(() => filterTickets(tickets, filter), [tickets, filter]);
  const filteredRevenue = sumFare(filtered);
  const hubFilteredTickets = useMemo(() => {
    if (!hubChip) return filtered;
    const needle = hubChip.toLowerCase();
    return filtered.filter((t) => {
      const hay = `${t.startLocation} ${t.destination}`.toLowerCase();
      if (needle === "valencia") return hay.includes("valencia") || hay.includes("lumbo");
      return hay.includes(needle);
    });
  }, [filtered, hubChip]);

  async function saveTicketEdit() {
    if (!editingTicket) return;
    const fare = Number(editForm.fare);
    if (!Number.isFinite(fare) || fare < 0) {
      showError("Fare must be a valid non-negative number.");
      return;
    }
    const pid = editForm.passengerId.trim();
    const start = editForm.startLocation.trim();
    const dest = editForm.destination.trim();
    if (!pid || !start || !dest) {
      showError("Passenger ID, start, and destination are required.");
      return;
    }
    setSavingTicket(true);
    try {
      await api<TicketRow>(`/api/tickets/portal/${encodeURIComponent(String(editingTicket.id))}`, {
        method: "PATCH",
        json: { passengerId: pid, startLocation: start, destination: dest, fare },
      });
      showSuccess("Ticket updated.");
      setEditingTicket(null);
      await reloadPassengerData();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not update ticket.");
    } finally {
      setSavingTicket(false);
    }
  }

  async function deleteTicketRow(t: TicketRow) {
    const ok = await swalConfirm({
      title: "Delete this ticket?",
      text: `Permanently remove the record for passenger ${t.passengerId}?`,
      icon: "warning",
      confirmButtonText: "Delete",
    });
    if (!ok) return;
    try {
      await api(`/api/tickets/portal/${encodeURIComponent(String(t.id))}`, { method: "DELETE" });
      showSuccess("Ticket removed.");
      await reloadPassengerData();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not delete ticket.");
    }
  }

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
        <LiveTicketOperationsTable
          tickets={hubFilteredTickets}
          hubChip={hubChip}
          onHubChipChange={setHubChip}
          onEditTicket={(t) => setEditingTicket(t)}
          onDeleteTicket={(t) => void deleteTicketRow(t)}
        />
      </section>

      {editingTicket ? (
        <div
          className="mgmt-passenger-ticket-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mgmt-edit-ticket-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingTicket(null);
          }}
        >
          <div className="mgmt-passenger-ticket-modal" onClick={(ev) => ev.stopPropagation()}>
            <h3 id="mgmt-edit-ticket-title">Edit ticket</h3>
            <p className="mgmt-passenger-ticket-modal__sub">
              Adjust passenger ID, route endpoints, or fare. Changes apply to the stored ticket record.
            </p>
            <div className="mgmt-passenger-ticket-modal__field">
              <label htmlFor="mgmt-ticket-pid">Passenger ID</label>
              <input
                id="mgmt-ticket-pid"
                value={editForm.passengerId}
                onChange={(e) => setEditForm((f) => ({ ...f, passengerId: e.target.value }))}
              />
            </div>
            <div className="mgmt-passenger-ticket-modal__field">
              <label htmlFor="mgmt-ticket-start">Start location</label>
              <input
                id="mgmt-ticket-start"
                value={editForm.startLocation}
                onChange={(e) => setEditForm((f) => ({ ...f, startLocation: e.target.value }))}
              />
            </div>
            <div className="mgmt-passenger-ticket-modal__field">
              <label htmlFor="mgmt-ticket-dest">Destination</label>
              <input
                id="mgmt-ticket-dest"
                value={editForm.destination}
                onChange={(e) => setEditForm((f) => ({ ...f, destination: e.target.value }))}
              />
            </div>
            <div className="mgmt-passenger-ticket-modal__field">
              <label htmlFor="mgmt-ticket-fare">Fare (PHP)</label>
              <input
                id="mgmt-ticket-fare"
                type="number"
                min={0}
                step={0.5}
                value={editForm.fare}
                onChange={(e) => setEditForm((f) => ({ ...f, fare: e.target.value }))}
              />
            </div>
            <div className="mgmt-passenger-ticket-modal__foot">
              <button type="button" disabled={savingTicket} onClick={() => setEditingTicket(null)}>
                Cancel
              </button>
              <button type="button" className="mgmt-passenger-ticket-modal__save" disabled={savingTicket} onClick={() => void saveTicketEdit()}>
                {savingTicket ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DriverManagementPanel() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverSummary | null>(null);
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
    if (
      !(await swalConfirm({
        title: "Remove driver?",
        text: `Remove ${d.firstName} ${d.lastName} from the fleet roster? They will be hidden from lists.`,
        icon: "warning",
        confirmButtonText: "Remove",
      }))
    )
      return;
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
                onView={() => navigate(`/dashboard/management/drivers/${encodeURIComponent(d.id)}`)}
                onEdit={() => setEditingDriver(d)}
                onDelete={() => void handleDeleteDriver(d)}
              />
            ))}
          </div>
        )}
      </section>

      <EditDriverModal
        driver={editingDriver}
        onClose={() => setEditingDriver(null)}
        onSave={async (payload) => {
          if (!editingDriver) return;
          await api(`/api/drivers/${encodeURIComponent(editingDriver.id)}`, {
            method: "PATCH",
            json: {
              firstName: payload.firstName,
              lastName: payload.lastName,
              middleName: payload.middleName || null,
              email: payload.email || null,
              phone: payload.phone || null,
              licenseNumber: payload.licenseNumber || null,
              yearsExperience: payload.yearsExperience,
            },
          });
          showSuccess("Driver updated.");
          await refresh();
        }}
      />

      <AddDriverWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} onSaved={() => void refresh()} />
    </div>
  );
}

function AttendantManagementPanel() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [operators, setOperators] = useState<AttendantVerifiedSummary[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<AttendantVerifiedSummary | null>(null);
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
    if (
      !(await swalConfirm({
        title: "Remove attendant?",
        text: `Remove ${a.firstName} ${a.lastName} from the roster? This cannot be undone.`,
        icon: "warning",
        confirmButtonText: "Remove",
      }))
    )
      return;
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
                onView={() =>
                  navigate(`/dashboard/management/attendants/${encodeURIComponent(o.operatorId)}`)
                }
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
    /** Per-stop geofence (m); default 100 when deploying. */
    geofenceRadiusM?: number;
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
    locationPoint?: {
      name?: string;
      latitude?: number;
      longitude?: number;
    } | null;
    stops: Array<{
      name: string;
      latitude: number;
      longitude: number;
      sequence: number;
      geofenceRadiusM?: number;
      pickupOnly?: boolean;
    }>;
  };
  type GeoPointType = "location" | "terminal";

  type GeoSuggestion = {
    id: string;
    label: string;
    lat: number;
    lng: number;
    /** Full Nominatim display line (tooltip / secondary) */
    detail?: string;
    type: GeoPointType;
  };

  /** Corridor / waypoint pin — does not set terminal WGS84. */
  type DraftLocationPin = {
    lat: number;
    lng: number;
    label: string;
    corridorName: string;
  };

  const [name, setName] = useState("");
  const [terminalName, setTerminalName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [saving, setSaving] = useState(false);
  const [mapJumpTo, setMapJumpTo] = useState<{ lat: number; lng: number; key: number; zoom?: number } | null>(null);
  const [coverageDocs, setCoverageDocs] = useState<CoverageDoc[]>([]);
  const [, setCoverageLoading] = useState(false);
  const [locationAcOpen, setLocationAcOpen] = useState(false);
  const [terminalAcOpen, setTerminalAcOpen] = useState(false);
  const [hubId, setHubId] = useState<string | null>(null);
  const [terminalRadiusM, setTerminalRadiusM] = useState("500");
  const [locationGeoSuggestions, setLocationGeoSuggestions] = useState<GeoSuggestion[]>([]);
  const [terminalSearchSuggestions, setTerminalSearchSuggestions] = useState<GeoSuggestion[]>([]);

  const [stopSearch, setStopSearch] = useState("");
  const [stopAcOpen, setStopAcOpen] = useState(false);
  /** Master switch: strict pickup at terminal + all listed stops (syncs per-stop policy when toggled). */
  const [strictTerminalAndStopsOnly, setStrictTerminalAndStopsOnly] = useState(true);
  const [selectedStops, setSelectedStops] = useState<PickupStop[]>([]);
  const [stopSearchSuggestions, setStopSearchSuggestions] = useState<GeoSuggestion[]>([]);
  const [pickedLocationPin, setPickedLocationPin] = useState<DraftLocationPin | null>(null);
  const [pickedTerminalPin, setPickedTerminalPin] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [coordsPulse, setCoordsPulse] = useState(false);
  const coordsPulseTimerRef = useRef<number | null>(null);
  const geocodeErrorToastAtRef = useRef(0);

  const notifyGeocodeFailure = useCallback(
    (e: unknown, signal: AbortSignal) => {
      if (signal.aborted) return;
      const err = e as { name?: string };
      if (err?.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      const now = Date.now();
      if (now - geocodeErrorToastAtRef.current < 7000) return;
      geocodeErrorToastAtRef.current = now;
      showError(
        `Map search failed: ${msg}. Use the Vite dev server with Admin_Backend on port 4001, stay logged in, and restart the backend after updates.`
      );
    },
    [showError]
  );

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

  /** Relational filter: Search Location anchor narrows terminals & deployed stops to this radius. */
  const LOCATION_CORRIDOR_RADIUS_KM = 20;

  function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
  }

  const locationAnchor = useMemo((): { lat: number; lng: number } | null => {
    if (hasValidCoords) return { lat: latNum, lng: lngNum };
    if (pickedLocationPin && Number.isFinite(pickedLocationPin.lat) && Number.isFinite(pickedLocationPin.lng)) {
      return { lat: pickedLocationPin.lat, lng: pickedLocationPin.lng };
    }
    return null;
  }, [hasValidCoords, latNum, lngNum, pickedLocationPin]);

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
    let pool = coverageDocs.filter(
      (c) => Number.isFinite(c.terminal?.latitude) && Number.isFinite(c.terminal?.longitude)
    );
    if (locationAnchor && pool.length > 0) {
      const inRegion = pool.filter(
        (c) =>
          haversineKm(
            locationAnchor.lat,
            locationAnchor.lng,
            Number(c.terminal!.latitude),
            Number(c.terminal!.longitude)
          ) <= LOCATION_CORRIDOR_RADIUS_KM
      );
      if (inRegion.length > 0) pool = inRegion;
    }
    return pool
      .filter((c) => {
        const loc = String(c.locationName || "").toLowerCase();
        const term = String(c.terminal?.name || "").toLowerCase();
        return tokensMatchHay(`${loc} ${term}`, terminalQ);
      })
      .slice(0, 10);
  }, [terminalName, coverageDocs, locationAnchor]);

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
    const flattened = coverageDocs.flatMap((c) =>
      Array.isArray(c.stops)
        ? c.stops.map((s, i) => ({
            id: `local-stop-${c._id}-${i}-${s.name}`,
            label: s.name,
            detail: c.locationName,
            lat: Number(s.latitude),
            lng: Number(s.longitude),
            cov: c,
          }))
        : []
    );
    let pool = flattened.filter(
      (s) => s.label.toLowerCase().includes(q) && Number.isFinite(s.lat) && Number.isFinite(s.lng)
    );
    if (locationAnchor && pool.length > 0) {
      const inReg = pool.filter(
        (s) => haversineKm(locationAnchor.lat, locationAnchor.lng, s.lat, s.lng) <= LOCATION_CORRIDOR_RADIUS_KM
      );
      if (inReg.length > 0) pool = inReg;
    }
    return pool.slice(0, 10).map((s) => ({
      id: s.id,
      label: s.label,
      detail: s.detail,
      lat: s.lat,
      lng: s.lng,
      type: "location" as const,
    }));
  }, [stopSearch, coverageDocs, locationAnchor]);

  const deployedStopMatches = useMemo(() => {
    const q = stopSearch.trim().toLowerCase();
    if (!q || coverageDocs.length === 0)
      return [] as { key: string; cov: CoverageDoc; stop: CoverageDoc["stops"][number] }[];
    const out: { key: string; cov: CoverageDoc; stop: CoverageDoc["stops"][number] }[] = [];
    for (const c of coverageDocs) {
      const tlat = c.terminal?.latitude;
      const tlng = c.terminal?.longitude;
      if (!Number.isFinite(tlat) || !Number.isFinite(tlng)) continue;
      if (
        locationAnchor &&
        haversineKm(locationAnchor.lat, locationAnchor.lng, Number(tlat), Number(tlng)) > LOCATION_CORRIDOR_RADIUS_KM
      ) {
        continue;
      }
      for (const s of c.stops || []) {
        if (!String(s.name || "").trim()) continue;
        if (!s.name.toLowerCase().includes(q)) continue;
        out.push({
          key: `${c._id}-${s.sequence}-${s.name}-${s.latitude}-${s.longitude}`,
          cov: c,
          stop: s,
        });
      }
    }
    return out.slice(0, 14);
  }, [stopSearch, coverageDocs, locationAnchor]);

  /** Hub-first, then other deployed stops in the same corridor radius (deduped). */
  const combinedDeployedWaypointRows = useMemo(() => {
    const q = stopSearch.trim().toLowerCase();
    if (!q) return [] as { key: string; cov: CoverageDoc; stop: CoverageDoc["stops"][number] }[];
    const seen = new Set<string>();
    const rows: { key: string; cov: CoverageDoc; stop: CoverageDoc["stops"][number] }[] = [];
    const push = (cov: CoverageDoc, stop: CoverageDoc["stops"][number]) => {
      const k = `${cov._id}-${stop.sequence}-${stop.name}-${stop.latitude}-${stop.longitude}`;
      if (seen.has(k)) return;
      seen.add(k);
      rows.push({ key: k, cov, stop });
    };
    if (selectedHub) {
      for (const s of safeHubStops) {
        if (!String(s.name || "").trim() || !s.name.toLowerCase().includes(q)) continue;
        push(selectedHub, s);
      }
    }
    for (const r of deployedStopMatches) {
      push(r.cov, r.stop);
    }
    return rows;
  }, [stopSearch, selectedHub, safeHubStops, deployedStopMatches]);
  const terminalLocalSuggestions = useMemo(() => {
    const q = terminalName.trim();
    if (!q) return [] as GeoSuggestion[];
    return coverageDocs
      .map((c) => ({
        id: `local-terminal-${c._id}`,
        label: c.locationName || c.terminal?.name || "Location",
        lat: Number(c.terminal?.latitude),
        lng: Number(c.terminal?.longitude),
        type: "terminal" as const,
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
    return [
      {
        id: `scoped-terminal-${primary.toLowerCase()}`,
        label: candidate,
        lat: latNum,
        lng: lngNum,
        type: "terminal" as const,
      },
    ];
  }, [terminalName, name, hasValidCoords, latNum, lngNum]);

  function compressAddress(address: string): string {
    if (!address) return "";
    const parts = address
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length > 2 ? `${parts[0]}, ${parts[1]}` : address;
  }

  const recentDeployedCorridors = useMemo(() => {
    return coverageDocs
      .filter((c) => Number.isFinite(c.terminal?.latitude) && Number.isFinite(c.terminal?.longitude))
      .slice(0, 6)
      .map((cov) => {
        const term = cov.terminal!;
        const activeInEditor =
          locationAnchor != null &&
          haversineKm(locationAnchor.lat, locationAnchor.lng, Number(term.latitude), Number(term.longitude)) <=
            LOCATION_CORRIDOR_RADIUS_KM;
        return { cov, activeInEditor };
      });
  }, [coverageDocs, locationAnchor]);

  /** Deployed hubs + scoped/local terminal anchors — not mixed with pure Nominatim terminal search. */
  const terminalFormAnchoredSuggestions = useMemo(() => {
    const fromCoverage = terminalSuggestions.map((c) => ({
      id: `cov-terminal-${c._id}`,
      label: compressAddress(c.locationName || c.terminal?.name || "Location"),
      detail: c.locationName || c.terminal?.name,
      lat: c.terminal.latitude,
      lng: c.terminal.longitude,
      type: "terminal" as const,
    }));
    const seen = new Set<string>();
    const out: GeoSuggestion[] = [];
    [...terminalScopedSuggestion, ...fromCoverage, ...terminalLocalSuggestions].forEach((s) => {
      const key = `${s.label.toLowerCase()}|${s.lat.toFixed(5)}|${s.lng.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    });
    return out.slice(0, 14);
  }, [terminalScopedSuggestion, terminalSuggestions, terminalLocalSuggestions]);

  /** Quick chips: any deployed hub matching Search Location or Search terminal query. */
  const deployedCoverageChips = useMemo(() => {
    const m = new Map<string, CoverageDoc>();
    for (const c of locationCoverageMatches) m.set(c._id, c);
    for (const c of terminalSuggestions) m.set(c._id, c);
    return [...m.values()].slice(0, 12);
  }, [locationCoverageMatches, terminalSuggestions]);

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

  const sortedStopsForRoute = useMemo(
    () => [...selectedStops].sort((a, b) => a.sequence - b.sequence),
    [selectedStops]
  );

  /** Offset corridor waypoint slightly when it sits on top of the terminal so both pins stay visible. */
  const locationPinDisplay = useMemo((): [number, number] | null => {
    if (!pickedLocationPin) return null;
    let lat = pickedLocationPin.lat;
    let lng = pickedLocationPin.lng;
    if (hasValidCoords) {
      const m = haversineMetersMgmt(lat, lng, latNum, lngNum);
      if (m < 85) {
        lat += 0.00022;
        lng += 0.00018;
      }
    }
    return [lat, lng];
  }, [pickedLocationPin, hasValidCoords, latNum, lngNum]);

  const showLocationWaypointPin = pickedLocationPin != null;

  const mapFallbackCenter: [number, number] = useMemo(() => {
    if (hasValidCoords) return [latNum, lngNum];
    if (pickedLocationPin) return [pickedLocationPin.lat, pickedLocationPin.lng];
    return [7.9072, 125.0928];
  }, [hasValidCoords, latNum, lngNum, pickedLocationPin]);

  const mapFitPoints = useMemo(() => {
    const pts: [number, number][] = [];
    if (pickedLocationPin) {
      pts.push([pickedLocationPin.lat, pickedLocationPin.lng]);
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
      const loose = withCoords.filter((h) => String(h.detail || h.label || "").toLowerCase().includes(first));
      if (loose.length > 0) return loose.slice(0, 12);
    }
    return withCoords.slice(0, 12);
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
      setLocationGeoSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const hits = await searchNominatimBukidnon(q, ctl.signal);
        const locationLike = filterNominatimLocationHits(hits);
        const mapped = locationLike.map((h) => ({
          id: h.id,
          label: h.label,
          lat: h.lat,
          lng: h.lng,
          detail: h.detail,
          type: "location" as const,
        }));
        const filtered = mapped.filter((h) => locationSearchMatchesQuery(h.detail || h.label, q));
        setLocationGeoSuggestions((filtered.length > 0 ? filtered : mapped).slice(0, 10));
      } catch (e) {
        notifyGeocodeFailure(e, ctl.signal);
        setLocationGeoSuggestions([]);
      }
    }, 220);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [name, notifyGeocodeFailure]);

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
        ctx ? `${q} ${ctx} bus terminal` : `${q} bus terminal Bukidnon`,
        ctx ? `${q} ${ctx} terminal Philippines` : `${q} terminal Philippines`,
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
              picked.map((h) => ({
                id: h.id,
                label: h.label,
                lat: h.lat,
                lng: h.lng,
                detail: h.detail,
                type: "terminal" as const,
              }))
            );
            return;
          }
        }
        setTerminalSearchSuggestions([]);
      } catch (e) {
        notifyGeocodeFailure(e, ctl.signal);
        setTerminalSearchSuggestions([]);
      }
    }, 220);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [terminalName, name, notifyGeocodeFailure]);

  /** Area label for bus-stop search: saved hub, or whatever admin typed under Search Location (new points). */
  const stopSearchPlaceContext = useMemo(
    () => (selectedHub?.locationName || name).trim(),
    [selectedHub?.locationName, name]
  );

  useEffect(() => {
    const q = stopSearch.trim();
    if (q.length < 1) {
      setStopSearchSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const queryVariants = stopSearchPlaceContext
          ? [`${q} ${stopSearchPlaceContext} bus stop`, `${q} ${stopSearchPlaceContext} Philippines`, `${q} bus stop ${stopSearchPlaceContext}`]
          : [`${q} bus stop Bukidnon Philippines`, `${q} bus stop`];

        let rows: NominatimSearchRow[] = [];
        outer: for (const searchQ of queryVariants) {
          for (const bounded of [1, 0] as const) {
            if (ctl.signal.aborted) return;
            const batch = await fetchNominatimRowsViaProxy(searchQ, { bounded, limit: 12, signal: ctl.signal });
            if (batch.length > 0) {
              rows = batch;
              break outer;
            }
          }
        }

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
        if (filtered.length === 0) {
          filtered = rows.filter((r) => /\b(bus stop|jeepney stop|terminal stop|stop)\b/i.test(String(r.display_name || "")));
        }
        if (filtered.length === 0 && rows.length > 0) {
          const qLow = q.toLowerCase();
          filtered = rows.filter((r) => String(r.display_name || "").toLowerCase().includes(qLow));
        }
        if (filtered.length === 0) {
          filtered = rows;
        }

        setStopSearchSuggestions(
          filtered
            .map((r) => ({
              id: `stop-${r.place_id}`,
              label: nominatimCompressedLabel(r),
              detail: String(r.display_name || "").trim(),
              lat: Number(r.lat),
              lng: Number(r.lon),
              type: "location" as const,
            }))
            .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && String(r.label || "").trim().length > 0)
        );
      } catch (e) {
        notifyGeocodeFailure(e, ctl.signal);
        setStopSearchSuggestions([]);
      }
    }, 220);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [stopSearch, stopSearchPlaceContext, notifyGeocodeFailure]);

  function onPickTerminalSuggestion(cov: CoverageDoc) {
    const termName = cov.terminal?.name ?? cov.locationName;
    setName(cov.locationName || termName);
    setTerminalName(termName);
    setLat(String(cov.terminal.latitude));
    setLng(String(cov.terminal.longitude));
    setTerminalRadiusM(String(Number(cov.terminal.geofenceRadiusM || 500)));
    setPickedTerminalPin({
      lat: cov.terminal.latitude,
      lng: cov.terminal.longitude,
      label: termName,
    });
    const lpLat = Number(cov.locationPoint?.latitude);
    const lpLng = Number(cov.locationPoint?.longitude);
    if (Number.isFinite(lpLat) && Number.isFinite(lpLng)) {
      setPickedLocationPin({
        lat: lpLat,
        lng: lpLng,
        label: String(cov.locationPoint?.name || cov.locationName || termName).trim(),
        corridorName: cov.locationName || termName,
      });
    } else {
      setPickedLocationPin(null);
    }

    setLocationAcOpen(false);
    setTerminalAcOpen(false);

    setHubId(cov._id);
    setSelectedStops([]);
    setStrictTerminalAndStopsOnly(cov.terminal?.pickupOnly !== false);
    setStopSearch("");
    setStopAcOpen(false);
    triggerCoordsPulse();
    setMapJumpTo({ lat: cov.terminal.latitude, lng: cov.terminal.longitude, key: Date.now(), zoom: 18 });
  }

  /** Load a saved coverage hub into the form (same fields as picking from Search). */
  function loadCoverageIntoForm(cov: CoverageDoc) {
    const termName = cov.terminal?.name ?? cov.locationName;
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
    const lpLat = Number(cov.locationPoint?.latitude);
    const lpLng = Number(cov.locationPoint?.longitude);
    if (Number.isFinite(lpLat) && Number.isFinite(lpLng)) {
      setPickedLocationPin({
        lat: lpLat,
        lng: lpLng,
        label: String(cov.locationPoint?.name || cov.locationName || termName).trim(),
        corridorName: cov.locationName || termName,
      });
    } else {
      setPickedLocationPin(null);
    }
    setHubId(cov._id);
    const nextStops: PickupStop[] = (Array.isArray(cov.stops) ? cov.stops : []).map((s) => ({
      id: `cov-${cov._id}-${s.sequence}-${s.name}`,
      name: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      sequence: s.sequence,
      pickupOnly: s.pickupOnly !== false,
      geofenceRadiusM: Number.isFinite(Number(s.geofenceRadiusM)) ? Number(s.geofenceRadiusM) : 100,
    }));
    setSelectedStops(nextStops.sort((a, b) => a.sequence - b.sequence));
    setStrictTerminalAndStopsOnly(cov.terminal?.pickupOnly !== false);
    setLocationAcOpen(false);
    setTerminalAcOpen(false);
    setStopSearch("");
    setStopAcOpen(false);
    triggerCoordsPulse();
    setMapJumpTo({ lat: cov.terminal.latitude, lng: cov.terminal.longitude, key: Date.now(), zoom: 18 });
    showInfo("Loaded into the form above — change fields and save to update this location.");
  }

  function onPickGeoTerminal(s: GeoSuggestion) {
    if (s.type !== "terminal") return;
    setTerminalName(s.label);
    setLat(String(s.lat));
    setLng(String(s.lng));
    setPickedTerminalPin({ lat: s.lat, lng: s.lng, label: s.label });
    /** Keep corridor/waypoint pin — it is independent of terminal WGS84 and must persist for deploy → View Location. */
    setTerminalAcOpen(false);
    triggerCoordsPulse();
    setMapJumpTo({ lat: s.lat, lng: s.lng, key: Date.now(), zoom: 18 });
  }

  function onPickGeoLocation(s: GeoSuggestion) {
    if (s.type !== "location") return;
    setName(s.label);
    setPickedLocationPin({
      lat: s.lat,
      lng: s.lng,
      label: s.label,
      corridorName: s.label,
    });
    setLocationAcOpen(false);
    setHubId(null);
    triggerCoordsPulse();
    setMapJumpTo({ lat: s.lat, lng: s.lng, key: Date.now(), zoom: 17 });
  }

  function addStopFromDeployedStop(cov: CoverageDoc, s: CoverageDoc["stops"][number]) {
    setSelectedStops((prev) => {
      const exists = prev.some(
        (p) => p.name === s.name && p.latitude === s.latitude && p.longitude === s.longitude
      );
      if (exists) return prev;
      const maxSeq = prev.reduce((m, x) => Math.max(m, x.sequence), 0);
      return [
        ...prev,
        {
          id: `dep-${cov._id}-${s.sequence}-${s.name}-${s.latitude}`,
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          sequence: maxSeq + 1,
          pickupOnly: strictTerminalAndStopsOnly,
        },
      ];
    });
    setStopSearch("");
    setStopAcOpen(false);
  }

  function addStopFromGeoSuggestion(s: GeoSuggestion) {
    if (s.type === "terminal") return;
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
          pickupOnly: strictTerminalAndStopsOnly,
          geofenceRadiusM: 100,
        },
      ];
    });
    setStopSearch("");
    setStopAcOpen(false);
  }

  function removeSelectedStop(stopId: string) {
    setSelectedStops((prev) => {
      const next = prev.filter((p) => p.id !== stopId);
      return next.map((s, i) => ({ ...s, sequence: i + 1 }));
    });
  }

  async function handleDeleteCoverage(coverageId: string) {
    if (
      !(await swalConfirm({
        title: "Remove coverage?",
        text: "Remove this deployed terminal and its saved route coverage?",
        icon: "warning",
        confirmButtonText: "Remove",
      }))
    )
      return;
    try {
      await api(`/api/locations/coverage/${coverageId}`, { method: "DELETE" });
      showSuccess("Location coverage removed");
      if (hubId === coverageId) {
        setHubId(null);
        setSelectedStops([]);
      }
      void loadCoverageDocs();
      window.dispatchEvent(new CustomEvent("admin-corridor-context-refresh"));
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("admin-corridor-context-refresh")), 500);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to delete coverage");
    }
  }

  function normalizeLocationKey(s: string): string {
    return s.trim().replace(/\s+/g, " ").toLowerCase();
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

    const nameKey = normalizeLocationKey(locationNameForDoc);
    const conflicting = coverageDocs.find(
      (c) => normalizeLocationKey(c.locationName) === nameKey && (!hubId || c._id !== hubId)
    );
    if (conflicting) {
      await swalAlert(
        "This location already exists. You cannot add a duplicate. Edit the existing hub from the deployed list, or use a different location name.",
        { title: "Duplicate location", icon: "warning" }
      );
      showError("Location already exists.");
      return;
    }

    setSaving(true);
    try {
      const radiusNum = Number(terminalRadiusM);
      const existingLocLat = Number(selectedHub?.locationPoint?.latitude);
      const existingLocLng = Number(selectedHub?.locationPoint?.longitude);
      const locationPointPayload =
        pickedLocationPin != null
          ? {
              name: pickedLocationPin.label || locationNameForDoc,
              latitude: pickedLocationPin.lat,
              longitude: pickedLocationPin.lng,
            }
          : Number.isFinite(existingLocLat) && Number.isFinite(existingLocLng)
            ? {
                name: String(selectedHub?.locationPoint?.name || locationNameForDoc).trim(),
                latitude: existingLocLat,
                longitude: existingLocLng,
              }
            : null;
      const terminalPayload: Record<string, unknown> = {
        name: terminalNameForDoc,
        latitude: latNum,
        longitude: lngNum,
        geofenceRadiusM: Number.isFinite(radiusNum) && radiusNum > 0 ? radiusNum : 500,
        pickupOnly: strictTerminalAndStopsOnly,
      };

      await api("/api/locations/coverage", {
        method: "POST",
        json: {
          ...(hubId ? { coverageId: hubId } : {}),
          locationName: locationNameForDoc,
          pointType: "terminal",
          terminal: terminalPayload,
          ...(locationPointPayload ? { locationPoint: locationPointPayload } : {}),
          stops: sortedStopsForRoute.map((s, i) => ({
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            sequence: i + 1,
            geofenceRadiusM: Number.isFinite(Number(s.geofenceRadiusM)) ? Number(s.geofenceRadiusM) : 100,
            pickupOnly: s.pickupOnly !== false,
          })),
        },
      });
      await api("/api/locations", { method: "POST", json: { locationName: locationNameForDoc } }).catch(() => {});
      showSuccess(`Location deployed: ${locationNameForDoc}`);
      void loadCoverageDocs();
      window.dispatchEvent(new CustomEvent("admin-corridor-context-refresh"));
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("admin-corridor-context-refresh")), 500);

      setName("");
      setTerminalName("");
      setLat("");
      setLng("");
      setTerminalRadiusM("500");
      setHubId(null);
      setStopSearch("");
      setSelectedStops([]);
      setStrictTerminalAndStopsOnly(true);
      setLocationAcOpen(false);
      setTerminalAcOpen(false);
      setStopAcOpen(false);
      setPickedLocationPin(null);
      setPickedTerminalPin(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to deploy location";
      if (/already exists/i.test(msg)) {
        await swalAlert(msg, { title: "Could not deploy", icon: "warning" });
      }
      showError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mgmt-loc-panel">
      <div className="mgmt-loc-grid">
        <section className="mgmt-loc-card">
          <h2 className="mgmt-loc-card__title">Register new point</h2>

          <div className="mgmt-loc-field">
            <span className="mgmt-loc-field__label">Search Location (corridor / waypoint)</span>
            <div className="mgmt-loc-ac">
              <input
                className="mgmt-loc-field__input"
                type="text"
                placeholder="e.g. barangay, bus stop along corridor, municipality"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setLocationAcOpen(true);
                }}
                onFocus={() => {
                  if (name.trim().length > 0) setLocationAcOpen(true);
                }}
                onBlur={() => window.setTimeout(() => setLocationAcOpen(false), 120)}
              />

              {locationAcOpen && name.trim().length > 0 ? (
                <div className="mgmt-loc-ac__menu mgmt-loc-ac__menu--obsidian" role="listbox" aria-label="Location-only map search">
                  {locationGeoSuggestions.length > 0 ? (
                    <>
                      <div className="mgmt-loc-ac__section-label">Map search · type: location</div>
                      {locationGeoSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="mgmt-loc-ac__item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onPickGeoLocation(c)}
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
                    </>
                  ) : (
                    <div className="mgmt-loc-ac__item mgmt-loc-ac__item--muted" style={{ cursor: "default" }}>
                      <div className="mgmt-loc-ac__item-title">No location matches yet</div>
                      <div className="mgmt-loc-ac__item-sub">
                        Try another spelling or wait a few seconds if the geocoder is busy. Major terminals belong under Search terminal.
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mgmt-loc-field">
            <span className="mgmt-loc-field__label">Search terminal (type: terminal)</span>
            {hubId ? (
              <p className="mgmt-loc-field__hint mgmt-loc-field__hint--mono">
                Active parent route ID: <code>{hubId}</code>
              </p>
            ) : null}
            <div className="mgmt-loc-ac">
              <input
                className="mgmt-loc-field__input"
                type="text"
                placeholder="Integrated terminal (Nominatim or deployed chip)…"
                value={terminalName}
                onChange={(e) => {
                  setTerminalName(e.target.value);
                  setTerminalAcOpen(true);
                }}
                onFocus={() => {
                  if (terminalName.trim().length > 0) setTerminalAcOpen(true);
                }}
                onBlur={() => window.setTimeout(() => setTerminalAcOpen(false), 120)}
              />
              {(name.trim().length > 0 || terminalName.trim().length > 0) && deployedCoverageChips.length > 0 ? (
                <div className="mgmt-loc-deployed-chips" role="group" aria-label="Deployed hubs matching search">
                  {deployedCoverageChips.map((c) => (
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
                <div className="mgmt-loc-ac__menu mgmt-loc-ac__menu--obsidian" role="listbox" aria-label="Terminal suggestions">
                  {terminalFormAnchoredSuggestions.length > 0 ? (
                    <>
                      <div className="mgmt-loc-ac__section-label">Deployed / anchored · type: terminal</div>
                      {terminalFormAnchoredSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="mgmt-loc-ac__item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const cov = coverageDocs.find((x) => `cov-terminal-${x._id}` === c.id);
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
                      ))}
                    </>
                  ) : null}
                  {terminalSearchSuggestions.length > 0 ? (
                    <>
                      <div className="mgmt-loc-ac__section-label">Map search · type: terminal</div>
                      {terminalSearchSuggestions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="mgmt-loc-ac__item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onPickGeoTerminal(c)}
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
                    </>
                  ) : null}
                  {terminalFormAnchoredSuggestions.length === 0 && terminalSearchSuggestions.length === 0 ? (
                    <div className="mgmt-loc-ac__item mgmt-loc-ac__item--muted" style={{ cursor: "default" }}>
                      <div className="mgmt-loc-ac__item-title">No terminal matches yet</div>
                      <div className="mgmt-loc-ac__item-sub">Try a hub name or pick a deployed chip above.</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className={"mgmt-loc-coords-row" + (coordsPulse ? " mgmt-loc-coords-row--pulse" : "")}>
            <div className="mgmt-loc-field-grid">
              <label className="mgmt-loc-field">
                <span className="mgmt-loc-field__label">Latitude</span>
                <input
                  className="mgmt-loc-field__input mgmt-loc-field__input--mono"
                  type="number"
                  step="0.000001"
                  placeholder="7.9064"
                  value={lat}
                  onChange={(e) => {
                    setLat(e.target.value);
                  }}
                />
              </label>
              <label className="mgmt-loc-field">
                <span className="mgmt-loc-field__label">Longitude</span>
                <input
                  className="mgmt-loc-field__input mgmt-loc-field__input--mono"
                  type="number"
                  step="0.000001"
                  placeholder="125.0933"
                  value={lng}
                  onChange={(e) => {
                    setLng(e.target.value);
                  }}
                />
              </label>
            </div>
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
                Search Bus Stops
                {stopSearchPlaceContext ? ` near ${stopSearchPlaceContext}` : ""}
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
                (combinedDeployedWaypointRows.length > 0 ||
                  stopSearchSuggestions.length > 0 ||
                  stopLocalSuggestions.length > 0) ? (
                  <div className="mgmt-loc-ac__menu mgmt-loc-ac__menu--obsidian" role="listbox" aria-label="Stop suggestions">
                    {combinedDeployedWaypointRows.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        className="mgmt-loc-ac__item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addStopFromDeployedStop(r.cov, r.stop)}
                      >
                        <div className="mgmt-loc-ac__item-title">{r.stop.name}</div>
                        <div className="mgmt-loc-ac__item-sub mgmt-loc-ac__item-sub--detail">
                          Linked to terminal · {r.cov.locationName}
                        </div>
                        <div className="mgmt-loc-ac__item-sub">
                          {r.stop.latitude.toFixed(5)}, {r.stop.longitude.toFixed(5)}
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
                combinedDeployedWaypointRows.length === 0 &&
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

            <section className="mgmt-loc-stop-list" aria-label="Bus stops in this route">
              <div className="mgmt-loc-stop-list__head">
                <h4 className="mgmt-loc-stop-list__title">Bus stops in this route</h4>
                {sortedStopsForRoute.length > 0 ? (
                  <span className="mgmt-loc-stop-list__count">
                    {sortedStopsForRoute.length} stop{sortedStopsForRoute.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              {sortedStopsForRoute.length === 0 ? null : (
                sortedStopsForRoute.map((s, idx) => (
                  <div key={s.id} className="mgmt-loc-stop-item">
                    <div>
                      <div className="mgmt-loc-stop-item__name">
                        <span className="mgmt-loc-stop-item__index">{idx + 1}</span>
                        <span>{compressAddress(s.name)}</span>
                      </div>
                      <span className="mgmt-loc-stop-item__coords">
                        {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                      </span>
                    </div>
                    <div className="mgmt-loc-stop-item__right">
                      {strictTerminalAndStopsOnly ? (
                        <label
                          className="mgmt-loc-stop-policy"
                          title="Strict: passengers board only at this stop. Flexible: free pickup along the corridor segment after this stop (no off-route flag)."
                        >
                          <input
                            type="checkbox"
                            checked={s.pickupOnly !== false}
                            onChange={(e) =>
                              setSelectedStops((prev) =>
                                prev.map((x) => (x.id === s.id ? { ...x, pickupOnly: e.target.checked } : x))
                              )
                            }
                          />
                          <span className="mgmt-loc-stop-policy__text">{s.pickupOnly !== false ? "Strict" : "Flexible"}</span>
                        </label>
                      ) : null}
                      <button
                        type="button"
                        className="mgmt-loc-stop-item__remove"
                        onClick={() => removeSelectedStop(s.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="mgmt-loc-policy-card mgmt-loc-policy-card--below-stops" aria-label="Terminal and bus stop pickup policy">
              <div className="mgmt-loc-policy-card__left">
                <h4 className="mgmt-loc-policy-card__title">Fleet policy</h4>
                <p className="mgmt-loc-policy-card__sub">Terminal &amp; bus stops only</p>
              </div>
              <label className="mgmt-loc-policy-card__toggle">
                <input
                  type="checkbox"
                  checked={strictTerminalAndStopsOnly}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setStrictTerminalAndStopsOnly(next);
                    setSelectedStops((prev) => prev.map((s) => ({ ...s, pickupOnly: next })));
                  }}
                />
                <span />
              </label>
            </section>

            <section className="mgmt-loc-route-summary" aria-label="Route summary">
              <span>
                Total route: {totalRouteKm > 0 ? `${totalRouteKm.toFixed(1)} km` : "0.0 km"}
                <span className="mgmt-loc-route-summary__live"> · live telemetry</span>
              </span>
              <span className="mgmt-loc-route-summary__led" aria-hidden />
              <span>Path connected</span>
            </section>
          </div>

          <button type="button" className="mgmt-loc-btn" disabled={saving} onClick={() => void handleSavePoint()}>
            {saving ? "Deploying..." : "Deploy location"}
          </button>
        </section>

        <section className="mgmt-loc-map">
          <div className="mgmt-loc-map__head">
            <h3>GPS visualizer</h3>
            <div className="mgmt-loc-map__head-actions">
              <span className="mgmt-loc-map__status">{mapPinsActive ? "Pins active" : "Awaiting coordinates"}</span>
            </div>
          </div>
          <div
            className={
              "mgmt-loc-map__frame"
            }
          >
            <MapContainer center={mapFallbackCenter} zoom={12} scrollWheelZoom className="mgmt-loc-map__leaflet">
              <LocationMapFitBounds points={mapFitPoints} fallbackCenter={mapFallbackCenter} />
              <LocationMapJump jump={mapJumpTo} />
              <TileLayer
                attribution='&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              {coverageDocs.map((c) => {
                const la = c.terminal.latitude;
                const lo = c.terminal.longitude;
                if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
                const tRad = Number(c.terminal.geofenceRadiusM) || 500;
                return (
                  <Fragment key={`cov-${c._id}`}>
                    <Circle
                      center={[la, lo]}
                      radius={tRad}
                      pathOptions={{
                        color: "rgba(16, 185, 129, 0.55)",
                        fillColor: "#34d399",
                        fillOpacity: 0.08,
                        weight: 2,
                      }}
                    />
                    <Marker position={[la, lo]} icon={MGMT_LOC_DEPLOYED_HEX_ICON} zIndexOffset={600}>
                      <Tooltip direction="top" offset={[0, -12]} opacity={1} className="mgmt-loc-map__leaflet-tip">
                        <div className="mgmt-loc-map__tip-title">{c.terminal?.name ?? c.locationName}</div>
                        <div className="mgmt-loc-map__tip-line">
                          <strong>Type:</strong> Major Hub
                        </div>
                        <div className="mgmt-loc-map__tip-line">
                          <strong>Pax Load:</strong> Low
                        </div>
                        <div className="mgmt-loc-map__tip-line mgmt-loc-map__tip-line--muted">
                          {la.toFixed(6)}, {lo.toFixed(6)}
                        </div>
                      </Tooltip>
                    </Marker>
                    {(c.stops || []).map((s, si) => {
                      if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) return null;
                      const flex = s.pickupOnly === false;
                      return (
                        <Marker
                          key={`cov-sg-${c._id}-${si}-${s.sequence}`}
                          position={[s.latitude, s.longitude]}
                          icon={flex ? MGMT_LOC_WAYPOINT_FLEX_ICON : MGMT_LOC_WAYPOINT_ICON}
                          zIndexOffset={500}
                        >
                          <Tooltip direction="top" offset={[0, -8]} opacity={1} className="mgmt-loc-map__leaflet-tip">
                            <div className="mgmt-loc-map__tip-line">
                              <strong>Type:</strong> Bus Stop <span className="mgmt-loc-map__tip-sep">|</span>{" "}
                              <strong>Corridor:</strong> {c.locationName}
                            </div>
                            <div className="mgmt-loc-map__tip-line mgmt-loc-map__tip-line--muted">{s.name}</div>
                          </Tooltip>
                        </Marker>
                      );
                    })}
                  </Fragment>
                );
              })}
              {showLocationWaypointPin && locationPinDisplay ? (
                <Marker position={locationPinDisplay} icon={MGMT_LOC_WAYPOINT_ICON} zIndexOffset={920}>
                  <Tooltip direction="top" offset={[0, -8]} opacity={1} className="mgmt-loc-map__leaflet-tip">
                    <div className="mgmt-loc-map__tip-line">
                      <strong>Type:</strong> Bus Stop <span className="mgmt-loc-map__tip-sep">|</span>{" "}
                      <strong>Corridor:</strong> {pickedLocationPin!.corridorName}
                    </div>
                    <div className="mgmt-loc-map__tip-line mgmt-loc-map__tip-line--muted">
                      {pickedLocationPin!.lat.toFixed(6)}, {pickedLocationPin!.lng.toFixed(6)}
                    </div>
                  </Tooltip>
                </Marker>
              ) : null}
              {hasValidCoords ? (
                <>
                  <Circle
                    center={[latNum, lngNum]}
                    radius={Number(terminalRadiusM) || 500}
                    pathOptions={{
                      color: "rgba(16, 185, 129, 0.88)",
                      fillColor: "#34d399",
                      fillOpacity: 0.11,
                      weight: 2,
                    }}
                  />
                  <Marker position={[latNum, lngNum]} icon={MGMT_LOC_TERMINAL_HEX_ICON} zIndexOffset={900}>
                    <Tooltip direction="top" offset={[0, -14]} opacity={1} className="mgmt-loc-map__leaflet-tip mgmt-loc-map__leaflet-tip--hub">
                      <div className="mgmt-loc-map__tip-title">
                        {pickedTerminalPin?.label || terminalName.trim() || name.trim() || "Terminal"}
                      </div>
                      <div className="mgmt-loc-map__tip-line">
                        <strong>Type:</strong> Major Hub
                      </div>
                      <div className="mgmt-loc-map__tip-line">
                        <strong>Pax Load:</strong> Med
                      </div>
                      <div className="mgmt-loc-map__tip-line mgmt-loc-map__tip-line--schedule">
                        Schedule Arriving when a bus enters this geofence (Live map)
                      </div>
                      <div className="mgmt-loc-map__tip-line mgmt-loc-map__tip-line--muted">
                        {latNum.toFixed(6)}, {lngNum.toFixed(6)}
                      </div>
                    </Tooltip>
                  </Marker>
                </>
              ) : null}
              {sortedStopsForRoute.map((s) => (
                <Marker
                  key={s.id}
                  position={[s.latitude, s.longitude]}
                  icon={s.pickupOnly === false ? MGMT_LOC_WAYPOINT_FLEX_ICON : MGMT_LOC_WAYPOINT_ICON}
                  zIndexOffset={880}
                >
                  <Tooltip direction="top" offset={[0, -8]} opacity={1} className="mgmt-loc-map__leaflet-tip">
                    <div className="mgmt-loc-map__tip-line">
                      <strong>Type:</strong> Bus Stop ({s.pickupOnly === false ? "Flexible" : "Strict"}){" "}
                      <span className="mgmt-loc-map__tip-sep">|</span> <strong>Corridor:</strong> {name.trim() || "—"}
                    </div>
                    <div className="mgmt-loc-map__tip-line mgmt-loc-map__tip-line--muted">{compressAddress(s.name)}</div>
                  </Tooltip>
                </Marker>
              ))}
              {selectedStops.length > 0 && hasValidCoords
                ? (() => {
                    const chain: [number, number][] = [
                      [latNum, lngNum],
                      ...sortedStopsForRoute.map((s) => [s.latitude, s.longitude] as [number, number]),
                    ];
                    const out: JSX.Element[] = [];
                    for (let i = 0; i < chain.length - 1; i++) {
                      const flexible = i > 0 && sortedStopsForRoute[i - 1]?.pickupOnly === false;
                      out.push(
                        <Polyline
                          key={`draft-cor-${i}`}
                          positions={[chain[i]!, chain[i + 1]!]}
                          pathOptions={{
                            color: flexible ? "#5eead4" : "#4a6bbe",
                            weight: 3,
                            opacity: 0.88,
                            dashArray: flexible ? "10 8" : undefined,
                          }}
                        />
                      );
                    }
                    return out;
                  })()
                : null}
            </MapContainer>
          </div>
          <p className="mgmt-loc-map__coord">
            <span className="mgmt-loc-map__coord__label">
              {hasValidCoords
                ? "Terminal WGS84 (deploy hub)"
                : pickedLocationPin
                  ? "Location waypoint only — set terminal below to deploy"
                  : "Map reference"}
            </span>
            <br />
            {mapCoordDisplay.lat.toFixed(6)}, {mapCoordDisplay.lng.toFixed(6)}
          </p>
          <div className="mgmt-loc-map__legend" aria-label="Map pin legend">
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--loc" /> Corridor waypoint
            </span>
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--term" /> Terminal hub
            </span>
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--stop" /> Route bus stop
            </span>
            <span>
              <i className="mgmt-loc-map__swatch mgmt-loc-map__swatch--dep" /> Deployed
            </span>
          </div>
        </section>
      </div>

      {recentDeployedCorridors.length > 0 ? (
        <section className="mgmt-loc-recent">
          <h3 className="mgmt-loc-recent__title">Tactical corridor · recently deployed</h3>
          <div className="mgmt-loc-recent__list">
            {recentDeployedCorridors.map(({ cov, activeInEditor }) => {
              return (
                <div
                  key={cov._id}
                  className={
                    "mgmt-loc-recent__parent mgmt-loc-recent__parent--compact" +
                    (activeInEditor ? " mgmt-loc-recent__parent--corridor-active" : "")
                  }
                >
                  <article className="mgmt-loc-recent__item mgmt-loc-recent__item--compact">
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
                    {activeInEditor ? <span className="mgmt-loc-recent__pulse-dot" title="Within editor corridor radius" aria-hidden /> : null}
                    <div className="mgmt-loc-recent__glass-sheet" aria-hidden />
                    <div className="mgmt-loc-recent__content mgmt-loc-recent__content--compact">
                      <span className="mgmt-loc-recent__card-title">{cov.locationName}</span>
                    </div>
                    <div className="mgmt-loc-recent__bottom mgmt-loc-recent__bottom--glass-actions">
                      <div className="att-glass-card__actions">
                        <Link
                          className="att-glass-card__action att-glass-card__action--view"
                          to={`/dashboard/management/locations/${encodeURIComponent(cov._id)}`}
                        >
                          View
                        </Link>
                        <button type="button" className="att-glass-card__action" onClick={() => loadCoverageIntoForm(cov)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="att-glass-card__action att-glass-card__action--delete"
                          onClick={() => void handleDeleteCoverage(cov._id)}
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

    </div>
  );
}

function BusManagementPanel() {
  const { showError, showSuccess } = useToast();
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [operators, setOperators] = useState<AttendantVerifiedSummary[]>([]);
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [corridorRoutes, setCorridorRoutes] = useState<CorridorRouteRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBus, setEditingBus] = useState<BusRow | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [bRes, oRes, dRes, routesRes] = await Promise.all([
        api<{ items: BusRow[] }>("/api/buses"),
        api<{ items: AttendantVerifiedSummary[] }>("/api/attendants/verified"),
        api<{ items: DriverSummary[] }>("/api/drivers/verified"),
        fetchCorridorRoutes().catch(() => ({ items: [] as CorridorRouteRow[] })),
      ]);
      setBuses(bRes.items);
      setOperators(oRes.items);
      setDrivers(dRes.items);
      setCorridorRoutes(routesRes.items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load bus management data";
      if (!shouldSilenceTicketingUnavailable(msg)) showError(msg);
      setBuses([]);
      setOperators([]);
      setDrivers([]);
      setCorridorRoutes([]);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!modalOpen) return;
    void fetchCorridorRoutes()
      .then((r) => setCorridorRoutes(r.items))
      .catch(() => {});
  }, [modalOpen]);

  const operatorName = useMemo(() => {
    const m = new Map<string, string>();
    operators.forEach((o) => {
      m.set(o.operatorId, `${o.firstName} ${o.lastName}`.trim());
    });
    return m;
  }, [operators]);

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
          plateNumber: data.plateNumber.trim() || null,
          seatCapacity: data.seatCapacity,
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

  async function handleDeleteBus(b: BusRow) {
    const r = await Swal.fire({
      title: "Delete from registry?",
      html: `This permanently removes the bus and its GPS cache. Tickets in the database are not deleted.<br/><br/>Type <strong>${b.busNumber}</strong> to confirm.`,
      input: "text",
      inputPlaceholder: b.busNumber,
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: "Delete bus",
      cancelButtonText: "Cancel",
      customClass: {
        container: "app-swal-glass-backdrop",
        popup: "app-swal-popup app-swal-popup--glass",
        confirmButton: "app-swal-confirm app-swal-confirm--danger",
        cancelButton: "app-swal-cancel app-swal-cancel--glass",
      },
      buttonsStyling: false,
      inputValidator: (value) =>
        String(value || "").trim() !== b.busNumber ? "Type the bus number exactly to confirm." : undefined,
    });
    if (!r.isConfirmed) return;
    setSaving(true);
    try {
      await api(`/api/buses/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      showSuccess("Bus removed from registry.");
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not delete bus.");
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
          </div>
          <button
            type="button"
            className="mgmt-bus-panel__cta"
            onClick={() => {
              setEditingBus(null);
              setModalOpen(true);
            }}
          >
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
          <div className="mgmt-bus-grid mgmt-bus-grid--glass">
            {buses.map((b) => {
              const tone = healthTone(b.healthStatus, b.ticketsIssued);
              const attendant = b.operatorId != null ? operatorName.get(b.operatorId) ?? `ID ${b.operatorId}` : "Unassigned";
              return (
                <FleetBusGlassCard
                  key={b.id}
                  bus={b}
                  attendantLabel={attendant}
                  healthTone={tone}
                  busy={saving}
                  onEdit={() => {
                    setEditingBus(b);
                    setModalOpen(true);
                  }}
                  onDelete={() => void handleDeleteBus(b)}
                />
              );
            })}
          </div>
        )}
      </section>

      <AddBusModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingBus(null);
        }}
        onSave={handleSaveBus}
        busToEdit={editingBus}
        onUpdateAssignments={async (busId, data) => {
          await api(`/api/buses/${encodeURIComponent(busId)}`, {
            method: "PATCH",
            json: {
              operatorId: data.operatorId || null,
              driverId: data.driverId || null,
              route: data.route || null,
              plateNumber: data.plateNumber.trim() || null,
              seatCapacity: data.seatCapacity,
            },
          });
          showSuccess("Bus assignments updated.");
          setModalOpen(false);
          setEditingBus(null);
          await refresh();
        }}
        operators={operators}
        drivers={drivers}
        corridorRoutes={corridorRoutes}
        saving={saving}
      />
    </div>
  );
}

function MgmtBackLink() {
  return (
    <Link to="/dashboard/management" className="mgmt-mod__back">
      <span className="mgmt-mod__back-glass" aria-hidden>
        <svg className="mgmt-mod__back-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="mgmt-mod__back-label">Back to management</span>
    </Link>
  );
}

function AdminManagementActivityPanel() {
  const adminProfiles = [
    { email: "bukidnonbuscompany2025@gmail.com", label: "Bukidnon Bus Company Admin" },
    { email: "2301108330@student.buksu.edu.ph", label: "BukSU Student Admin" },
  ] as const;
  const [selectedEmail, setSelectedEmail] = useState<string>(adminProfiles[0].email);
  const [logs, setLogs] = useState<AdminAuditLogRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminAuditLog(250);
      const filtered = (res.items ?? []).filter((row) => {
        const action = String(row.action || "").toUpperCase();
        return action === "ADD" || action === "EDIT" || action === "DELETE" || action === "BROADCAST";
      });
      setLogs(filtered);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load admin activity.");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedLogs = useMemo(
    () => logs.filter((row) => row.email.trim().toLowerCase() === selectedEmail.trim().toLowerCase()),
    [logs, selectedEmail]
  );

  return (
    <section className="mgmt-admins">
      <div className="mgmt-admins__cards">
        {adminProfiles.map((admin) => {
          const isActive = selectedEmail === admin.email;
          const count = logs.filter((row) => row.email.trim().toLowerCase() === admin.email.toLowerCase()).length;
          return (
            <button
              key={admin.email}
              type="button"
              className={"mgmt-admins__card" + (isActive ? " mgmt-admins__card--active" : "")}
              onClick={() => setSelectedEmail(admin.email)}
            >
              <div className="mgmt-admins__card-title">{admin.label}</div>
              <div className="mgmt-admins__card-email">{admin.email}</div>
              <div className="mgmt-admins__card-meta">{count} tracked actions</div>
            </button>
          );
        })}
      </div>
      <div className="mgmt-admins__activity">
        <h3 className="mgmt-admins__activity-title">Recent actions for {selectedEmail}</h3>
        {loading ? <p className="mgmt-admins__empty">Loading admin activity…</p> : null}
        {!loading && error ? (
          <p className="mgmt-admins__empty">
            {error}{" "}
            <button type="button" className="route-mgmt-panel__delete" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : null}
        {!loading && !error && selectedLogs.length === 0 ? (
          <p className="mgmt-admins__empty">No add/edit/delete/broadcast actions recorded for this admin yet.</p>
        ) : null}
        {!loading && !error && selectedLogs.length > 0 ? (
          <ul className="mgmt-admins__activity-list">
            {selectedLogs.slice(0, 25).map((row) => (
              <li key={row.id} className="mgmt-admins__activity-item">
                <span className="mgmt-admins__activity-badge">{row.action}</span>
                <span className="mgmt-admins__activity-detail">{row.details}</span>
                <span className="mgmt-admins__activity-meta">
                  {row.module} ·{" "}
                  {new Date(row.timestamp).toLocaleString(undefined, {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                  {row.statusCode != null ? ` · HTTP ${row.statusCode}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
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
          <MgmtBackLink />
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
          key === "schedules" ||
          key === "fares"
            ? " mgmt-mod--wide"
            : "") +
          (key === "passengers" ? " mgmt-mod--passenger" : "")
        }
      >
        <MgmtBackLink />
        <header className="mgmt-mod__head">
          <h1 className="mgmt-mod__title">{copy.title}</h1>
          <p className="mgmt-mod__sub">{copy.subtitle}</p>
        </header>
        <div className="mgmt-mod__placeholder">
          {key === "passengers" ? <PassengerManagementPanel /> : null}
          {key === "locations" ? <LocationManagementPanel /> : null}
          {key === "buses" ? <BusManagementPanel /> : null}
          {key === "attendants" ? <AttendantManagementPanel /> : null}
          {key === "drivers" ? <DriverManagementPanel /> : null}

          {key === "fares" ? <FareManagementPanel /> : null}

          {key === "routes" ? <RouteManagementPanel /> : null}

          {key === "schedules" ? <ScheduleManagementPanel /> : null}

          {key === "admins" ? <AdminManagementActivityPanel /> : null}

          {key !== "passengers" &&
          key !== "buses" &&
          key !== "attendants" &&
          key !== "drivers" &&
          key !== "locations" &&
          key !== "fares" &&
          key !== "routes" &&
          key !== "schedules" &&
          key !== "admins" ? (
            <p>Detailed tools for this area will be connected here.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
