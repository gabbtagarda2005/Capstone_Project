import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { swalConfirm } from "@/lib/swal";
import {
  deleteLiveDispatchBlock,
  fetchBuses,
  fetchCorridorRoutes,
  fetchLiveDispatchBlocks,
  patchLiveDispatchBlock,
  postLiveDispatchPublishToday,
} from "@/lib/api";
import type { BusRow, CorridorRouteRow, LiveDispatchBlock } from "@/lib/types";
import "./ScheduleManagementPanel.css";

const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => i);

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function manilaClock(): { ymd: string; min: number } {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const o = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>;
  const ymd = `${o.year}-${o.month}-${o.day}`;
  const min = (parseInt(o.hour ?? "0", 10) || 0) * 60 + (parseInt(o.minute ?? "0", 10) || 0);
  return { ymd, min };
}

function deriveDispatchStatus(
  bl: LiveDispatchBlock,
  ymd: string,
  minSinceMidnight: number
): LiveDispatchBlock["status"] {
  if (bl.status === "cancelled") return "cancelled";
  if (bl.status === "arriving" || Boolean(bl.arrivalDetectedAt && String(bl.arrivalDetectedAt).trim())) return "arriving";
  const svc = (bl.serviceDate || "").trim() || ymd;
  const parts = (bl.scheduledDeparture || "00:00").split(":");
  const th = parseInt(parts[0] ?? "0", 10);
  const tm = parseInt(parts[1] ?? "0", 10);
  const depMin = (Number.isFinite(th) ? th : 0) * 60 + (Number.isFinite(tm) ? tm : 0);
  const grace = 12;
  if (svc < ymd) return "delayed";
  if (svc > ymd) return "on-time";
  if (minSinceMidnight < depMin) return "on-time";
  if (minSinceMidnight <= depMin + grace) return "on-time";
  return "delayed";
}

