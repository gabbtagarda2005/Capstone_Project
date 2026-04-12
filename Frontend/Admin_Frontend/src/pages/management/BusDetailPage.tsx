import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MgmtBackLink } from "@/components/MgmtBackLink";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Swal from "sweetalert2";
import { api, fetchCorridorRoutes } from "@/lib/api";
import { isFastPulse, makeBusDivIcon } from "@/lib/locationsMapUtils";
import { swalAlert, swalConfirm } from "@/lib/swal";
import type { AttendantVerifiedSummary, BusLiveLogRow, BusRow, CorridorRouteRow, TicketRow } from "@/lib/types";
import { useToast } from "@/context/ToastContext";
import "./BusDetailPage.css";

const BUK_CENTER: [number, number] = [8.0515, 125.0];
const BEACON_MS = 120_000;
const GAUGE_R = 52;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

function beaconFresh(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < BEACON_MS;
}

function formatMonoTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function findCorridor(routeLabel: string | null, corridors: CorridorRouteRow[]): CorridorRouteRow | null {
  if (!routeLabel?.trim()) return null;
  const low = routeLabel.trim().toLowerCase();
  const exact = corridors.find(
    (c) => `${c.originLabel} → ${c.destLabel}`.toLowerCase() === low || c.displayName.toLowerCase() === low
  );
  if (exact) return exact;
  return (
    corridors.find((c) => low.includes(c.originLabel.toLowerCase()) && low.includes(c.destLabel.toLowerCase())) ||
    corridors.find((c) => c.displayName.toLowerCase().includes(low.slice(0, 12))) ||
    null
  );
}

function polylineFromCorridor(c: CorridorRouteRow): [number, number][] {
  return [...c.authorizedStops]
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => [s.latitude, s.longitude] as [number, number]);
}

function ticketsTodayForBus(tickets: TicketRow[], busNumber: string): TicketRow[] {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const bn = busNumber.trim();
  return tickets.filter((t) => {
    if ((t.busNumber || "").trim() !== bn) return false;
    const dt = new Date(t.createdAt);
    return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
  });
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  const a = p[0]?.[0] ?? "?";
  const b = p[1]?.[0] ?? "";
  return (a + b).toUpperCase();
}

function maintBlockClass(health: string): string {
  if (health.includes("Inspection")) return "bus-hub__maint bus-hub__maint--red";
  if (health.includes("Maintenance")) return "bus-hub__maint bus-hub__maint--amber";
  return "bus-hub__maint";
}

