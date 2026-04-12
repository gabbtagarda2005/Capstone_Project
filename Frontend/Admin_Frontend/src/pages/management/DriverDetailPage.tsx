import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MgmtBackLink } from "@/components/MgmtBackLink";
import { AttendantDossierMap } from "@/components/AttendantDossierMap";
import { AttendantPerformanceRing } from "@/components/AttendantPerformanceRing";
import { api, fetchCorridorRoutes } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { swalConfirm } from "@/lib/swal";
import type { BusLiveLogRow, BusRow, CorridorRouteRow, DriverSummary } from "@/lib/types";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";
import "./DriverTacticalDossier.css";

const OID_RE = /^[a-f0-9]{24}$/i;

function buildCorridorLine(bus: BusRow | null | undefined, routes: CorridorRouteRow[]): [number, number][] {
  if (!bus?.route) return [];
  const r = routes.find(
    (x) =>
      x.displayName === bus.route ||
      `${x.originLabel} → ${x.destLabel}` === bus.route ||
      x.originLabel === bus.route
  );
  if (!r?.authorizedStops?.length) return [];
  return [...r.authorizedStops]
    .sort((a, b) => a.sequence - b.sequence)
    .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
    .map((s) => [s.latitude, s.longitude] as [number, number]);
}

function isFixRecent(iso: string | undefined, ms: number) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < ms;
}

type DriverFeedbackStats = {
  sampleSize: number;
  avgRating: number | null;
  safetyPercent: number | null;
  complaintCount: number;
  lastFeedbackAt: string | null;
};

function daysUntilLicenseExpiry(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000));
}

