import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { MgmtBackLink } from "@/components/MgmtBackLink";
import { RouteCorridorEfficiencyRing } from "@/components/RouteCorridorEfficiencyRing";
import { RouteCorridorMapInset } from "@/components/RouteCorridorMapInset";
import { api, fetchCorridorRoutes, patchCorridorRoute } from "@/lib/api";
import { haversineMeters } from "@/lib/haversineMeters";
import { useToast } from "@/context/ToastContext";
import { swalConfirm } from "@/lib/swal";
import type { BusLiveLogRow, BusRow, CorridorRouteRow, TicketRow } from "@/lib/types";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";
import "./RouteTacticalDossier.css";

const OID_RE = /^[a-f0-9]{24}$/i;

/** Split route titles like "A → B → C" so middle segments show when no via hubs are stored. */
function parseCorridorDisplayPath(displayName: string): string[] {
  const t = displayName.trim();
  if (!t) return [];
  return t
    .split(/\s*(?:→|->|⇄|↔)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function RouteDetailPage() {
  const { showError, showSuccess } = useToast();
  const raw = useParams().routeId;
  const routeId = raw ? decodeURIComponent(raw) : "";

  const [route, setRoute] = useState<CorridorRouteRow | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [liveRows, setLiveRows] = useState<BusLiveLogRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dockBusy, setDockBusy] = useState(false);

  const reloadRoute = useCallback(async () => {
    const { items } = await fetchCorridorRoutes();
    const found = items.find((r) => r._id === routeId) ?? null;
    setRoute(found);
    return found;
  }, [routeId]);

  useEffect(() => {
    if (!routeId || !OID_RE.test(routeId)) {
      setRoute(null);
      setErr("Invalid route id.");
      return;
    }
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const found = await reloadRoute();
        if (!cancelled && !found) setErr("Corridor route not found.");
      } catch (e) {
        if (!cancelled) {
          setRoute(null);
          setErr(e instanceof Error ? e.message : "Failed to load routes.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeId, reloadRoute]);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await api<{ items: BusLiveLogRow[] }>("/api/buses/live");
        if (!cancelled) setLiveRows(res.items ?? []);
      } catch {
        if (!cancelled) setLiveRows([]);
      }
    };
    void pull();
    const t = window.setInterval(() => void pull(), 14_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: TicketRow[] }>("/api/tickets");
        if (!cancelled) setTickets(res.items ?? []);
      } catch {
        if (!cancelled) setTickets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: BusRow[] }>("/api/buses");
        if (!cancelled) setBuses(res.items ?? []);
      } catch {
        if (!cancelled) setBuses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayCorridorName = route
    ? route.displayName?.trim() || `${route.originLabel} → ${route.destLabel}`
    : "";
  const routeKey = displayCorridorName.trim().toLowerCase();

  const sortedStops = useMemo(() => {
    if (!route) return [];
    return route.authorizedStops.slice().sort((a, b) => a.sequence - b.sequence);
  }, [route]);

  const polyline = useMemo(() => {
    return sortedStops
      .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
      .map((s) => [s.latitude, s.longitude] as [number, number]);
  }, [sortedStops]);

  const busesOnCorridor = useMemo(() => {
    if (!routeKey) return [];
    return buses.filter((b) => b.route && b.route.trim().toLowerCase() === routeKey);
  }, [buses, routeKey]);

  const liveOnCorridor = useMemo(() => {
    const ids = new Set(busesOnCorridor.map((b) => b.busId));
    return liveRows.filter((r) => ids.has(r.busId) && Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  }, [busesOnCorridor, liveRows]);

  const efficiencyPct = useMemo(() => {
    if (!route) return 0;
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const busNumbers = new Set(
      busesOnCorridor.map((b) => String(b.busNumber || "").trim()).filter(Boolean)
    );
    const todayTickets = tickets.filter((t) => {
      const bn = String(t.busNumber || "").trim();
      if (!bn || !busNumbers.has(bn)) return false;
      const dt = new Date(t.createdAt);
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    }).length;
    const nominalSeats = busesOnCorridor.reduce((sum, b) => sum + (b.seatCapacity && b.seatCapacity > 0 ? b.seatCapacity : 50), 0);
    if (nominalSeats <= 0) return 0;
    const loadPct = Math.min(100, (todayTickets / nominalSeats) * 100);
    const liveSignalBoost = Math.min(8, liveOnCorridor.length * 2);
    return Math.max(0, Math.min(99, Math.round(loadPct + liveSignalBoost)));
  }, [route, busesOnCorridor, liveOnCorridor.length, tickets]);

  const trackedLive = liveOnCorridor.length > 0;
  const isSuspended = route?.suspended === true;
  const showActivePulse = !isSuspended && trackedLive;

  async function handleSuspendToggle(suspend: boolean) {
    if (!route) return;
    const msg = suspend
      ? "Suspend this corridor? Assigned buses keep their route label until you edit them."
      : "Resume this corridor for live tracking and dispatch surfaces?";
    if (
      !(await swalConfirm({
        title: suspend ? "Suspend corridor?" : "Resume corridor?",
        text: msg,
        icon: "question",
        confirmButtonText: suspend ? "Suspend" : "Resume",
      }))
    )
      return;
    setDockBusy(true);
    try {
      await patchCorridorRoute(route._id, { suspended: suspend });
      showSuccess(suspend ? "Corridor suspended." : "Corridor resumed.");
      await reloadRoute();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setDockBusy(false);
    }
  }

  /** When there are no authorized stops, the list is: explicit via terminals, else multi-part displayName, else origin→dest only. */
  const corridorPathLabels = useMemo(() => {
    if (!route) return [];
    const vias = route.viaLabels ?? [];
    if (vias.length > 0) {
      return [route.originLabel, ...vias, route.destLabel];
    }
    const fromName = parseCorridorDisplayPath(route.displayName || "");
    if (fromName.length >= 3) {
      return fromName;
    }
    return [route.originLabel, ...vias, route.destLabel];
  }, [route]);

  if (route === undefined) {
    return (
      <ManagementDetailShell backModule="routes" title="Route details" subtitle="Loading…">
        <p className="mgmt-mod__unknown">Loading…</p>
      </ManagementDetailShell>
    );
  }

  if (err || !route) {
    return (
      <ManagementDetailShell backModule="routes" title="Route details" subtitle="Corridor">
        <p className="mgmt-mod__unknown">{err ?? "Not found."}</p>
      </ManagementDetailShell>
    );
  }

  return (
    <div className="admin-mgmt">
      <div className="mgmt-mod mgmt-mod--wide">
        <div className="rte-dossier">
          <div className="rte-dossier__topbar">
            <MgmtBackLink to="/dashboard/management/routes" label="Route command" className="rte-dossier__mgmt-back" />
          </div>

          <header className="rte-dossier__header">
            <h1 className="rte-dossier__title">{displayCorridorName}</h1>
            <div className="rte-dossier__status" aria-live="polite">
              <span
                className={
                  "rte-dossier__status-dot " +
                  (showActivePulse ? "rte-dossier__status-dot--live" : "rte-dossier__status-dot--idle")
                }
              />
              {isSuspended ? "Suspended" : showActivePulse ? "Active · live tracking" : "Standby · no live pings"}
            </div>
          </header>
          <p className="rte-dossier__sub">
            Strategic corridor dossier · {sortedStops.length} waypoint{sortedStops.length === 1 ? "" : "s"} ·{" "}
            <span className="rte-dossier__mono" style={{ fontSize: "0.78rem" }}>
              {route._id}
            </span>
          </p>

          <div className="rte-dossier__telemetry">
            <div className="rte-dossier__tile">
              <span className="rte-dossier__tile-label">Origin</span>
              <p className="rte-dossier__tile-value">{route.originLabel}</p>
            </div>
            <div className="rte-dossier__tile">
              <span className="rte-dossier__tile-label">Destination</span>
              <p className="rte-dossier__tile-value">{route.destLabel}</p>
            </div>
            <div className="rte-dossier__tile">
              <span className="rte-dossier__tile-label">Route ID</span>
              <p className="rte-dossier__mono">{route._id}</p>
            </div>
          </div>

          <div className="rte-dossier__row-split">
            <section className="rte-dossier__module">
              <h2 className="rte-dossier__module-title">Corridor map inset</h2>
              <RouteCorridorMapInset
                corridorLine={polyline}
                hubPins={route.corridorHubPins}
                liveBuses={liveOnCorridor}
              />
            </section>
            <section className="rte-dossier__module">
              <h2 className="rte-dossier__module-title">Passenger efficiency</h2>
              <div className="rte-dossier__ring-wrap">
                <RouteCorridorEfficiencyRing efficiencyPct={efficiencyPct} caption="Passenger efficiency" />
              </div>
            </section>
          </div>

          <section className="rte-dossier__module rte-dossier__module--span">
            <h2 className="rte-dossier__module-title">Waypoint status</h2>
            <div className="rte-dossier__timeline">
              {sortedStops.length === 0 ? (
                corridorPathLabels.map((label, idx) => {
                  const role =
                    idx === 0 ? "Start" : idx === corridorPathLabels.length - 1 ? "Destination" : "Via";
                  return (
                    <div key={`${role}-${idx}-${label}`} className="rte-dossier__timeline-item">
                      <div className="rte-dossier__timeline-rail">
                        {idx < corridorPathLabels.length - 1 ? (
                          <div className="rte-dossier__timeline-line" aria-hidden />
                        ) : null}
                        <span className="rte-dossier__timeline-dot rte-dossier__timeline-dot--idle" />
                      </div>
                      <div className="rte-dossier__timeline-body">
                        <p className="rte-dossier__timeline-name">{label}</p>
                        <p className="rte-dossier__timeline-meta">{role} · corridor path</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                sortedStops.map((s, idx) => {
                    const radius = Math.max(120, s.geofenceRadiusM ?? 100);
                    const atStop = !isSuspended && liveOnCorridor.some(
                      (b) => haversineMeters(b.latitude, b.longitude, s.latitude, s.longitude) <= radius
                    );
                    const approaching =
                      !isSuspended &&
                      !atStop &&
                      liveOnCorridor.some((b) => {
                        const d = haversineMeters(b.latitude, b.longitude, s.latitude, s.longitude);
                        return d > radius && d < 2200;
                      });
                    let statusLine = "Scheduled · terminal sync";
                    if (isSuspended) statusLine = "Suspended · offline";
                    else if (atStop) statusLine = "Live · at platform";
                    else if (approaching) statusLine = "Live · approaching";
                    else if (liveOnCorridor.length > 0) statusLine = "Corridor active · no ping at stop";
                    return (
                      <div key={`${s.coverageId}-${s.sequence}`} className="rte-dossier__timeline-item">
                        <div className="rte-dossier__timeline-rail">
                          {idx < sortedStops.length - 1 ? <div className="rte-dossier__timeline-line" aria-hidden /> : null}
                          <span
                            className={
                              "rte-dossier__timeline-dot " +
                              (atStop && !isSuspended ? "" : "rte-dossier__timeline-dot--idle")
                            }
                          />
                        </div>
                        <div className="rte-dossier__timeline-body">
                          <p className="rte-dossier__timeline-name">{s.name}</p>
                          <p className="rte-dossier__timeline-meta">
                            seq {s.sequence} · cov {s.coverageId} · {statusLine}
                          </p>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </section>

          <footer className="rte-dossier__dock">
            {isSuspended ? (
              <button
                type="button"
                className="rte-dossier__dock-btn rte-dossier__dock-btn--blue"
                disabled={dockBusy}
                onClick={() => void handleSuspendToggle(false)}
              >
                Resume route
              </button>
            ) : (
              <button
                type="button"
                className="rte-dossier__dock-btn rte-dossier__dock-btn--red"
                disabled={dockBusy}
                onClick={() => void handleSuspendToggle(true)}
              >
                Suspend route
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
