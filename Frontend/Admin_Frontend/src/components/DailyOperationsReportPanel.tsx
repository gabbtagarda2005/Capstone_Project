import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  ADMIN_API_ORIGIN,
  api,
  fetchAdminPortalSettings,
  fetchAdminRbac,
  fetchDailyOperationsReport,
  putAdminPortalSettings,
} from "@/lib/api";
import type { DailyOperationsReportDto, SpeedViolationLogRow } from "@/lib/types";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import { useToast } from "@/context/ToastContext";
import "@/pages/ReportsPage.css";
import "./DailyOperationsReportPanel.css";

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHeaderDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  try {
    return dt.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return ymd;
  }
}

function hubTierClass(tier: string): string {
  if (tier === "green") return "daily-ops__hub-stat--green";
  if (tier === "amber") return "daily-ops__hub-stat--amber";
  if (tier === "red") return "daily-ops__hub-stat--red";
  return "daily-ops__hub-stat--neutral";
}

function normalizeTimeForInput(t: string | undefined): string {
  const m = String(t || "06:30")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "06:30";
  const h = Math.min(23, Math.max(0, parseInt(m[1] ?? "0", 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2] ?? "0", 10)));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

type DailyOpsReportTab = "hubs" | "arrival" | "incidents" | "speed";

const DAILY_OPS_TABS: { id: DailyOpsReportTab; label: string }[] = [
  { id: "hubs", label: "Terminal hub health" },
  { id: "arrival", label: "Arrival precision" },
  { id: "incidents", label: "Incident board" },
  { id: "speed", label: "Fleet speed violations" },
];

function incidentGlyph(incident: string): string {
  const u = incident.toUpperCase();
  if (u.includes("SPEED")) return "🚨";
  if (u.includes("ON-TIME") || u === "ON-TIME") return "✅";
  if (u.includes("LATE")) return "⏱";
  if (u.includes("EARLY")) return "⏩";
  return "▪";
}