function findCorridorForBusRoute(routeLabel: string | null | undefined, corridors: CorridorRouteRow[]): CorridorRouteRow | null {
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

function DigitalTimePicker({
  open,
  title,
  hour,
  minute,
  onChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="sch-modal" role="dialog" aria-modal="true" aria-label="Departure time">
      <div className="sch-modal__backdrop" onClick={onCancel} />
      <div className="sch-modal__card">
        <h3 className="sch-modal__h">{title}</h3>
        <p className="sch-modal__sub">Monospace 24h — scheduled departure time on passenger board</p>
        <div className="sch-digital">
          <div className="sch-digital__col">
            <span className="sch-digital__label">Hour</span>
            <div className="sch-digital__scroll">
              {HOURS_24.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={"sch-digital__cell" + (h === hour ? " sch-digital__cell--on" : "")}
                  onClick={() => onChange(h, minute)}
                >
                  {pad2(h)}
                </button>
              ))}
            </div>
          </div>
          <span className="sch-digital__sep">:</span>
          <div className="sch-digital__col">
            <span className="sch-digital__label">Min</span>
            <div className="sch-digital__scroll">
              {MINUTES_60.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={"sch-digital__cell" + (m === minute ? " sch-digital__cell--on" : "")}
                  onClick={() => onChange(hour, m)}
                >
                  {pad2(m)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sch-digital__preview" aria-live="polite">
          {pad2(hour)}:{pad2(minute)}
        </div>
        <div className="sch-modal__actions">
          <button type="button" className="sch-btn sch-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="sch-btn sch-btn--primary" onClick={onConfirm}>
            Pair dispatch
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScheduleManagementPanel() {
  const [buses, setBuses] = useState<BusRow[]>([]);
  const [routes, setRoutes] = useState<CorridorRouteRow[]>([]);
  const [blocks, setBlocks] = useState<LiveDispatchBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editTime, setEditTime] = useState<{ blockId: string; hour: number; minute: number } | null>(null);

  const [plannerBusId, setPlannerBusId] = useState("");
  const [plannerTime, setPlannerTime] = useState("06:00");
  const [plannerBusy, setPlannerBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [bRes, rRes, dRes] = await Promise.all([
        fetchBuses(),
        fetchCorridorRoutes(),
        fetchLiveDispatchBlocks(),
      ]);
      setBuses(bRes.items ?? []);
      setRoutes((rRes.items ?? []).filter((r) => !r.suspended));
      setBlocks(dRes.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load dispatch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (blocks.length === 0) return;
    let cancelled = false;
    const sync = async () => {
      const { ymd, min } = manilaClock();
      let anyPatch = false;
      for (const bl of blocks) {
        const want = deriveDispatchStatus(bl, ymd, min);
        if (want !== bl.status) {
          anyPatch = true;
          try {
            await patchLiveDispatchBlock(bl.id, { status: want });
          } catch {
            /* ignore */
          }
        }
      }
      if (anyPatch && !cancelled) await load();
    };
    void sync();
    const id = window.setInterval(() => void sync(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [blocks, load]);

  const sortedBlocks = useMemo(() => {
    return [...blocks].sort((a, b) => {
      const da = a.serviceDate || "";
      const db = b.serviceDate || "";
      if (da !== db) return da.localeCompare(db);
      return a.scheduledDeparture.localeCompare(b.scheduledDeparture);
    });
  }, [blocks]);

  const plannerBus = useMemo(() => buses.find((b) => b.busId === plannerBusId), [buses, plannerBusId]);
  const plannerCorridor = useMemo(
    () => (plannerBus ? findCorridorForBusRoute(plannerBus.route, routes) : null),
    [plannerBus, routes]
  );

  const routeLabel = (r: CorridorRouteRow) =>
    r.displayName?.trim() || `${r.originLabel}–${r.destLabel}`;

  async function confirmEditTime() {
    if (!editTime) return;
    const dep = `${pad2(editTime.hour)}:${pad2(editTime.minute)}`;
    try {
      await patchLiveDispatchBlock(editTime.blockId, { scheduledDeparture: dep });
      setEditTime(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update time");
    }
  }

  async function removeBlock(id: string) {
    try {
      await deleteLiveDispatchBlock(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function openDepartureEditor(bl: LiveDispatchBlock) {
    const parts = bl.scheduledDeparture.split(":");
    const hh = parseInt(parts[0] ?? "6", 10);
    const mm = parseInt(parts[1] ?? "0", 10);
    setEditTime({
      blockId: bl.id,
      hour: Number.isFinite(hh) ? hh : 6,
      minute: Number.isFinite(mm) ? mm : 0,
    });
  }

  async function confirmRemoveBlock(bl: LiveDispatchBlock) {
    if (
      !(await swalConfirm({
        title: "Delete dispatch?",
        text: `Remove ${bl.routeLabel} · ${bl.busId} @ ${bl.scheduledDeparture} from the live board?`,
        icon: "warning",
        confirmButtonText: "Delete",
      }))
    )
      return;
    await removeBlock(bl.id);
  }

  async function publishTodayTrip() {
    if (!plannerBusId) {
      setErr("Select a bus.");
      return;
    }
    if (!plannerCorridor) {
      setErr("This bus has no corridor assigned in Fleet registry, or the label does not match an active route.");
      return;
    }
    const rawT = (plannerTime || "06:00").slice(0, 8);
    const tp = rawT.split(":");
    const hh = Math.min(23, Math.max(0, parseInt(tp[0] ?? "6", 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(tp[1] ?? "0", 10) || 0));
    const dep = `${pad2(hh)}:${pad2(mm)}`;
    setPlannerBusy(true);
    setErr(null);
    try {
      await postLiveDispatchPublishToday({
        busId: plannerBusId,
        routeId: plannerCorridor._id,
        routeLabel: routeLabel(plannerCorridor),
        departurePoint:
          plannerCorridor.originLabel?.trim() ||
          routeLabel(plannerCorridor).split(/\s*[–—-]\s*/)[0]?.trim() ||
          routeLabel(plannerCorridor),
        departureTime: dep,
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not publish trip");
    } finally {
      setPlannerBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="schedule-mgmt-panel schedule-mgmt-panel--loading">
        <p>Loading tactical dispatcher…</p>
      </div>
    );
  }

  return (
    <div className="schedule-mgmt-panel">
      <DigitalTimePicker
        open={!!editTime}
        title="Adjust scheduled departure"
        hour={editTime?.hour ?? 6}
        minute={editTime?.minute ?? 0}
        onChange={(h, m) => editTime && setEditTime({ ...editTime, hour: h, minute: m })}
        onConfirm={() => void confirmEditTime()}
        onCancel={() => setEditTime(null)}
      />

      <header className="sch-head">
        <div>
          <span className="sch-head__badge">Tactical dispatcher</span>
          <h2 className="sch-head__title">Active dispatches</h2>
        </div>
        <Link to="/dashboard/management/schedules/overview" className="sch-head__link">
          Live fleet departures
        </Link>
      </header>

      {err ? (
        <p className="sch-err" role="alert">
          {err}
        </p>
      ) : null}

      <section className="sch-bulk" aria-label="Departure planner">
        <div className="sch-weekly">
          <div className="sch-bus-split">
            <div className="sch-bus-split__left">
              <label className="sch-field sch-field--block">
                <span className="sch-bus-split__select-label">Select bus</span>
                <select
                  className="sch-bus-split__select"
                  value={plannerBusId}
                  onChange={(e) => setPlannerBusId(e.target.value)}
                >
                  <option value="">—</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.busId}>
                      {b.busId}
                      {b.plateNumber ? ` · ${b.plateNumber}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="sch-bus-split__right" aria-live="polite">
              <span className="sch-bus-split__select-label sch-bus-split__select-label--ghost" aria-hidden="true">
                Select bus
              </span>
              {plannerBus ? (
                <div className="sch-bus-preview">
                  <div className="sch-bus-preview__id sch-mono">{plannerBus.busId}</div>
                  {plannerBus.plateNumber ? (
                    <div className="sch-bus-preview__meta">Plate {plannerBus.plateNumber}</div>
                  ) : null}
                  {plannerBus.route?.trim() ? (
                    <div className="sch-bus-preview__meta">Registry route · {plannerBus.route.trim()}</div>
                  ) : null}
                  {plannerCorridor ? (
                    <div className="sch-bus-preview__corridor">{routeLabel(plannerCorridor)}</div>
                  ) : plannerBus.route?.trim() ? (
                    <div className="sch-bus-preview__warn">No matching active corridor for this route label.</div>
                  ) : (
                    <div className="sch-bus-preview__warn">No route on file for this bus.</div>
                  )}
                </div>
              ) : (
                <div className="sch-bus-preview sch-bus-preview--empty" />
              )}
            </div>
          </div>
          <div className="sch-bulk__row sch-bulk__row--wrap">
            <label className="sch-field">
              <span>Departure time</span>
              <input
                className="sch-mono"
                type="time"
                value={plannerTime.length > 5 ? plannerTime.slice(0, 5) : plannerTime}
                onChange={(e) => setPlannerTime(e.target.value || "06:00")}
              />
            </label>
          </div>
          <button
            type="button"
            className="sch-btn sch-btn--secondary"
            disabled={plannerBusy}
            onClick={() => void publishTodayTrip()}
          >
            {plannerBusy ? "Publishing…" : "Publish trip to live board"}
          </button>
        </div>
      </section>

      {sortedBlocks.length > 0 ? (
        <section className="sch-grid-section" aria-label="Active dispatches">
          <h3 className="sch-strip__label sch-strip__label--below">Active trip (per bus)</h3>
          <div className="sch-dispatch-grid">
            {sortedBlocks.map((bl) => (
              <article
                key={bl.id}
                className={"sch-card" + (bl.status === "arriving" ? " sch-card--arriving" : "")}
              >
                <div className="sch-card__top">
                  <div className="sch-card__route-block">
                    <span className="sch-card__route">{bl.routeLabel}</span>
                    <span className="sch-card__from">From {bl.departurePoint || "—"}</span>
                    {bl.serviceDate ? (
                      <span className="sch-card__date sch-mono">Service date {bl.serviceDate}</span>
                    ) : null}
                    {bl.status === "arriving" ? (
                      <span className="sch-card__geo">
                        {bl.arrivalTerminalName ? `Geofence · ${bl.arrivalTerminalName}` : "Terminal geofence active"}
                        {bl.arrivalLockedEta ? ` · ETA ${bl.arrivalLockedEta}` : ""}
                        {bl.gate ? ` · Gate ${bl.gate}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <button type="button" className="sch-card__time" onClick={() => openDepartureEditor(bl)}>
                    {bl.scheduledDeparture}
                  </button>
                </div>
                <div className="sch-card__bus sch-mono">{bl.busId}</div>
                <div className="sch-card__status sch-card__status--auto" aria-live="polite">
                  {(() => {
                    const { ymd, min } = manilaClock();
                    const st = deriveDispatchStatus(bl, ymd, min);
                    const label =
                      st === "on-time"
                        ? "On-Time"
                        : st === "delayed"
                          ? "Delayed"
                          : st === "cancelled"
                            ? "Cancelled"
                            : "Arriving";
                    const cls =
                      st === "on-time"
                        ? "sch-pill sch-pill--cyan sch-pill--active"
                        : st === "delayed"
                          ? "sch-pill sch-pill--amber sch-pill--active"
                          : st === "cancelled"
                            ? "sch-pill sch-pill--red sch-pill--active"
                            : "sch-pill sch-pill--crimson sch-pill--active";
                    return (
                      <span
                        className={cls}
                        title="Derived from Manila date/time vs scheduled departure; Arriving when terminal geofence fires."
                      >
                        {label}
                      </span>
                    );
                  })()}
                </div>
                <div className="sch-card__row-actions" role="group" aria-label="Dispatch actions">
                  <button
                    type="button"
                    className="sch-card__icon-btn"
                    title="Edit departure time"
                    aria-label="Edit departure time"
                    onClick={() => openDepartureEditor(bl)}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 21h4l11-11-4-4L4 17v4zm12-12l1 1"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path d="M15 4l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="sch-card__icon-btn sch-card__icon-btn--danger"
                    title="Delete dispatch"
                    aria-label="Delete dispatch"
                    onClick={() => void confirmRemoveBlock(bl)}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V5h6v2"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
