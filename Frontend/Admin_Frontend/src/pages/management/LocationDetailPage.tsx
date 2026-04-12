import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LocationBusCountRing } from "@/components/LocationBusCountRing";
import { MgmtBackLink } from "@/components/MgmtBackLink";
import { TerminalGeofenceMap } from "@/components/TerminalGeofenceMap";
import { api } from "@/lib/api";
import { haversineMeters } from "@/lib/haversineMeters";
import { useToast } from "@/context/ToastContext";
import { swalConfirm } from "@/lib/swal";
import type { BusLiveLogRow, TicketRow } from "@/lib/types";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";
import "./LocationTacticalDossier.css";

type CoverageDoc = {
  _id: string;
  locationName: string;
  pointType: string;
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

const OID_RE = /^[a-f0-9]{24}$/i;

function silenceTicketing(msg: string) {
  const m = msg.toLowerCase();
  return (
    m.includes("mysql not configured") ||
    m.includes("ticketing data unavailable") ||
    m.includes("non-json response") ||
    m.includes("received html") ||
    m.includes("unexpected token") ||
    m.includes("invalid json")
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineMeters(lat1, lon1, lat2, lon2) / 1000;
}

type StopBoarding = { label: string; type: "Terminal" | "Bus stop"; boardings: number };

function normalizePlaceName(v: string): string {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildStopBoardings(
  tickets: TicketRow[],
  locationName: string,
  terminalName: string,
  stops: Array<{ name: string }>
): StopBoarding[] {
  const points: Array<{ label: string; type: "Terminal" | "Bus stop" }> = [
    { label: terminalName.trim() || locationName.trim() || "Terminal", type: "Terminal" },
    ...stops
      .map((s) => String(s?.name || "").trim())
      .filter(Boolean)
      .map((name) => ({ label: name, type: "Bus stop" as const })),
  ];
  const counts = new Map<string, number>();
  for (const p of points) counts.set(p.label, 0);

  for (const t of tickets) {
    const startNorm = normalizePlaceName(String(t.startLocation || ""));
    if (!startNorm) continue;
    for (const p of points) {
      const pn = normalizePlaceName(p.label);
      if (!pn) continue;
      if (startNorm === pn || startNorm.includes(pn) || pn.includes(startNorm)) {
        counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
        break;
      }
    }
  }

  return points.map((p) => ({
    label: p.label,
    type: p.type,
    boardings: counts.get(p.label) ?? 0,
  }));
}

export function LocationDetailPage() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const raw = useParams().locationId;
  const locationId = raw ? decodeURIComponent(raw) : "";

  const [doc, setDoc] = useState<CoverageDoc | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [liveRows, setLiveRows] = useState<BusLiveLogRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);

  const [geoOpen, setGeoOpen] = useState(false);
  const [geoRadius, setGeoRadius] = useState("500");
  const [pickupDraft, setPickupDraft] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadCoverage = useCallback(async () => {
    const res = await api<{ items: CoverageDoc[] }>("/api/locations/coverage");
    const found = res.items.find((c) => c._id === locationId) ?? null;
    setDoc(found);
    if (found) {
      setGeoRadius(String(found.terminal.geofenceRadiusM ?? 500));
      setPickupDraft(found.terminal.pickupOnly !== false);
    }
    return found;
  }, [locationId]);

  useEffect(() => {
    if (!locationId || !OID_RE.test(locationId)) {
      setDoc(null);
      setErr("Invalid location id.");
      return;
    }
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const found = await loadCoverage();
        if (!cancelled && !found) setErr("Coverage hub not found.");
      } catch (e) {
        if (!cancelled) {
          setDoc(null);
          setErr(e instanceof Error ? e.message : "Failed to load coverage.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, loadCoverage]);

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
    const t = window.setInterval(() => void pull(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api<{ items: TicketRow[] }>("/api/tickets");
        if (!cancelled) setTickets(list.items);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "";
          if (!silenceTicketing(msg)) {
            /* optional: toast */
          }
          setTickets([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const t = doc?.terminal;
  const radiusM = t ? (t.geofenceRadiusM ?? 500) : 500;

  const busesInside = useMemo(() => {
    if (!t) return 0;
    return liveRows.filter(
      (b) =>
        Number.isFinite(b.latitude) &&
        Number.isFinite(b.longitude) &&
        haversineMeters(t.latitude, t.longitude, b.latitude, b.longitude) <= radiusM
    ).length;
  }, [t, liveRows, radiusM]);

  const liveReporting = busesInside > 0;

  const liveBuses = useMemo(
    () =>
      liveRows
        .filter((b) => Number.isFinite(b.latitude) && Number.isFinite(b.longitude))
        .map((b) => ({ busId: b.busId, latitude: b.latitude, longitude: b.longitude })),
    [liveRows]
  );

  const stopBoardings = useMemo(() => {
    if (!doc) return [];
    return buildStopBoardings(tickets, doc.locationName, doc.terminal.name, doc.stops || []);
  }, [doc, tickets]);

  /** Same corridor / leg layout as management “recent deployed” (terminal + ordered stops). */
  const { corridorPoints, corridorLegs } = useMemo(() => {
    if (!doc?.terminal) return { corridorPoints: [] as { seq: number; label: string; type: string }[], corridorLegs: [] as string[] };
    const term = doc.terminal;
    if (!Number.isFinite(term.latitude) || !Number.isFinite(term.longitude)) {
      return { corridorPoints: [], corridorLegs: [] };
    }
    const stops = [...(doc.stops || [])]
      .filter(
        (s) => s && String(s.name || "").trim() && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
      )
      .sort((a, b) => a.sequence - b.sequence);
    const points: { seq: number; label: string; type: string }[] = [
      { seq: 1, label: String(term.name || doc.locationName), type: "Terminal" },
      ...stops.map((s, i) => ({ seq: i + 2, label: s.name, type: "Bus Stop" })),
    ];
    const coords = [
      { lat: Number(term.latitude), lng: Number(term.longitude) },
      ...stops.map((s) => ({ lat: s.latitude, lng: s.longitude })),
    ];
    const legs: string[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const km = haversineKm(coords[i]!.lat, coords[i]!.lng, coords[i + 1]!.lat, coords[i + 1]!.lng);
      legs.push(`${points[i]!.label} ➔ ${points[i + 1]!.label}: ${km.toFixed(1)} km`);
    }
    return { corridorPoints: points, corridorLegs: legs };
  }, [doc]);

  async function saveGeofence() {
    if (!locationId || !OID_RE.test(locationId)) return;
    const r = Number(geoRadius);
    if (!Number.isFinite(r) || r < 50 || r > 50000) {
      showError("Radius must be between 50 and 50000 meters.");
      return;
    }
    setBusy(true);
    try {
      const updated = await api<CoverageDoc>(`/api/locations/coverage/${encodeURIComponent(locationId)}`, {
        method: "PATCH",
        json: { geofenceRadiusM: r, pickupOnly: pickupDraft },
      });
      setDoc(updated);
      showSuccess("Geofence updated.");
      setGeoOpen(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateLocation() {
    if (!locationId || !OID_RE.test(locationId)) return;
    if (
      !(await swalConfirm({
        title: "Remove hub?",
        text: "Remove this coverage hub from the active network? Linked routes may need updates.",
        icon: "warning",
        confirmButtonText: "Remove",
      }))
    )
      return;
    setBusy(true);
    try {
      await api(`/api/locations/coverage/${encodeURIComponent(locationId)}`, { method: "DELETE" });
      showSuccess("Location removed.");
      navigate("/dashboard/management/locations");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (doc === undefined) {
    return (
      <ManagementDetailShell backModule="locations" title="Terminal dossier" subtitle="Loading…">
        <p className="mgmt-mod__unknown">Loading…</p>
      </ManagementDetailShell>
    );
  }

  if (err || !doc || !t) {
    return (
      <ManagementDetailShell backModule="locations" title="Terminal dossier" subtitle="Route coverage">
        <p className="mgmt-mod__unknown">{err ?? "Not found."}</p>
      </ManagementDetailShell>
    );
  }

  const pickupOnly = t.pickupOnly !== false;

  return (
    <div className="admin-mgmt">
      <div className="mgmt-mod mgmt-mod--wide">
        <div className="loc-dossier">
          <div className="loc-dossier__topbar">
            <MgmtBackLink to="/dashboard/management/locations" label="Location management" className="loc-dossier__mgmt-back" />
          </div>

          <header className="loc-dossier__header">
            <h1 className="loc-dossier__title">{t.name}</h1>
            <div className="loc-dossier__status" aria-live="polite">
              <span
                className={
                  "loc-dossier__status-dot " + (liveReporting ? "loc-dossier__status-dot--live" : "loc-dossier__status-dot--idle")
                }
              />
              {liveReporting ? "Live bus data" : "No live pings in zone"}
            </div>
          </header>
          <p className="loc-dossier__sub">
            <span className="loc-dossier__mono" style={{ display: "inline", fontSize: "0.78rem" }}>
              {doc.locationName}
            </span>{" "}
            · {doc.pointType} · {doc.stops.length} stop{doc.stops.length === 1 ? "" : "s"}
          </p>

          <div className="loc-dossier__telemetry">
            <div className="loc-dossier__tile">
              <span className="loc-dossier__tile-label">Coordinates</span>
              <p className="loc-dossier__mono">
                {t.latitude.toFixed(5)}, {t.longitude.toFixed(5)}
              </p>
            </div>
            <div className="loc-dossier__tile">
              <span className="loc-dossier__tile-label">Geofence (m)</span>
              <p className="loc-dossier__mono">{String(radiusM)}</p>
            </div>
            <div className="loc-dossier__tile">
              <span className="loc-dossier__tile-label">Coverage ID</span>
              <p className="loc-dossier__mono">{doc._id}</p>
            </div>
          </div>

          <div className="loc-dossier__pickup">
            <div className="loc-dossier__pickup-k">Pickup capability</div>
            <p className="loc-dossier__pickup-v">{pickupOnly ? "Pickup only · enforced for strict buses" : "Pickup + drop-off allowed"}</p>
          </div>

          {corridorPoints.length > 0 ? (
            <section className="loc-dossier__module loc-dossier__corridor" aria-labelledby="loc-corridor-heading">
              <h2 id="loc-corridor-heading" className="loc-dossier__module-title">
                Corridor sequence &amp; leg distances
              </h2>
              <ol className="loc-dossier__corridor-seq">
                {corridorPoints.map((pt) => (
                  <li key={`${pt.seq}-${pt.label}`}>
                    <code className="loc-dossier__corridor-seq-id">{String(pt.seq).padStart(2, "0")}</code>
                    <span className="loc-dossier__corridor-seq-name">{pt.label}</span>
                    <span className="loc-dossier__corridor-seq-type">{pt.type}</span>
                  </li>
                ))}
              </ol>
              {corridorLegs.length > 0 ? (
                <ul className="loc-dossier__corridor-legs" aria-label="Leg distances">
                  {corridorLegs.map((leg) => (
                    <li key={leg}>{leg}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <div className="loc-dossier__row-split">
            <section className="loc-dossier__module">
              <h2 className="loc-dossier__module-title">Geofence visualization</h2>
              <TerminalGeofenceMap
                centerLat={t.latitude}
                centerLng={t.longitude}
                geofenceRadiusM={radiusM}
                liveBuses={liveBuses}
                terminalName={t.name}
                stops={doc.stops}
              />
            </section>
            <section className="loc-dossier__module">
              <h2 className="loc-dossier__module-title">Active fleet count</h2>
              <div className="loc-dossier__ring-wrap">
                <LocationBusCountRing count={busesInside} maxForScale={24} />
              </div>
              <p className="loc-dossier__muted">
                Live GPS positions inside the terminal geofence (refreshes every ~12s). Ring scale max 24 units.
              </p>
            </section>
          </div>

          <section className="loc-dossier__module" style={{ marginBottom: "1.25rem" }}>
            <h2 className="loc-dossier__module-title">Stop analytics</h2>
            <p className="loc-dossier__muted" style={{ textAlign: "left", marginBottom: "0.65rem" }}>
              Passenger boardings by terminal and bus stop based on ticket origin records.
            </p>
            <div className="loc-dossier__chart" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.5rem" }}>
              {stopBoardings.map((row) => (
                <div
                  key={`${row.type}-${row.label}`}
                  className="loc-dossier__chart-col"
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: "0.75rem", minHeight: "unset" }}
                >
                  <span className="loc-dossier__chart-label" style={{ textAlign: "left", whiteSpace: "normal" }}>
                    {row.label}
                    <span style={{ marginLeft: "0.45rem", opacity: 0.75 }}>({row.type})</span>
                  </span>
                  <span className="loc-dossier__chart-val">{row.boardings}</span>
                </div>
              ))}
            </div>
          </section>

          <footer className="loc-dossier__dock">
            <button
              type="button"
              className="loc-dossier__dock-btn loc-dossier__dock-btn--blue"
              disabled={busy}
              onClick={() => {
                setGeoRadius(String(radiusM));
                setPickupDraft(pickupOnly);
                setGeoOpen(true);
              }}
            >
              Adjust geofence
            </button>
            <button
              type="button"
              className="loc-dossier__dock-btn loc-dossier__dock-btn--red"
              disabled={busy}
              onClick={() => void deactivateLocation()}
            >
              Deactivate stop
            </button>
          </footer>

          {geoOpen ? (
            <div className="loc-dossier-overlay" role="dialog" aria-modal="true" aria-labelledby="loc-geo-title">
              <div className="loc-dossier-overlay__panel">
                <h2 id="loc-geo-title">Adjust geofence</h2>
                <p className="loc-dossier-overlay__sub">Detection radius in meters (50–50,000). Syncs to Firebase coverage mirror when configured.</p>
                <div className="loc-dossier-overlay__field">
                  <label className="loc-dossier-overlay__label" htmlFor="loc-geo-r">
                    Radius (m)
                  </label>
                  <input
                    id="loc-geo-r"
                    className="loc-dossier-overlay__input"
                    type="number"
                    min={50}
                    max={50000}
                    value={geoRadius}
                    onChange={(e) => setGeoRadius(e.target.value)}
                  />
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.82rem",
                    color: "rgba(226,232,240,0.92)",
                    cursor: "pointer",
                    marginBottom: "0.5rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pickupDraft}
                    onChange={(e) => setPickupDraft(e.target.checked)}
                  />
                  Pickup-only terminal
                </label>
                <div className="loc-dossier-overlay__foot">
                  <button type="button" disabled={busy} onClick={() => setGeoOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="loc-dossier-overlay__primary" disabled={busy} onClick={() => void saveGeofence()}>
                    {busy ? "Saving…" : "Apply radius"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