function CapacityGauge({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const off = GAUGE_C - (pct / 100) * GAUGE_C;
  return (
    <div className="bus-hub__gauge-wrap">
      <div className="bus-hub__gauge">
        <svg className="bus-hub__gauge-svg" viewBox="0 0 120 120">
          <circle className="bus-hub__gauge-track" cx="60" cy="60" r={GAUGE_R} />
          <circle
            className="bus-hub__gauge-fill"
            cx="60"
            cy="60"
            r={GAUGE_R}
            strokeDasharray={GAUGE_C}
            strokeDashoffset={off}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="bus-hub__gauge-center">
          <span className="bus-hub__gauge-num">{current}</span>
          <span className="bus-hub__gauge-den"> / {total}</span>
          <span className="bus-hub__gauge-cap">seats</span>
        </div>
      </div>
    </div>
  );
}

function plateDisplay(bus: BusRow): string {
  const p = bus.plateNumber?.trim();
  if (p && p !== "—" && p !== "-" && p !== "–") return p;
  return "Not set";
}

export function BusDetailPage() {
  const { busId } = useParams();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [bus, setBus] = useState<BusRow | null | undefined>(undefined);
  const [live, setLive] = useState<BusLiveLogRow | null>(null);
  const [corridors, setCorridors] = useState<CorridorRouteRow[]>([]);
  const [operators, setOperators] = useState<AttendantVerifiedSummary[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tripOpen, setTripOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadBus = useCallback(async () => {
    if (!bus?.id) return;
    const b = await api<BusRow>(`/api/buses/${encodeURIComponent(bus.id)}`);
    setBus(b);
  }, [bus?.id]);

  const pollLive = useCallback(async () => {
    if (!bus?.busId) return;
    try {
      const res = await api<{ items: BusLiveLogRow[] }>("/api/buses/live");
      const row = res.items.find((x) => x.busId === bus.busId) ?? null;
      setLive(row);
    } catch {
      /* keep previous */
    }
  }, [bus?.busId]);

  useEffect(() => {
    const param = busId?.trim();
    if (!param) {
      setBus(null);
      setErr("Invalid bus id.");
      return;
    }
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const [b, cor, ops, tix] = await Promise.all([
          api<BusRow>(`/api/buses/${encodeURIComponent(param)}`),
          fetchCorridorRoutes().catch(() => ({ items: [] as CorridorRouteRow[] })),
          api<{ items: AttendantVerifiedSummary[] }>("/api/attendants/verified").catch(() => ({ items: [] })),
          api<{ items: TicketRow[] }>("/api/tickets").catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setBus(b);
        setCorridors(cor.items);
        setOperators(ops.items);
        setTickets(tix.items);
      } catch (e) {
        if (!cancelled) {
          setBus(null);
          setErr(e instanceof Error ? e.message : "Could not load bus.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [busId]);

  useEffect(() => {
    if (!bus?.busId) return;
    void pollLive();
    const t = window.setInterval(() => void pollLive(), 8000);
    return () => clearInterval(t);
  }, [bus?.busId, pollLive]);

  const corridor = useMemo(() => (bus ? findCorridor(bus.route, corridors) : null), [bus, corridors]);

  const polyline = useMemo(() => (corridor ? polylineFromCorridor(corridor) : []), [corridor]);

  const attendantName = useMemo(() => {
    if (!bus?.operatorId) return "Unassigned";
    const o = operators.find((x) => x.operatorId === bus.operatorId);
    return o ? `${o.firstName} ${o.lastName}`.trim() : `Operator ${bus.operatorId}`;
  }, [bus?.operatorId, operators]);

  const todayForBus = useMemo(() => (bus ? ticketsTodayForBus(tickets, bus.busNumber) : []), [bus, tickets]);

  const effectiveLive = useMemo((): BusLiveLogRow | null => {
    if (live && Number.isFinite(live.latitude) && Number.isFinite(live.longitude)) return live;
    const g = bus?.latestGps;
    if (bus && g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
      return {
        busId: bus.busId,
        latitude: g.latitude,
        longitude: g.longitude,
        speedKph: g.speedKph ?? null,
        heading: g.heading ?? null,
        recordedAt: g.recordedAt ?? undefined,
      };
    }
    return null;
  }, [live, bus]);

  const mapCenter: [number, number] =
    effectiveLive && Number.isFinite(effectiveLive.latitude) && Number.isFinite(effectiveLive.longitude)
      ? [effectiveLive.latitude, effectiveLive.longitude]
      : BUK_CENTER;

  const beaconLive = beaconFresh(effectiveLive?.recordedAt) || beaconFresh(bus?.lastSeenAt ?? null);

  const timelineRows = useMemo(() => {
    if (!bus) return [];
    const pingAt = effectiveLive?.recordedAt ?? bus.lastSeenAt ?? null;
    const rows: { label: string; time: string }[] = [{ label: "Last GPS update", time: formatMonoTime(pingAt) }];
    if (corridor?.displayName?.trim()) {
      rows.push({ label: "Corridor", time: corridor.displayName.trim() });
    } else if (bus.route?.trim()) {
      rows.push({ label: "Assigned route", time: bus.route.trim() });
    }
    return rows;
  }, [bus, effectiveLive, corridor]);

  async function handleReassignRoute() {
    if (!bus?.id || !corridors.length) {
      await swalAlert("No corridor definitions loaded. Configure routes in Route management first.", { icon: "info" });
      return;
    }
    const inputOptions: Record<string, string> = {};
    corridors.forEach((c) => {
      inputOptions[c._id] = c.displayName;
    });
    const r = await Swal.fire({
      title: "Reassign corridor",
      input: "select",
      inputOptions,
      showCancelButton: true,
      focusCancel: true,
      customClass: { popup: "app-swal-popup", confirmButton: "app-swal-confirm", cancelButton: "app-swal-cancel" },
      buttonsStyling: false,
    });
    if (!r.isConfirmed || !r.value) return;
    const c = corridors.find((x) => x._id === r.value);
    if (!c) return;
    const routeStr = `${c.originLabel} → ${c.destLabel}`;
    setBusy(true);
    try {
      await api(`/api/buses/${encodeURIComponent(bus.id)}`, {
        method: "PATCH",
        json: { route: routeStr },
      });
      showSuccess("Corridor updated.");
      await loadBus();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not update route.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEditPlate() {
    if (!bus?.id) return;
    const r = await Swal.fire({
      title: "Edit plate number",
      input: "text",
      inputLabel: "License plate (as on the vehicle)",
      inputValue: plateDisplay(bus) === "Not set" ? "" : plateDisplay(bus),
      showCancelButton: true,
      focusCancel: true,
      confirmButtonText: "Save",
      customClass: { popup: "app-swal-popup", confirmButton: "app-swal-confirm", cancelButton: "app-swal-cancel" },
      buttonsStyling: false,
    });
    if (!r.isConfirmed) return;
    const plate = String(r.value ?? "").trim();
    setBusy(true);
    try {
      await api(`/api/buses/${encodeURIComponent(bus.id)}`, {
        method: "PATCH",
        json: { plateNumber: plate.length ? plate : null },
      });
      showSuccess("Plate number updated.");
      await loadBus();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not update plate.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteBus() {
    if (!busId || !bus) return;
    const r = await Swal.fire({
      title: "Delete from registry?",
      html: `This permanently removes the bus and its GPS cache. Tickets in the database are not deleted.<br/><br/>Type <strong>${bus.busNumber}</strong> to confirm.`,
      input: "text",
      inputPlaceholder: bus.busNumber,
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
        String(value || "").trim() !== bus.busNumber ? "Type the bus number exactly to confirm." : undefined,
    });
    if (!r.isConfirmed) return;
    setBusy(true);
    try {
      await api(`/api/buses/${encodeURIComponent(bus.id)}`, { method: "DELETE" });
      showSuccess("Bus removed from registry.");
      navigate("/dashboard/management/buses");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not delete bus.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate() {
    if (!bus?.id) return;
    const ok = await swalConfirm({
      title: "Deactivate unit?",
      text: `${bus.busNumber} will be hidden on the passenger live map. Assigned attendants cannot sign in or issue tickets until you reactivate the bus.`,
      icon: "warning",
      confirmButtonText: "Deactivate",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/buses/${encodeURIComponent(bus.id)}`, {
        method: "PATCH",
        json: { status: "Inactive" },
      });
      showSuccess("Bus deactivated.");
      await loadBus();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not deactivate.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReactivate() {
    if (!bus?.id) return;
    const ok = await swalConfirm({
      title: "Reactivate unit?",
      text: `${bus.busNumber} will return to Active status, appear on the passenger map (when reporting GPS), and attendants can sign in again.`,
      icon: "question",
      confirmButtonText: "Reactivate",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/buses/${encodeURIComponent(bus.id)}`, {
        method: "PATCH",
        json: { status: "Active" },
      });
      showSuccess("Bus reactivated.");
      await loadBus();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not reactivate.");
    } finally {
      setBusy(false);
    }
  }

  const busIsInactive = String(bus?.status || "").trim() === "Inactive";

  const revenueToday = todayForBus.reduce((s, t) => s + t.fare, 0);

  if (bus === undefined) {
    return (
      <div className="bus-hub">
        <p className="bus-hub__loading">Loading command hub…</p>
      </div>
    );
  }

  if (err || !bus) {
    return (
      <div className="bus-hub">
        <MgmtBackLink to="/dashboard/management/buses" label="Fleet registry" className="bus-hub__mgmt-back" />
        <p className="bus-hub__error">{err ?? "Bus not found."}</p>
      </div>
    );
  }

  const nominalSeats =
    typeof bus.seatCapacity === "number" && Number.isFinite(bus.seatCapacity) && bus.seatCapacity > 0 ? bus.seatCapacity : 50;

  return (
    <div className="bus-hub">
      <MgmtBackLink to="/dashboard/management/buses" label="Fleet registry" className="bus-hub__mgmt-back" />

      <header className="bus-hub__head">
        <h1 className="bus-hub__title">{bus.busNumber}</h1>
        <p className="bus-hub__sub">
          Tactical command hub · Status <span className="bus-hub__mono">{bus.status}</span>
        </p>
      </header>

      <div className="bus-hub__grid">
        <div className="bus-hub__tile">
          <div className="bus-hub__tile-label">Plate number</div>
          <div
            className={
              "bus-hub__mono bus-hub__mono--lg" + (plateDisplay(bus) === "Not set" ? " bus-hub__mono--muted" : "")
            }
          >
            {plateDisplay(bus)}
          </div>
        </div>
        <div className="bus-hub__tile">
          <div className="bus-hub__tile-label">Bus type</div>
          <div className="bus-hub__mono bus-hub__mono--lg">Regular</div>
        </div>
        <div className="bus-hub__tile">
          <div className="bus-hub__tile-label">Seat capacity</div>
          <div className="bus-hub__mono bus-hub__mono--lg">{nominalSeats} seats</div>
        </div>

        <div className="bus-hub__tile bus-hub__grid--map" style={{ gridColumn: "1 / -1" }}>
          <div className="bus-hub__tile-label">Live position · Bukidnon corridor</div>
          <div className="bus-hub__map-wrap">
            <span className="bus-hub__map-badge">Dark matter · beacon</span>
            <MapContainer
              key={`${mapCenter[0].toFixed(4)}-${mapCenter[1].toFixed(4)}`}
              center={mapCenter}
              zoom={effectiveLive ? 12 : 10}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              />
              {polyline.length >= 2 ? (
                <Polyline positions={polyline} pathOptions={{ color: "#22d3ee", weight: 3, opacity: 0.55 }} />
              ) : null}
              {effectiveLive &&
              Number.isFinite(effectiveLive.latitude) &&
              Number.isFinite(effectiveLive.longitude) ? (
                <Marker
                  position={[effectiveLive.latitude, effectiveLive.longitude]}
                  icon={makeBusDivIcon(false, isFastPulse(bus.busId))}
                />
              ) : null}
            </MapContainer>
          </div>
        </div>

        <div className="bus-hub__tile">
          <div className="bus-hub__tile-label">Capacity gauge</div>
          <CapacityGauge current={todayForBus.length} total={nominalSeats} />
        </div>

        <div className="bus-hub__tile">
          <div className="bus-hub__tile-label">Position &amp; route</div>
          <div className="bus-hub__timeline">
            {timelineRows.map((row) => (
              <div key={row.label} className="bus-hub__timeline-row">
                <div className="bus-hub__timeline-label">{row.label}</div>
                <div className="bus-hub__timeline-time">{row.time}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bus-hub__tile">
          <div className="bus-hub__tile-label">Operational sync</div>
          <div className="bus-hub__profiles">
            <div className="bus-hub__profile">
              <div className="bus-hub__profile-avatar">{initials(attendantName)}</div>
              <div className="bus-hub__profile-meta">
                <div className="bus-hub__profile-role">Bus attendant</div>
                <div className="bus-hub__profile-name">{attendantName}</div>
              </div>
              <div className={beaconLive ? "bus-hub__pulse" : "bus-hub__pulse bus-hub__pulse--off"} title={beaconLive ? "Beacon active" : "No recent beacon"} />
            </div>
            <div className="bus-hub__profile">
              <div className="bus-hub__profile-avatar">{initials(bus.driverName || "?")}</div>
              <div className="bus-hub__profile-meta">
                <div className="bus-hub__profile-role">Driver</div>
                <div className="bus-hub__profile-name">{bus.driverName || "Unassigned"}</div>
              </div>
              <div className="bus-hub__pulse bus-hub__pulse--off" title="Driver beacon not tracked" />
            </div>
          </div>
        </div>

        <div className="bus-hub__tile" style={{ gridColumn: "1 / -1" }}>
          <div className="bus-hub__tile-label">Vehicle ID &amp; technical</div>
          <div className="bus-hub__mono" style={{ lineHeight: 1.7 }}>
            busId <strong style={{ color: "#fff" }}>{bus.busId}</strong>
            <br />
            IMEI <strong style={{ color: "#fff" }}>{bus.imei || "—"}</strong>
            <br />
            GPS (lat, lng){" "}
            <strong className="bus-hub__mono" style={{ color: "#fff" }}>
              {effectiveLive
                ? `${effectiveLive.latitude.toFixed(6)}, ${effectiveLive.longitude.toFixed(6)}`
                : "—"}
            </strong>
            <br />
            Tickets (lifetime) <strong style={{ color: "#fff" }}>{bus.ticketsIssued}</strong> · Strict pickup{" "}
            <strong style={{ color: "#fff" }}>{bus.strictPickup === true ? "on" : "off"}</strong>
          </div>
        </div>

        <div className={maintBlockClass(bus.healthStatus)} style={{ gridColumn: "1 / -1" }}>
          <div className="bus-hub__maint-title">Maintenance status</div>
          <div className="bus-hub__maint-text">{bus.healthStatus}</div>
        </div>
      </div>

      <footer className="bus-hub__dock" aria-label="Bus actions">
        <div className="bus-hub__dock-inner">
          <button type="button" className="bus-hub__dock-btn bus-hub__dock-btn--blue" disabled={busy} onClick={() => void handleReassignRoute()}>
            Reassign route
          </button>
          <button type="button" className="bus-hub__dock-btn bus-hub__dock-btn--blue" disabled={busy} onClick={() => setTripOpen(true)}>
            View trip logs
          </button>
          <button type="button" className="bus-hub__dock-btn bus-hub__dock-btn--blue" disabled={busy} onClick={() => void handleEditPlate()}>
            Edit plate
          </button>
          <button
            type="button"
            className={busIsInactive ? "bus-hub__dock-btn bus-hub__dock-btn--blue" : "bus-hub__dock-btn bus-hub__dock-btn--red"}
            disabled={busy}
            onClick={() => void (busIsInactive ? handleReactivate() : handleDeactivate())}
          >
            {busIsInactive ? "Reactivate unit" : "Deactivate unit"}
          </button>
          <button
            type="button"
            className="bus-hub__dock-btn bus-hub__dock-btn--delete"
            disabled={busy}
            onClick={() => void handleDeleteBus()}
          >
            Delete from registry
          </button>
        </div>
      </footer>

      {tripOpen ? (
        <div
          className="bus-hub__modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trip-logs-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTripOpen(false);
          }}
        >
          <div className="bus-hub__modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="trip-logs-title">Today&apos;s trips · {bus.busNumber}</h3>
            <p className="bus-hub__gauge-hint" style={{ marginBottom: "12px" }}>
              Tickets issued today for this bus: {todayForBus.length} · Revenue ₱{revenueToday.toFixed(2)}
            </p>
            <table className="bus-hub__table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Fare</th>
                </tr>
              </thead>
              <tbody>
                {todayForBus.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ fontFamily: "inherit", color: "rgba(248,250,252,0.5)" }}>
                      No tickets today for this bus.
                    </td>
                  </tr>
                ) : (
                  todayForBus.map((t) => (
                    <tr key={String(t.id)}>
                      <td>{formatMonoTime(t.createdAt)}</td>
                      <td>{t.startLocation}</td>
                      <td>{t.destination}</td>
                      <td>₱{t.fare.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <button type="button" className="bus-hub__modal-close" onClick={() => setTripOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