export function DriverDetailPage() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const { driverId } = useParams();
  const [driver, setDriver] = useState<DriverSummary | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [routes, setRoutes] = useState<CorridorRouteRow[]>([]);
  const [liveRows, setLiveRows] = useState<BusLiveLogRow[]>([]);

  const [licenseOpen, setLicenseOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [licenseForm, setLicenseForm] = useState({ number: "", scanUrl: "", expires: "" });
  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phone: "",
    yearsExperience: "",
  });
  const [routePick, setRoutePick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackStats, setFeedbackStats] = useState<DriverFeedbackStats | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const loadDriver = useCallback(async () => {
    if (!driverId || !OID_RE.test(driverId)) return;
    const d = await api<DriverSummary>(`/api/drivers/${encodeURIComponent(driverId)}`);
    setDriver(d);
    setLicenseForm({
      number: d.licenseNumber ?? "",
      scanUrl: d.licenseScanUrl ?? "",
      expires: d.licenseExpiresAt ? d.licenseExpiresAt.slice(0, 10) : "",
    });
  }, [driverId]);

  useEffect(() => {
    if (!driverId || !OID_RE.test(driverId)) {
      setDriver(null);
      setErr("Invalid driver id.");
      return;
    }
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        await loadDriver();
        if (cancelled) return;
      } catch (e) {
        if (!cancelled) {
          setDriver(null);
          setErr(e instanceof Error ? e.message : "Could not load driver.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId, loadDriver]);

  const loadFleet = useCallback(async () => {
    try {
      const [bRes, rRes] = await Promise.all([
        api<{ items: BusRow[] }>("/api/buses"),
        fetchCorridorRoutes().catch(() => ({ items: [] as CorridorRouteRow[] })),
      ]);
      setBuses(bRes.items);
      setRoutes(rRes.items);
    } catch {
      setBuses([]);
      setRoutes([]);
    }
  }, []);

  useEffect(() => {
    void loadFleet();
  }, [loadFleet]);

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
    const t = window.setInterval(() => void pull(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!driverId || !OID_RE.test(driverId)) return;
    let cancelled = false;
    setFeedbackLoading(true);
    setFeedbackStats(null);
    (async () => {
      try {
        const s = await api<DriverFeedbackStats>(`/api/passenger-feedback/driver/${encodeURIComponent(driverId)}`);
        if (!cancelled) setFeedbackStats(s);
      } catch {
        if (!cancelled) {
          setFeedbackStats({
            sampleSize: 0,
            avgRating: null,
            safetyPercent: null,
            complaintCount: 0,
            lastFeedbackAt: null,
          });
        }
      } finally {
        if (!cancelled) setFeedbackLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  const assignedBus = useMemo(
    () => buses.find((b) => b.driverId != null && String(b.driverId) === String(driver?.id)) ?? null,
    [buses, driver?.id]
  );

  const corridorLine = useMemo(() => buildCorridorLine(assignedBus, routes), [assignedBus, routes]);

  const mapHint = useMemo((): [number, number] | null => {
    if (corridorLine.length) return corridorLine[0] ?? null;
    return null;
  }, [corridorLine]);

  const liveRow = useMemo(
    () => (assignedBus ? liveRows.find((l) => l.busId === assignedBus.busId) : undefined),
    [assignedBus, liveRows]
  );

  const onLiveRoute = useMemo(() => {
    if (!driver || driver.active === false || !assignedBus) return false;
    const gpsOk = isFixRecent(liveRow?.recordedAt, 30 * 60 * 1000);
    const seenOk = isFixRecent(assignedBus.lastSeenAt ?? undefined, 30 * 60 * 1000);
    return gpsOk || seenOk;
  }, [driver, assignedBus, liveRow]);

  const expiryDays = useMemo(() => daysUntilLicenseExpiry(driver?.licenseExpiresAt), [driver?.licenseExpiresAt]);
  const licenseCritical = expiryDays != null && expiryDays <= 30;

  async function saveProfile() {
    if (!driverId || !OID_RE.test(driverId)) return;
    const fn = profileForm.firstName.trim();
    const ln = profileForm.lastName.trim();
    if (!fn || !ln) {
      showError("First and last name are required.");
      return;
    }
    let yearsExp: number | null = null;
    if (profileForm.yearsExperience.trim() !== "") {
      const y = Number(profileForm.yearsExperience);
      if (!Number.isFinite(y) || y < 0) {
        showError("Years of experience must be a non-negative number.");
        return;
      }
      yearsExp = y;
    }
    setBusy(true);
    try {
      const json: Record<string, unknown> = {
        firstName: fn,
        lastName: ln,
        middleName: profileForm.middleName.trim() || null,
        email: profileForm.email.trim() || null,
        phone: profileForm.phone.trim() || null,
        yearsExperience: profileForm.yearsExperience.trim() === "" ? null : yearsExp,
      };
      const d = await api<DriverSummary>(`/api/drivers/${encodeURIComponent(driverId)}`, {
        method: "PATCH",
        json,
      });
      setDriver(d);
      showSuccess("Profile updated.");
      setProfileOpen(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveLicense() {
    if (!driverId || !OID_RE.test(driverId)) return;
    setBusy(true);
    try {
      const json: Record<string, unknown> = {
        licenseNumber: licenseForm.number.trim() || null,
        licenseScanUrl: licenseForm.scanUrl.trim() || null,
      };
      if (licenseForm.expires.trim()) {
        json.licenseExpiresAt = new Date(licenseForm.expires + "T12:00:00").toISOString();
      } else {
        json.licenseExpiresAt = null;
      }
      const d = await api<DriverSummary>(`/api/drivers/${encodeURIComponent(driverId)}`, { method: "PATCH", json });
      setDriver(d);
      showSuccess("License record updated.");
      setLicenseOpen(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyRoute() {
    if (!assignedBus || !routePick) {
      showError("Select a corridor and ensure this driver is assigned to a bus.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/buses/${encodeURIComponent(assignedBus.id)}`, {
        method: "PATCH",
        json: { route: routePick },
      });
      showSuccess("Corridor assignment updated.");
      setRouteOpen(false);
      await loadFleet();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not assign route");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!driverId || !OID_RE.test(driverId)) return;
    if (
      !(await swalConfirm({
        title: "Deactivate driver?",
        text: "Deactivate this driver? They will be hidden from active fleet lists.",
        icon: "warning",
        confirmButtonText: "Deactivate",
      }))
    )
      return;
    setBusy(true);
    try {
      await api(`/api/drivers/${encodeURIComponent(driverId)}`, { method: "DELETE" });
      showSuccess("Driver deactivated.");
      navigate("/dashboard/management/drivers");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Deactivate failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (routeOpen && routes.length && assignedBus?.route) {
      setRoutePick(assignedBus.route);
    }
  }, [routeOpen, routes, assignedBus?.route]);

  useEffect(() => {
    if (!profileOpen || !driver) return;
    setProfileForm({
      firstName: driver.firstName ?? "",
      lastName: driver.lastName ?? "",
      middleName: driver.middleName ?? "",
      email: driver.email ?? "",
      phone: driver.phone ?? "",
      yearsExperience: driver.yearsExperience != null ? String(driver.yearsExperience) : "",
    });
  }, [profileOpen, driver]);

  if (driver === undefined) {
    return (
      <ManagementDetailShell backModule="drivers" title="Driver dossier" subtitle="Loading…">
        <p className="mgmt-mod__unknown">Loading…</p>
      </ManagementDetailShell>
    );
  }

  if (err || !driver) {
    return (
      <ManagementDetailShell backModule="drivers" title="Driver dossier" subtitle="Fleet roster">
        <p className="mgmt-mod__unknown">{err ?? "Driver not found."}</p>
      </ManagementDetailShell>
    );
  }

  const name = [driver.firstName, driver.middleName, driver.lastName].filter(Boolean).join(" ");
  const safetyPct = feedbackStats?.safetyPercent ?? 100;
  const hasFeedbackSamples = (feedbackStats?.sampleSize ?? 0) > 0;
  const rosterSixDigit = /^\d{6}$/.test(driver.driverId);

  return (
    <div className="admin-mgmt">
      <div className="mgmt-mod mgmt-mod--wide">
        <div className="drv-dossier">
          <div className="drv-dossier__topbar">
            <MgmtBackLink to="/dashboard/management/drivers" label="Driver roster" className="drv-dossier__mgmt-back" />
          </div>

          <header className="drv-dossier__header">
            <h1 className="drv-dossier__name">{name}</h1>
            {driver.otpVerified ? <span className="drv-dossier__badge">Verified</span> : null}
            <div className="drv-dossier__live" aria-live="polite">
              <span
                className={
                  "drv-dossier__live-dot " + (onLiveRoute ? "drv-dossier__live-dot--on" : "drv-dossier__live-dot--off")
                }
              />
              {onLiveRoute ? "Live route" : "Not on live segment"}
            </div>
          </header>

          <div className="drv-dossier__telemetry">
            {rosterSixDigit ? (
              <div className="drv-dossier__tile">
                <span className="drv-dossier__tile-label">Personnel ID (6-digit)</span>
                <p className="drv-dossier__tile-value drv-dossier__mono">{driver.driverId}</p>
                <p className="drv-dossier__muted-note" style={{ marginTop: "0.35rem", textAlign: "left" }}>
                  This ID is what the bus attendant enters to edit a ticket.
                </p>
              </div>
            ) : (
              <>
                <div className="drv-dossier__tile">
                  <span className="drv-dossier__tile-label">Personnel ID (6-digit)</span>
                  <p className="drv-dossier__tile-value drv-dossier__mono">—</p>
                  <p className="drv-dossier__muted-note" style={{ marginTop: "0.35rem", textAlign: "left" }}>
                    Ticket corrections on the attendant app use the driver correction PIN from driver onboarding (not edited on this screen).
                  </p>
                </div>
                <div className="drv-dossier__tile">
                  <span className="drv-dossier__tile-label">System driver key</span>
                  <p
                    className="drv-dossier__tile-value drv-dossier__mono"
                    style={{ fontSize: "0.85rem", wordBreak: "break-all" }}
                  >
                    {driver.driverId}
                  </p>
                </div>
              </>
            )}
            <div className="drv-dossier__tile">
              <span className="drv-dossier__tile-label">License number</span>
              <p className="drv-dossier__tile-value drv-dossier__mono">{driver.licenseNumber || "—"}</p>
            </div>
            <div className="drv-dossier__tile">
              <span className="drv-dossier__tile-label">Experience</span>
              <p className="drv-dossier__tile-value">
                {driver.yearsExperience != null ? `${driver.yearsExperience} years` : "—"}
              </p>
            </div>
          </div>

          <div className="drv-dossier__meta-row">
            <div className="drv-dossier__chip">
              <span className="drv-dossier__chip-k">Email</span>
              <span className="drv-dossier__chip-v">{driver.email || "—"}</span>
            </div>
            <div className="drv-dossier__chip">
              <span className="drv-dossier__chip-k">Phone</span>
              <span className="drv-dossier__chip-v drv-dossier__mono">{driver.phone || "—"}</span>
            </div>
          </div>

          <div className="drv-dossier__grid2">
            <section className="drv-dossier__module">
              <h2 className="drv-dossier__module-title">Current fleet unit</h2>
              <div className="drv-dossier__unit">
                <div className="drv-dossier__unit-icon" aria-hidden>
                  🚌
                </div>
                <div>
                  <p className="drv-dossier__tile-value" style={{ margin: 0 }}>
                    {assignedBus ? `Bus ${assignedBus.busNumber}` : "No bus assignment"}
                  </p>
                  <p className="drv-dossier__muted-note" style={{ textAlign: "left", marginTop: "0.35rem" }}>
                    {assignedBus?.route ?? "Assign in Bus management or link a unit to this driver."}
                  </p>
                  {assignedBus?.plateNumber ? (
                    <span className="drv-dossier__plate">{assignedBus.plateNumber}</span>
                  ) : null}
                </div>
              </div>
            </section>

            <section className={"drv-dossier__expiry" + (licenseCritical ? " drv-dossier__expiry--critical" : "")}>
              <div className="drv-dossier__expiry-k">
                {licenseCritical ? "License expiry · action required" : "License expiry"}
              </div>
              {driver.licenseExpiresAt ? (
                <>
                  <p className="drv-dossier__expiry-v">{new Date(driver.licenseExpiresAt).toLocaleDateString()}</p>
                  {expiryDays != null ? (
                    <p className="drv-dossier__muted-note" style={{ textAlign: "left" }}>
                      {expiryDays < 0
                        ? "Expired — renew immediately."
                        : `${expiryDays} day${expiryDays === 1 ? "" : "s"} remaining`}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="drv-dossier__expiry-v" style={{ fontFamily: "inherit", fontWeight: 600 }}>
                  No expiry on file
                </p>
              )}
              <p className="drv-dossier__muted-note" style={{ textAlign: "left" }}>
                Use <strong>Update license</strong> to add certification dates and scan links.
              </p>
            </section>
          </div>

          <div className="drv-dossier__row-split">
            <section className="drv-dossier__module">
              <h2 className="drv-dossier__module-title">Passenger feedback · Safety score</h2>
              <div style={{ display: "flex", justifyContent: "center", padding: "0.5rem 0" }}>
                {feedbackLoading ? (
                  <div className="drv-dossier__feedback-ring drv-dossier__feedback-ring--loading" aria-busy>
                    <span className="drv-dossier__feedback-ring-dash">…</span>
                    <span className="drv-dossier__feedback-ring-cap">Loading feedback…</span>
                  </div>
                ) : hasFeedbackSamples ? (
                  <AttendantPerformanceRing percent={safetyPct} caption="Safety score" />
                ) : (
                  <div className="drv-dossier__feedback-ring drv-dossier__feedback-ring--empty">
                    <span className="drv-dossier__feedback-ring-dash">—</span>
                    <span className="drv-dossier__feedback-ring-cap">No reports yet</span>
                  </div>
                )}
              </div>
              {!feedbackLoading && hasFeedbackSamples && feedbackStats ? (
                <p className="drv-dossier__muted-note" style={{ marginTop: "0.35rem" }}>
                  Based on <strong>{feedbackStats.sampleSize}</strong> report{feedbackStats.sampleSize === 1 ? "" : "s"}
                  {feedbackStats.avgRating != null ? (
                    <>
                      {" "}
                      · avg <strong>{feedbackStats.avgRating.toFixed(1)}</strong> / 5
                    </>
                  ) : null}
                  {feedbackStats.complaintCount > 0 ? (
                    <>
                      {" "}
                      · <strong>{feedbackStats.complaintCount}</strong> flagged concern
                      {feedbackStats.complaintCount === 1 ? "" : "s"}
                    </>
                  ) : null}
                  .
                </p>
              ) : null}
            </section>

            <section className="drv-dossier__module">
              <h2 className="drv-dossier__module-title">Route map · Bukidnon</h2>
              <AttendantDossierMap
                busId={assignedBus?.busId ?? null}
                hintLatLng={mapHint}
                corridorLine={corridorLine}
                chromeTag="ROUTE TRACE"
                chromeHint={
                  assignedBus
                    ? `${assignedBus.busNumber} · ${assignedBus.route ?? "Corridor TBD"}`
                    : "No assigned unit"
                }
              />
            </section>
          </div>

          <footer className="drv-dossier__dock">
            <button
              type="button"
              className="drv-dossier__dock-btn drv-dossier__dock-btn--blue"
              disabled={busy}
              onClick={() => setProfileOpen(true)}
            >
              Edit profile
            </button>
            <button
              type="button"
              className="drv-dossier__dock-btn drv-dossier__dock-btn--blue"
              disabled={busy}
              onClick={() => setLicenseOpen(true)}
            >
              Update license
            </button>
            <button
              type="button"
              className="drv-dossier__dock-btn drv-dossier__dock-btn--blue"
              disabled={busy}
              onClick={() => {
                setRoutePick(assignedBus?.route ?? routes[0]?.displayName ?? null);
                setRouteOpen(true);
              }}
            >
              Assign route
            </button>
            <span className="drv-dossier__dock-spacer" />
            <button
              type="button"
              className="drv-dossier__dock-btn drv-dossier__dock-btn--red"
              disabled={busy || driver.active === false}
              onClick={() => void deactivate()}
            >
              Deactivate driver
            </button>
          </footer>

          {profileOpen ? (
            <div className="drv-dossier-overlay" role="dialog" aria-modal="true" aria-labelledby="drv-profile-title">
              <div className="drv-dossier-overlay__panel" style={{ maxWidth: 480 }}>
                <div className="drv-dossier-overlay__head">
                  <h2 id="drv-profile-title">Edit profile</h2>
                  <p className="drv-dossier-overlay__sub">Name, contact, and years of experience shown on the fleet roster.</p>
                </div>
                <div className="drv-dossier-overlay__body">
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">First name</span>
                    <input
                      className="drv-dossier-overlay__input"
                      value={profileForm.firstName}
                      onChange={(e) => setProfileForm((f) => ({ ...f, firstName: e.target.value }))}
                      autoComplete="given-name"
                    />
                  </label>
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">Middle name</span>
                    <input
                      className="drv-dossier-overlay__input"
                      value={profileForm.middleName}
                      onChange={(e) => setProfileForm((f) => ({ ...f, middleName: e.target.value }))}
                      autoComplete="additional-name"
                    />
                  </label>
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">Last name</span>
                    <input
                      className="drv-dossier-overlay__input"
                      value={profileForm.lastName}
                      onChange={(e) => setProfileForm((f) => ({ ...f, lastName: e.target.value }))}
                      autoComplete="family-name"
                    />
                  </label>
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">Email</span>
                    <input
                      className="drv-dossier-overlay__input"
                      type="email"
                      value={profileForm.email}
                      onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
                      autoComplete="email"
                    />
                  </label>
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">Phone</span>
                    <input
                      className="drv-dossier-overlay__input"
                      value={profileForm.phone}
                      onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))}
                      autoComplete="tel"
                    />
                  </label>
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">Years of experience</span>
                    <input
                      className="drv-dossier-overlay__input"
                      type="number"
                      min={0}
                      step={1}
                      value={profileForm.yearsExperience}
                      onChange={(e) => setProfileForm((f) => ({ ...f, yearsExperience: e.target.value }))}
                      placeholder="e.g. 10"
                    />
                  </label>
                </div>
                <div className="drv-dossier-overlay__foot">
                  <button type="button" disabled={busy} onClick={() => setProfileOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="drv-dossier-overlay__primary" disabled={busy} onClick={() => void saveProfile()}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {licenseOpen ? (
            <div className="drv-dossier-overlay" role="dialog" aria-modal="true" aria-labelledby="drv-lic-title">
              <div className="drv-dossier-overlay__panel">
                <div className="drv-dossier-overlay__head">
                  <h2 id="drv-lic-title">Update license</h2>
                  <p className="drv-dossier-overlay__sub">Certification numbers, scan URL, and expiry for compliance.</p>
                </div>
                <div className="drv-dossier-overlay__body">
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">License number</span>
                    <input
                      className="drv-dossier-overlay__input"
                      value={licenseForm.number}
                      onChange={(e) => setLicenseForm((f) => ({ ...f, number: e.target.value }))}
                      placeholder="e.g. N04-12-345678"
                    />
                  </label>
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">Scan / document URL</span>
                    <input
                      className="drv-dossier-overlay__input"
                      value={licenseForm.scanUrl}
                      onChange={(e) => setLicenseForm((f) => ({ ...f, scanUrl: e.target.value }))}
                      placeholder="https://…"
                    />
                  </label>
                  <label className="drv-dossier-overlay__field">
                    <span className="drv-dossier-overlay__label">Expiry date</span>
                    <input
                      className="drv-dossier-overlay__input"
                      type="date"
                      value={licenseForm.expires}
                      onChange={(e) => setLicenseForm((f) => ({ ...f, expires: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="drv-dossier-overlay__foot">
                  <button type="button" disabled={busy} onClick={() => setLicenseOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="drv-dossier-overlay__primary" disabled={busy} onClick={() => void saveLicense()}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {routeOpen ? (
            <div className="drv-dossier-overlay" role="dialog" aria-modal="true" aria-labelledby="drv-route-title">
              <div className="drv-dossier-overlay__panel" style={{ maxWidth: 520 }}>
                <div className="drv-dossier-overlay__head">
                  <h2 id="drv-route-title">Assign corridor</h2>
                  <p className="drv-dossier-overlay__sub">
                    {assignedBus
                      ? `Applies to bus ${assignedBus.busNumber}.`
                      : "This driver has no bus with driverId set — register assignment in Bus management first."}
                  </p>
                </div>
                <div className="drv-dossier-overlay__list">
                  {routes.length === 0 ? (
                    <p className="drv-dossier__muted-note" style={{ padding: "0.5rem 0.75rem" }}>
                      No corridors loaded. Create routes under Route management.
                    </p>
                  ) : (
                    routes.map((r) => {
                      const label = r.displayName || `${r.originLabel} → ${r.destLabel}`;
                      return (
                        <button
                          key={r._id}
                          type="button"
                          className={
                            "drv-dossier-overlay__row " + (routePick === label ? "drv-dossier-overlay__row--selected" : "")
                          }
                          onClick={() => setRoutePick(label)}
                        >
                          <div className="drv-dossier-overlay__row-title">{label}</div>
                          <div className="drv-dossier-overlay__row-sub">
                            {r.originLabel} → {r.destLabel}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="drv-dossier-overlay__foot">
                  <button type="button" disabled={busy} onClick={() => setRouteOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="drv-dossier-overlay__primary"
                    disabled={busy || !assignedBus || !routePick}
                    onClick={() => void applyRoute()}
                  >
                    {busy ? "Applying…" : "Apply corridor"}
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