export function DailyOperationsReportPanel() {
  const { branding } = useAdminBranding();
  const { showError, showSuccess } = useToast();
  const [date, setDate] = useState(localDateYmd);
  const [data, setData] = useState<DailyOperationsReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("06:30");
  /** Lowercase email → receives daily ops email */
  const [recipientPick, setRecipientPick] = useState<Record<string, boolean>>({});
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [reportTab, setReportTab] = useState<DailyOpsReportTab>("hubs");
  const [speedViolations, setSpeedViolations] = useState<SpeedViolationLogRow[]>([]);

  const loadSpeedViolations = useCallback(async () => {
    try {
      const r = await api<{ items: SpeedViolationLogRow[] }>("/api/security/logs?type=speed_violation&limit=50");
      setSpeedViolations(r.items ?? []);
    } catch {
      setSpeedViolations([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchDailyOperationsReport(date);
      setData(r);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Could not load daily operations report");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadSpeedViolations();
  }, [loadSpeedViolations]);

  useEffect(() => {
    setReportTab("hubs");
  }, [date]);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const [{ settings }, rbac] = await Promise.all([fetchAdminPortalSettings(), fetchAdminRbac()]);
      const emails = [...new Set(rbac.items.map((i) => String(i.email || "").trim().toLowerCase()).filter(Boolean))].sort();
      setAdminEmails(emails);
      setScheduleEnabled(Boolean(settings.dailyOpsReportEmailEnabled));
      setScheduleTime(normalizeTimeForInput(settings.dailyOpsReportEmailTime));
      const saved = new Set(
        (settings.dailyOpsReportEmailRecipients ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
      );
      const pick: Record<string, boolean> = {};
      for (const em of emails) {
        pick[em] = saved.has(em);
      }
      setRecipientPick(pick);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not load portal settings");
    } finally {
      setScheduleLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    const s = io(ADMIN_API_ORIGIN, {
      transports: ["websocket", "polling"],
      withCredentials: false,
      reconnection: true,
      timeout: 10_000,
    });

    const refreshAll = () => {
      void load();
      void loadSpeedViolations();
    };

    // Join buses room so terminal-arrival broadcasts reach this client.
    s.on("connect", () => {
      s.emit("subscribe:buses");
    });
    s.on("commandAlert", refreshAll);
    s.on("bus_terminal_arrival", refreshAll);
    s.on("liveBoardSnapshot", refreshAll);

    return () => {
      s.off("commandAlert", refreshAll);
      s.off("bus_terminal_arrival", refreshAll);
      s.off("liveBoardSnapshot", refreshAll);
      s.close();
    };
  }, [load, loadSpeedViolations]);

  function toggleRecipient(email: string) {
    const k = email.toLowerCase();
    setRecipientPick((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  async function saveSchedule() {
    const recipients = adminEmails.filter((em) => recipientPick[em.toLowerCase()]);
    if (scheduleEnabled && recipients.length === 0) {
      showError("Turn on at least one admin, or turn off daily email.");
      return;
    }
    setScheduleSaving(true);
    try {
      const { settings } = await putAdminPortalSettings({
        dailyOpsReport: {
          enabled: scheduleEnabled,
          emailTime: scheduleTime,
          recipients,
        },
      });
      // Apply server response immediately — avoids a full “Loading schedule…” pass that hid toggles
      // and looked like everything reset. Persistence requires Admin_Backend with daily ops keys
      // in `updatePortalSettings` allowed-list (restart server after deploy).
      setScheduleEnabled(Boolean(settings.dailyOpsReportEmailEnabled));
      setScheduleTime(normalizeTimeForInput(settings.dailyOpsReportEmailTime));
      const savedRecipients = new Set(
        (settings.dailyOpsReportEmailRecipients ?? [])
          .map((e) => String(e).trim().toLowerCase())
          .filter(Boolean)
      );
      setRecipientPick((prev) => {
        const next: Record<string, boolean> = { ...prev };
        for (const em of adminEmails) {
          next[em] = savedRecipients.has(em);
        }
        return next;
      });
      showSuccess("Daily ops email schedule saved.");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save schedule");
    } finally {
      setScheduleSaving(false);
    }
  }

  const orgTitle = useMemo(() => {
    const n = branding.companyName?.trim();
    if (n) return n.toUpperCase();
    return "BUKIDNON TRANSIT";
  }, [branding.companyName]);

  const fleet = data?.fleetStatus;
  const speedRowsForTab = speedViolations.length > 0 ? speedViolations : (data?.speedViolations ?? []);

  return (
    <div className="reports-exec-suite daily-ops-suite">
      <section className="reports-hub daily-ops" aria-label="Daily operational log">
        <div className="reports-hub__watermark" aria-hidden />
        <div className="daily-ops__inner">
          <header className="daily-ops__toolbar daily-ops__toolbar--hub reports-hub__col-head">
            <div className="daily-ops__title-block">
              <p className="daily-ops__eyebrow">Automated daily operations reporter</p>
              <h2 className="daily-ops__hero-title">Daily operational log — {orgTitle}</h2>
            </div>
            <div className="daily-ops__controls">
              <label htmlFor="daily-ops-date">Report date</label>
              <input
                id="daily-ops-date"
                className="daily-ops__date-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value.slice(0, 10))}
              />
              <button
                type="button"
                className="reports-hub__export-action-btn"
                disabled={loading}
                onClick={() => {
                  void load();
                  void loadSpeedViolations();
                }}
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </header>

          <div className="reports-page__exec reports-page__exec--intel daily-ops__schedule-wrap">
            <article className="reports-page__stat reports-page__stat--hero daily-ops__schedule-article" aria-label="Automated email schedule">
              <div className="reports-page__stat-label-row">
                <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                Email schedule (automated)
              </div>
              {scheduleLoading ? (
                <p className="reports-hub__placeholder daily-ops__in-card-placeholder">Loading schedule settings…</p>
              ) : (
          <>
            <label className="daily-ops__schedule-row daily-ops__schedule-row--check">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
              />
              <span>Enable daily email from this portal</span>
            </label>
            <div className="daily-ops__schedule-row">
              <label htmlFor="daily-ops-send-time">Send time</label>
              <input
                id="daily-ops-send-time"
                className="daily-ops__time-input"
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value.slice(0, 5))}
              />
            </div>
            <p className="daily-ops__schedule-kicker">Admins who get the report</p>
            {adminEmails.length === 0 ? (
              <p className="daily-ops__empty">No admin emails loaded.</p>
            ) : (
              <div className="daily-ops__admin-toggles" role="group" aria-label="Recipients">
                {adminEmails.map((em) => {
                  const on = Boolean(recipientPick[em]);
                  return (
                    <button
                      key={em}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      className={`daily-ops__admin-toggle${on ? " daily-ops__admin-toggle--on" : ""}`}
                      onClick={() => toggleRecipient(em)}
                    >
                      <span className="daily-ops__admin-toggle-track" aria-hidden>
                        <span className="daily-ops__admin-toggle-knob" />
                      </span>
                      <span className="daily-ops__admin-toggle-email daily-ops__mono">{em}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="daily-ops__schedule-actions">
              <button
                type="button"
                className="reports-hub__export-action-btn"
                disabled={scheduleSaving}
                onClick={() => void saveSchedule()}
              >
                {scheduleSaving ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </>
        )}
            </article>
          </div>

          {err ? <p className="daily-ops__banner">{err}</p> : null}

          {!data && !err && loading ? (
            <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-fleet daily-ops__panel-shell daily-ops__panel-shell--loading">
              <p className="reports-hub__placeholder">Compiling telemetry &amp; dispatch records…</p>
            </div>
          ) : null}

          {data ? (
            <>
              <section className="reports-page__exec reports-page__exec--intel daily-ops__kpi-grid" aria-label="Report summary">
                <article className="reports-page__stat reports-page__stat--hero">
                  <div className="reports-page__stat-label-row">
                    <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                    Report day
                  </div>
                  <strong className="daily-ops__mono">{data.reportDate}</strong>
                  <span className="reports-page__stat-note">{formatHeaderDate(data.reportDate)}</span>
                </article>

                <article className="reports-page__stat reports-page__stat--hero">
                  <div className="reports-page__stat-label-row daily-ops__stat-label-row--split">
                    <span className="daily-ops__stat-label-cluster">
                      <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                      Fleet status (live GPS snapshot)
                    </span>
                    <span className="reports-hub__live-badge">
                      <span className="reports-hub__live-dot reports-hub__animate-heartbeat" aria-hidden />
                      LIVE
                    </span>
                  </div>
                  <strong className="daily-ops__fleet-strong">
                    <span className="daily-ops__tag--active">Moving: {fleet?.activeGps ?? 0}</span>
                    <span className="daily-ops__tag-sep" aria-hidden>
                      {" "}
                      ·{" "}
                    </span>
                    <span className="daily-ops__tag--stall">Stopped: {fleet?.stationary ?? 0}</span>
                    <span className="daily-ops__tag-sep" aria-hidden>
                      {" "}
                      ·{" "}
                    </span>
                    <span className="daily-ops__tag--sos">SOS: {fleet?.sosCount ?? 0}</span>
                  </strong>
                  <span className="reports-page__stat-note">Live snapshot from fleet GPS</span>
                </article>

                <article className="reports-page__stat reports-page__stat--hero">
                  <div className="reports-page__stat-label-row">
                    <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                    Bus registry · report built at
                  </div>
                  <strong>
                    {fleet?.totalRegistered ?? "—"} <span className="daily-ops__stat-soft">buses registered</span>
                  </strong>
                  <span className="reports-page__stat-note daily-ops__mono">
                    {new Date(data.generatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                  </span>
                </article>

                <article className="reports-page__stat reports-page__stat--hero">
                  <div className="reports-page__stat-label-row">
                    <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                    Arrival precision (24h)
                  </div>
                  <strong>{data.arrivalSummary?.precisionPct ?? 0}%</strong>
                  <span className="reports-page__stat-note">
                    {data.arrivalSummary?.onTimeTrips ?? 0}/{data.arrivalSummary?.totalTrips ?? 0} on-time trips
                  </span>
                </article>
              </section>

              <div className="reports-exec-forecast daily-ops__sync-strip" role="status">
                <span className="reports-exec-forecast__dot reports-hub__animate-heartbeat" aria-hidden />
                <p className="reports-exec-forecast__text">
                  Live sync · report built {new Date(data.generatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC ·
                  route delay sentiment — STABLE
                </p>
              </div>

              <nav className="daily-ops__nav reports-hub__nav-group" role="tablist" aria-label="Report sections">
                {DAILY_OPS_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`daily-ops-tab-${t.id}`}
                    aria-selected={reportTab === t.id}
                    aria-controls={`daily-ops-panel-${t.id}`}
                    className={`reports-hub__nav-btn${reportTab === t.id ? " reports-hub__nav-btn--active" : ""}`}
                    onClick={() => setReportTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>

              <div className="daily-ops__tab-panels">
                {reportTab === "hubs" ? (
                  <div
                    id="daily-ops-panel-hubs"
                    role="tabpanel"
                    aria-labelledby="daily-ops-tab-hubs"
                    className="daily-ops__panel"
                  >
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-fleet daily-ops__panel-shell">
                      {data.terminalHubs.length === 0 ? (
                        <div className="reports-page__exec reports-page__exec--intel daily-ops__hub-empty-exec">
                          <article className="reports-page__stat reports-page__stat--hero daily-ops__hub-empty-article" role="status">
                            <div className="reports-page__stat-label-row">
                              <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                              Terminal hub health
                            </div>
                            <strong>No terminal arrivals for this date</strong>
                            <span className="reports-page__stat-note">
                              Hub cards appear when geofence arrivals exist for the selected day. Try another date or refresh
                              after live trips complete.
                            </span>
                          </article>
                        </div>
                      ) : (
                        <div className="reports-page__exec reports-page__exec--intel daily-ops__hub-exec">
                          {data.terminalHubs.map((h) => (
                            <article
                              key={h.terminal}
                              className={`reports-page__stat reports-page__stat--hero daily-ops__hub-stat ${hubTierClass(h.tier)}`}
                              title={h.tierHint}
                            >
                              <div className="reports-page__stat-label-row">
                                <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                                {h.terminal}
                              </div>
                              <div className="daily-ops__hub-tier">{h.tierLabel}</div>
                              <strong>
                                On-time {h.onTime}/{h.arrivals} ({h.onTimePct}%)
                              </strong>
                              <span className="reports-page__stat-note">
                                Late {h.late} · Early {h.early}
                              </span>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {reportTab === "arrival" ? (
                  <div
                    id="daily-ops-panel-arrival"
                    role="tabpanel"
                    aria-labelledby="daily-ops-tab-arrival"
                    className="daily-ops__panel"
                  >
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-revenue daily-ops__panel-shell">
                      {data.arrivalPrecision.length === 0 ? (
                        <div className="reports-page__exec reports-page__exec--intel daily-ops__hub-empty-exec">
                          <article className="reports-page__stat reports-page__stat--hero daily-ops__hub-empty-article" role="status">
                            <div className="reports-page__stat-label-row">
                              <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                              Arrival precision
                            </div>
                            <strong>No arrival rows for this date</strong>
                            <span className="reports-page__stat-note">Geofence timestamps will populate this grid when trips complete.</span>
                          </article>
                        </div>
                      ) : (
                        <div className="daily-ops__table-wrap">
                    <table className="daily-ops__table">
                      <thead>
                        <tr>
                          <th>Bus</th>
                          <th>Terminal</th>
                          <th>Scheduled</th>
                          <th>Geofence (UTC)</th>
                          <th>Δ min</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.arrivalPrecision.map((r, i) => (
                          <tr key={`${r.busId}-${i}`}>
                            <td className="daily-ops__mono">{r.busId}</td>
                            <td>{r.terminal}</td>
                            <td className="daily-ops__mono">{r.scheduledBoard}</td>
                            <td className="daily-ops__mono">{r.geofenceArrivalAt ?? "—"}</td>
                            <td className="daily-ops__mono">{r.varianceMinutes == null ? "—" : String(r.varianceMinutes)}</td>
                            <td>{r.statusLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {reportTab === "incidents" ? (
                  <div
                    id="daily-ops-panel-incidents"
                    role="tabpanel"
                    aria-labelledby="daily-ops-tab-incidents"
                    className="daily-ops__panel"
                  >
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-passenger daily-ops__panel-shell">
                      {data.incidentTable.length === 0 ? (
                        <div className="reports-page__exec reports-page__exec--intel daily-ops__hub-empty-exec">
                          <article className="reports-page__stat reports-page__stat--hero daily-ops__hub-empty-article" role="status">
                            <div className="reports-page__stat-label-row">
                              <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                              Incident board
                            </div>
                            <strong>No incidents for this date</strong>
                            <span className="reports-page__stat-note">Logged incidents and alerts will appear in this board.</span>
                          </article>
                        </div>
                      ) : (
                        <>
                          <div className="daily-ops__table-wrap">
                            <table className="daily-ops__table">
                              <thead>
                                <tr>
                                  <th>Bus</th>
                                  <th>Staff</th>
                                  <th>Incident</th>
                                  <th>Speed</th>
                                  <th>Location / detail</th>
                                  <th>Time (UTC)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.incidentTable.map((r, i) => (
                                  <tr key={`${r.busId}-inc-${i}`}>
                                    <td className="daily-ops__mono">{r.busId}</td>
                                    <td className="daily-ops__mono">{r.staff}</td>
                                    <td>
                                      {incidentGlyph(r.incident)} {r.incident}
                                    </td>
                                    <td className="daily-ops__mono">
                                      {r.speedKph != null && Number.isFinite(r.speedKph) ? `${r.speedKph.toFixed(0)} km/h` : "—"}
                                    </td>
                                    <td className="daily-ops__mono">{r.location}</td>
                                    <td className="daily-ops__mono">
                                      {r.timestamp
                                        ? String(r.timestamp).replace("T", " ").slice(0, 19)
                                        : r.varianceMinutes != null
                                          ? `Δ${r.varianceMinutes}m · sched ${r.scheduledBoard ?? "—"}`
                                          : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {(data.speedingPeakByBus ?? []).length > 0 ? (
                            <div className="daily-ops__panel-stack">
                              <h4 className="daily-ops__panel-subtitle">Peak speed by bus</h4>
                              <div className="daily-ops__table-wrap">
                                <table className="daily-ops__table">
                                  <thead>
                                    <tr>
                                      <th>Bus</th>
                                      <th>Attendant</th>
                                      <th>Top speed</th>
                                      <th>Time (UTC)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(data.speedingPeakByBus ?? []).map((p, i) => (
                                      <tr key={`${p.busId}-peak-${i}`}>
                                        <td className="daily-ops__mono">{p.busId}</td>
                                        <td className="daily-ops__mono">{p.attendantName}</td>
                                        <td className="daily-ops__mono">{p.topSpeedKph} km/h</td>
                                        <td className="daily-ops__mono">
                                          {p.at ? String(p.at).replace("T", " ").slice(0, 19) : "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                {reportTab === "speed" ? (
                  <div
                    id="daily-ops-panel-speed"
                    role="tabpanel"
                    aria-labelledby="daily-ops-tab-speed"
                    className="daily-ops__panel"
                  >
                    <div className="reports-hub__chart-shell reports-hub__chart-shell--ambient-fleet daily-ops__panel-shell">
                      {speedRowsForTab.length === 0 ? (
                        <div className="reports-page__exec reports-page__exec--intel daily-ops__hub-empty-exec">
                          <article className="reports-page__stat reports-page__stat--hero daily-ops__hub-empty-article" role="status">
                            <div className="reports-page__stat-label-row">
                              <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
                              Fleet speed violations
                            </div>
                            <strong>No speed violations recorded yet</strong>
                            <span className="reports-page__stat-note">Security log speed events will list here when captured.</span>
                          </article>
                        </div>
                      ) : (
                        <div className="daily-ops__table-wrap">
                          <table className="daily-ops__table">
                      <thead>
                        <tr>
                          <th>Time (UTC)</th>
                          <th>Bus</th>
                          <th>Detail</th>
                          <th>GPS</th>
                          <th>Attendant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {speedRowsForTab.map((row, idx) => (
                          <tr key={"id" in row ? row.id : `${row.busId}-${idx}`}>
                            <td className="daily-ops__mono">
                              {"createdAt" in row && row.createdAt
                                ? new Date(row.createdAt).toISOString().replace("T", " ").slice(0, 19)
                                : "timestamp" in row && row.timestamp
                                  ? String(row.timestamp).replace("T", " ").slice(0, 19)
                                  : "—"}
                            </td>
                            <td className="daily-ops__mono">{row.busId}</td>
                            <td>{"message" in row ? row.message : row.incident}</td>
                            <td className="daily-ops__mono">
                              {row.latitude != null && row.longitude != null
                                ? `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`
                                : "—"}
                            </td>
                            <td>
                              {"attendantDisplayName" in row
                                ? (row.attendantDisplayName ?? "—")
                                : "staff" in row
                                  ? row.staff || "—"
                                  : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
