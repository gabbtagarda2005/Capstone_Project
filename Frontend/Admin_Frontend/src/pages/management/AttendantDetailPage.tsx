import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AttendantPerformanceRing } from "@/components/AttendantPerformanceRing";
import { EditAttendantModal } from "@/components/EditAttendantModal";
import { api } from "@/lib/api";
import { swalConfirm } from "@/lib/swal";
import { useToast } from "@/context/ToastContext";
import type {
  AttendantVerifiedSummary,
  BusLiveLogRow,
  BusRow,
  LoginLogRow,
  OperatorSummary,
  TicketRow,
} from "@/lib/types";
import { MgmtBackLink } from "@/components/MgmtBackLink";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";
import { LiveTicketOperationsTable } from "@/components/LiveTicketOperationsTable";
import "./AttendantTacticalDossier.css";

function isNumericOperatorId(s: string) {
  return /^\d+$/.test(s);
}

function opToAttendantRow(op: OperatorSummary): AttendantVerifiedSummary {
  return {
    operatorId: String(op.operatorId),
    employeeId: op.employeeId ?? null,
    firstName: op.firstName,
    lastName: op.lastName,
    middleName: op.middleName,
    email: op.email,
    phone: op.phone,
    role: op.role,
    otpVerified: true,
    profileImageUrl: null,
  };
}

type DossierPerformanceBreakdown = {
  activity: number;
  quality: number;
  verification: number;
  duty: number;
};

/** Ops ring from this attendant’s tickets, verification, data quality, and live duty signal. */
function dossierPerformanceScore(args: { tickets: TicketRow[]; verified: boolean; onDuty: boolean }): {
  pct: number;
  breakdown: DossierPerformanceBreakdown;
} {
  const now = Date.now();
  const tickets = args.tickets;
  const recent7d = tickets.filter((t) => {
    const ms = new Date(t.createdAt).getTime();
    return Number.isFinite(ms) && now - ms <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const activityScore = Math.min(100, (recent7d / 40) * 100);
  const completeRows = tickets.filter((t) => {
    return t.startLocation.trim() && t.destination.trim() && Number(t.fare) > 0;
  }).length;
  const qualityScore = tickets.length > 0 ? (completeRows / tickets.length) * 100 : 55;
  const verifiedScore = args.verified ? 100 : 58;
  const dutyScore = args.onDuty ? 100 : 62;
  const weighted = verifiedScore * 0.25 + activityScore * 0.4 + qualityScore * 0.25 + dutyScore * 0.1;
  const pct = Math.max(48, Math.min(99, Math.round(weighted)));
  return {
    pct,
    breakdown: {
      activity: Math.round(activityScore),
      quality: Math.round(qualityScore),
      verification: Math.round(verifiedScore),
      duty: Math.round(dutyScore),
    },
  };
}

function isFixRecent(iso: string | undefined, ms: number) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < ms;
}

function formatTicketTime(iso: string | undefined) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(iso).toLocaleString();
}

function formatTicketClock(iso: string | undefined) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(iso).toLocaleTimeString();
}

type DailyShiftGroup = {
  dayKey: string;
  dayLabel: string;
  totalRevenue: number;
  events: Array<{ time: string; label: string }>;
};

function AssignedUnitTile({ assignedBus }: { assignedBus: BusRow | null }) {
  return (
    <div className="att-dossier__tile att-dossier__tile--assigned">
      <span className="att-dossier__tile-label">Assigned unit</span>
      <div className="att-dossier__tile-assigned">
        <span className="att-dossier__tile-assigned-icon" aria-hidden>
          🚌
        </span>
        <div className="att-dossier__tile-assigned-meta">
          <p className="att-dossier__tile-assigned-line">{assignedBus ? `Bus ${assignedBus.busNumber}` : "No bus linked"}</p>
          <p className="att-dossier__tile-assigned-sub">{assignedBus?.route ?? "Assign from command dock"}</p>
          {assignedBus?.plateNumber ? (
            <span className="att-dossier__tile-assigned-plate">{assignedBus.plateNumber}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AttendantInsightsBlock({
  performancePct,
  performanceBreakdown,
  timelineEvents,
  dailyShiftGroups,
  recentTickets,
  attendantName,
  assignedBusNumber,
}: {
  performancePct: number;
  performanceBreakdown: DossierPerformanceBreakdown;
  timelineEvents: Array<{ time: string; label: string }>;
  dailyShiftGroups: DailyShiftGroup[];
  recentTickets: TicketRow[];
  attendantName: string;
  assignedBusNumber: string | null;
}) {
  const [passengerHubChip, setPassengerHubChip] = useState<string | null>(null);
  const passengerTableTickets = useMemo(() => {
    if (!passengerHubChip) return recentTickets;
    const needle = passengerHubChip.toLowerCase();
    return recentTickets.filter((t) => {
      const hay = `${t.startLocation} ${t.destination}`.toLowerCase();
      if (needle === "valencia") return hay.includes("valencia") || hay.includes("lumbo");
      return hay.includes(needle);
    });
  }, [recentTickets, passengerHubChip]);

  return (
    <div className="att-dossier__insights-panel">
      <div className="att-dossier__row-split att-dossier__row-split--insights">
        <section className="att-dossier__module att-dossier__module--insights">
          <h2 className="att-dossier__module-title">Performance ring</h2>
          <div className="att-dossier__insights-ring">
            <AttendantPerformanceRing percent={performancePct} caption="Ops rating" />
          </div>
          <p className="att-dossier__ring-breakdown">
            Activity {performanceBreakdown.activity} · Quality {performanceBreakdown.quality} · Verification{" "}
            {performanceBreakdown.verification} · Duty {performanceBreakdown.duty}
          </p>
        </section>
        <section className="att-dossier__module att-dossier__module--insights">
          <h2 className="att-dossier__module-title">Everyday shift</h2>
          {dailyShiftGroups.length > 0 ? (
            <div className="att-dossier__shift-groups">
              {dailyShiftGroups.map((group) => (
                <div key={group.dayKey} className="att-dossier__shift-group">
                  <div className="att-dossier__shift-group-head">
                    <span className="att-dossier__shift-group-day">{group.dayLabel}</span>
                    <span className="att-dossier__shift-group-revenue">₱{group.totalRevenue.toFixed(2)}</span>
                  </div>
                  <div className="att-dossier__timeline">
                    {group.events.map((ev, i) => (
                      <div key={`${group.dayKey}-${ev.time}-${i}`} className="att-dossier__timeline-row">
                        <span className="att-dossier__timeline-dot" />
                        <span className="att-dossier__timeline-time">{ev.time}</span>
                        <span className="att-dossier__timeline-label">{ev.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="att-dossier__timeline">
              {timelineEvents.map((ev, i) => (
                <div key={`${ev.time}-${i}`} className="att-dossier__timeline-row">
                  <span className="att-dossier__timeline-dot" />
                  <span className="att-dossier__timeline-time">{ev.time}</span>
                  <span className="att-dossier__timeline-label">{ev.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="att-dossier__module att-dossier__module--insights att-dossier__module--insights-list">
        <h2 className="att-dossier__module-title">Passengers ticketed</h2>
        {recentTickets.length === 0 ? (
          <p className="att-dossier__insights-foot">
            No tickets found for this attendant in ticketing storage (Mongo or SQL). Issue tickets from the attendant app
            while signed in, then refresh this page.
          </p>
        ) : (
          <div className="att-dossier__passenger-ops-table">
            <LiveTicketOperationsTable
              tickets={passengerTableTickets}
              hubChip={passengerHubChip}
              onHubChipChange={setPassengerHubChip}
              attendantNameOverride={attendantName}
              busNumberFallback={assignedBusNumber}
            />
          </div>
        )}
      </section>
    </div>
  );
}

export function AttendantDetailPage() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const raw = useParams().attendantId;
  const attendantId = raw ? decodeURIComponent(raw) : "";

  const [mongoProfile, setMongoProfile] = useState<AttendantVerifiedSummary | null | undefined>(undefined);
  const [op, setOp] = useState<OperatorSummary | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [logs, setLogs] = useState<LoginLogRow[]>([]);
  const [stats, setStats] = useState<{ ticketCount: number; totalRevenue: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [buses, setBuses] = useState<BusRow[]>([]);
  const [liveRows, setLiveRows] = useState<BusLiveLogRow[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignPick, setReassignPick] = useState<string | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const personnelAutoAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    personnelAutoAttemptedRef.current = new Set();
  }, [attendantId]);

  const loadOpsData = useCallback(async () => {
    if (!attendantId || !isNumericOperatorId(attendantId)) return;
    const id = Number(attendantId);
    const [profile, tix, lg, st] = await Promise.all([
      api<OperatorSummary>(`/api/operators/${id}`),
      api<{ items: TicketRow[] }>(`/api/operators/${id}/tickets`),
      api<{ items: LoginLogRow[] }>(`/api/operators/${id}/login-logs`),
      api<{ ticketCount: number; totalRevenue: number }>(`/api/operators/${id}/ticket-stats`),
    ]);
    setOp(profile);
    setTickets(tix.items);
    setLogs(lg.items);
    setStats(st);
  }, [attendantId]);

  useEffect(() => {
    if (!attendantId) {
      setErr("Missing attendant id.");
      setMongoProfile(null);
      return;
    }

    let cancelled = false;
    setErr(null);

    if (isNumericOperatorId(attendantId)) {
      const id = Number(attendantId);
      setMongoProfile(null);
      setOp(null);
      setTickets([]);
      setLogs([]);
      setStats(null);
      (async () => {
        try {
          const [profile, tix, lg, st] = await Promise.all([
            api<OperatorSummary>(`/api/operators/${id}`),
            api<{ items: TicketRow[] }>(`/api/operators/${id}/tickets`),
            api<{ items: LoginLogRow[] }>(`/api/operators/${id}/login-logs`),
            api<{ ticketCount: number; totalRevenue: number }>(`/api/operators/${id}/ticket-stats`),
          ]);
          if (!cancelled) {
            setOp(profile);
            setTickets(tix.items);
            setLogs(lg.items);
            setStats(st);
          }
        } catch (e) {
          if (!cancelled) {
            setOp(null);
            setErr(e instanceof Error ? e.message : "Failed to load operator.");
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const vRes = await api<{ items: AttendantVerifiedSummary[] }>("/api/attendants/verified");
        const found = vRes.items.find((a) => a.operatorId === attendantId) ?? null;
        if (!cancelled) {
          setMongoProfile(found);
          if (!found) setErr("Attendant not found in verified roster.");
        }
      } catch (e) {
        if (!cancelled) {
          setMongoProfile(null);
          setErr(e instanceof Error ? e.message : "Failed to load attendant.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attendantId]);

  /** Portal attendant (Mongo ObjectId): load IssuedTicketRecord rows by issuerSub (works with or without MySQL pool). */
  useEffect(() => {
    if (!attendantId || isNumericOperatorId(attendantId)) return;
    let cancelled = false;
    setTickets([]);
    setStats(null);
    void (async () => {
      try {
        const [tix, st] = await Promise.all([
          api<{ items: TicketRow[] }>(`/api/operators/${encodeURIComponent(attendantId)}/tickets`),
          api<{ ticketCount: number; totalRevenue: number }>(
            `/api/operators/${encodeURIComponent(attendantId)}/ticket-stats`
          ),
        ]);
        if (cancelled) return;
        setTickets(tix.items ?? []);
        setStats(st);
      } catch {
        if (!cancelled) {
          setTickets([]);
          setStats(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attendantId]);

  const loadFleetContext = useCallback(async () => {
    try {
      const bRes = await api<{ items: BusRow[] }>("/api/buses");
      setBuses(bRes.items);
    } catch {
      setBuses([]);
    }
  }, []);

  useEffect(() => {
    void loadFleetContext();
  }, [loadFleetContext]);

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

  const assignedBus = useMemo(
    () => buses.find((b) => b.operatorId != null && String(b.operatorId) === String(attendantId)) ?? null,
    [buses, attendantId]
  );

  const liveRow = useMemo(
    () => (assignedBus ? liveRows.find((l) => l.busId === assignedBus.busId) : undefined),
    [assignedBus, liveRows]
  );

  const onDuty = useMemo(() => {
    if (!assignedBus) return false;
    const gpsOk = isFixRecent(liveRow?.recordedAt, 30 * 60 * 1000);
    const seenOk = isFixRecent(assignedBus.lastSeenAt ?? undefined, 30 * 60 * 1000);
    return gpsOk || seenOk;
  }, [assignedBus, liveRow]);

  const attendantDisplayName = useMemo(() => {
    if (op) return `${op.firstName} ${op.lastName}`.trim();
    if (mongoProfile) return `${mongoProfile.firstName} ${mongoProfile.lastName}`.trim();
    return "";
  }, [mongoProfile, op]);

  const attendantTickets = useMemo(() => {
    const numericId = Number(attendantId);
    if (Number.isFinite(numericId) && numericId > 0) {
      const byIssuer = tickets.filter((t) => Number(t.issuedByOperatorId) === numericId);
      if (byIssuer.length > 0) return byIssuer;
    }
    const name = attendantDisplayName.trim().toLowerCase();
    if (name) {
      const byName = tickets.filter((t) => (t.busOperatorName ?? "").trim().toLowerCase() === name);
      if (byName.length > 0) return byName;
    }
    return tickets;
  }, [attendantDisplayName, attendantId, tickets]);

  const performanceScore = useMemo(() => {
    const verified =
      mongoProfile != null ? mongoProfile.otpVerified : op != null ? op.otpVerified !== false : true;
    return dossierPerformanceScore({
      tickets: attendantTickets,
      verified: verified !== false,
      onDuty,
    });
  }, [attendantTickets, mongoProfile, op, onDuty]);

  const timelineEvents = useMemo(() => {
    if (logs.length > 0) {
      return [...logs]
        .sort((a, b) => new Date(b.loginTimestamp).getTime() - new Date(a.loginTimestamp).getTime())
        .slice(0, 10)
        .map((l, i) => ({
          time: new Date(l.loginTimestamp).toLocaleString(),
          label: i === 0 ? "Latest portal session" : "Prior login",
        }));
    }
    if (attendantTickets.length > 0) {
      return [...attendantTickets]
        .filter((t) => t.createdAt)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10)
        .map((t) => ({
          time: formatTicketTime(t.createdAt),
          label: `Ticket · ${t.passengerId} · ₱${Number(t.fare).toFixed(0)}`,
        }));
    }
    if (mongoProfile?.otpVerified || op?.otpVerified) {
      return [{ time: "—", label: "No login log (SQL off). Ticket issuances appear above when recorded." }];
    }
    return [{ time: "—", label: "No session or ticket activity recorded yet." }];
  }, [logs, mongoProfile, op, attendantTickets]);

  const dailyShiftGroups = useMemo<DailyShiftGroup[]>(() => {
    if (attendantTickets.length === 0) return [];
    const sorted = [...attendantTickets]
      .filter((t) => !!t.createdAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 40);
    const buckets = new Map<string, DailyShiftGroup>();
    sorted.forEach((t) => {
      const d = new Date(t.createdAt);
      if (!Number.isFinite(d.getTime())) return;
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dayLabel = d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });
      const existing = buckets.get(dayKey) ?? { dayKey, dayLabel, totalRevenue: 0, events: [] };
      existing.totalRevenue += Number(t.fare) || 0;
      existing.events.push({
        time: formatTicketClock(t.createdAt),
        label: `Ticket · ${t.passengerId} · ₱${Number(t.fare).toFixed(0)}`,
      });
      buckets.set(dayKey, existing);
    });
    return [...buckets.values()]
      .sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1))
      .slice(0, 7);
  }, [attendantTickets]);

  /** Auto-assign system 6-digit personnel ID when missing (registry + PortalUser / MySQL). */
  useEffect(() => {
    if (!attendantId) return;
    const key = `${isNumericOperatorId(attendantId) ? "mysql" : "mongo"}:${attendantId}`;
    if (personnelAutoAttemptedRef.current.has(key)) return;

    if (isNumericOperatorId(attendantId)) {
      if (!op || op.employeeId?.trim()) return;
    } else {
      if (mongoProfile === undefined || mongoProfile === null) return;
      if (mongoProfile.employeeId?.trim()) return;
    }

    personnelAutoAttemptedRef.current.add(key);
    void (async () => {
      try {
        await api(`/api/attendants/registry/${encodeURIComponent(attendantId)}/ensure-personnel-id`, {
          method: "POST",
        });
        if (isNumericOperatorId(attendantId)) {
          await loadOpsData();
        } else {
          const vRes = await api<{ items: AttendantVerifiedSummary[] }>("/api/attendants/verified");
          setMongoProfile(vRes.items.find((a) => a.operatorId === attendantId) ?? null);
        }
      } catch {
        /* Registry missing or server error — UI may still show — */
      }
    })();
  }, [attendantId, op, mongoProfile, loadOpsData]);

  const editTarget: AttendantVerifiedSummary | null = (op ? opToAttendantRow(op) : mongoProfile) ?? null;

  async function handleEditSave(payload: {
    firstName: string;
    lastName: string;
    middleName: string;
    phone: string;
  }) {
    const body = {
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      middleName: payload.middleName.trim() ? payload.middleName.trim() : null,
      phone: payload.phone.trim() ? payload.phone.trim() : null,
    };
    if (isNumericOperatorId(attendantId)) {
      await api(`/api/operators/${encodeURIComponent(attendantId)}`, { method: "PATCH", json: body });
      showSuccess("Profile updated.");
      await loadOpsData();
      return;
    }
    await api(`/api/attendants/registry/${encodeURIComponent(attendantId)}`, { method: "PATCH", json: body });
    showSuccess("Profile updated.");
    const vRes = await api<{ items: AttendantVerifiedSummary[] }>("/api/attendants/verified");
    setMongoProfile(vRes.items.find((a) => a.operatorId === attendantId) ?? null);
  }

  async function applyReassign(targetBusMongoId: string | null) {
    setReassignBusy(true);
    try {
      for (const b of buses) {
        if (b.operatorId != null && String(b.operatorId) === String(attendantId) && b.id !== targetBusMongoId) {
          await api(`/api/buses/${encodeURIComponent(b.id)}`, { method: "PATCH", json: { operatorId: null } });
        }
      }
      if (targetBusMongoId) {
        await api(`/api/buses/${encodeURIComponent(targetBusMongoId)}`, {
          method: "PATCH",
          json: { operatorId: attendantId },
        });
      }
      showSuccess(targetBusMongoId ? "Unit reassigned." : "Attendant unassigned from all buses.");
      setReassignOpen(false);
      await loadFleetContext();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Reassign failed");
    } finally {
      setReassignBusy(false);
    }
  }

  async function handleRevoke() {
    if (
      !(await swalConfirm({
        title: "Revoke access?",
        text: "Revoke this attendant’s access? This cannot be undone.",
        icon: "warning",
        confirmButtonText: "Revoke",
      }))
    )
      return;
    try {
      if (mongoProfile && !isNumericOperatorId(attendantId)) {
        await api(`/api/attendants/registry/${encodeURIComponent(attendantId)}`, { method: "DELETE" });
        showSuccess("Access revoked.");
        navigate("/dashboard/management/attendants");
        return;
      }
      if (isNumericOperatorId(attendantId)) {
        await api(`/api/operators/${encodeURIComponent(attendantId)}`, { method: "DELETE" });
        showSuccess("Operator removed.");
        navigate("/dashboard/management/attendants");
        return;
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : "Revoke failed");
    }
  }

  if (!attendantId) {
    return (
      <ManagementDetailShell backModule="attendants" title="Attendant" subtitle="Roster">
        <p className="mgmt-mod__unknown">Invalid link.</p>
      </ManagementDetailShell>
    );
  }

  if (isNumericOperatorId(attendantId)) {
    if (err && !op) {
      return (
        <ManagementDetailShell backModule="attendants" title="Attendant dossier" subtitle="Ticketing operator">
          <p className="mgmt-mod__unknown">{err}</p>
        </ManagementDetailShell>
      );
    }
    if (!op) {
      return (
        <ManagementDetailShell backModule="attendants" title="Attendant dossier" subtitle="Loading…">
          <p className="mgmt-mod__unknown">Loading…</p>
        </ManagementDetailShell>
      );
    }

    const name = [op.firstName, op.middleName, op.lastName].filter(Boolean).join(" ");
    const roleLabel = op.role === "Operator" ? "Bus attendant" : op.role;

    return (
      <div className="admin-mgmt">
        <div className="mgmt-mod mgmt-mod--wide">
          <div className="att-dossier">
            <div className="att-dossier__topbar">
              <MgmtBackLink to="/dashboard/management/attendants" label="Attendant roster" className="att-dossier__mgmt-back" />
            </div>

            <header className="att-dossier__header">
              <h1 className="att-dossier__name">{name}</h1>
              <div className="att-dossier__status" aria-live="polite">
                <span
                  className={
                    "att-dossier__status-dot " + (onDuty ? "att-dossier__status-dot--on" : "att-dossier__status-dot--off")
                  }
                />
                {onDuty ? "On-Duty" : "Off-Duty"}
              </div>
            </header>

            <div className="att-dossier__grid">
              <div className="att-dossier__tile">
                <span className="att-dossier__tile-label">Email</span>
                <p className="att-dossier__tile-value">{op.email}</p>
              </div>
              <div className="att-dossier__tile">
                <span className="att-dossier__tile-label">Phone</span>
                <p className="att-dossier__tile-value att-dossier__tile-value--mono">{op.phone || "—"}</p>
              </div>
              <div className="att-dossier__tile">
                <span className="att-dossier__tile-label">Role</span>
                <p className="att-dossier__tile-value">{roleLabel}</p>
              </div>
            </div>

            <div className="att-dossier__grid">
              <div className="att-dossier__tile">
                <span className="att-dossier__tile-label">Middle name</span>
                <p className="att-dossier__tile-value">{op.middleName || "—"}</p>
              </div>
              <div className="att-dossier__tile">
                <span className="att-dossier__tile-label">Personnel ID (6-digit)</span>
                <p className="att-dossier__tile-value att-dossier__tile-value--mono">{op.employeeId || "—"}</p>
              </div>
              <div className="att-dossier__tile">
                <span className="att-dossier__tile-label">Status</span>
                <p className="att-dossier__tile-value">{op.otpVerified ? "Verified" : "Active"}</p>
              </div>
            </div>

            <div className="att-dossier__grid att-dossier__grid--assigned-slot">
              <AssignedUnitTile assignedBus={assignedBus} />
            </div>

            {stats ? (
              <div className="att-dossier__stats-row">
                <div className="att-dossier__stat-chip">
                  <span className="att-dossier__stat-chip-k">Tickets issued</span>
                  <span className="att-dossier__stat-chip-v">{stats.ticketCount}</span>
                </div>
                <div className="att-dossier__stat-chip">
                  <span className="att-dossier__stat-chip-k">Total ₱ collected</span>
                  <span className="att-dossier__stat-chip-v">₱{stats.totalRevenue.toFixed(2)}</span>
                </div>
              </div>
            ) : null}

            <footer className="att-dossier__dock">
              <div className="att-dossier__dock-primary">
                <button type="button" className="att-dossier__dock-btn att-dossier__dock-btn--blue" onClick={() => setEditOpen(true)}>
                  Edit profile
                </button>
                <button
                  type="button"
                  className="att-dossier__dock-btn att-dossier__dock-btn--blue"
                  onClick={() => {
                    setReassignPick(assignedBus?.id ?? null);
                    setReassignOpen(true);
                  }}
                >
                  Reassign unit
                </button>
              </div>
              <button type="button" className="att-dossier__dock-btn att-dossier__dock-btn--red" onClick={() => void handleRevoke()}>
                Revoke access
              </button>
            </footer>

            <div className="att-dossier__insights">
              <button
                type="button"
                className="att-dossier__insights-toggle"
                aria-expanded={insightsOpen}
                onClick={() => setInsightsOpen((v) => !v)}
              >
                {insightsOpen ? "Hide performance & shift activity" : "Show performance & shift activity"}
              </button>
              {insightsOpen ? (
                <AttendantInsightsBlock
                  performancePct={performanceScore.pct}
                  performanceBreakdown={performanceScore.breakdown}
                  timelineEvents={timelineEvents}
                  dailyShiftGroups={dailyShiftGroups}
                  recentTickets={attendantTickets}
                  attendantName={attendantDisplayName}
                  assignedBusNumber={assignedBus?.busNumber ?? null}
                />
              ) : null}
            </div>

            <EditAttendantModal
              attendant={editOpen ? editTarget : null}
              onClose={() => setEditOpen(false)}
              onSave={handleEditSave}
            />

            {reassignOpen ? (
              <div className="att-dossier-overlay" role="dialog" aria-modal="true" aria-labelledby="att-reassign-title">
                <div className="att-dossier-overlay__panel">
                  <div className="att-dossier-overlay__head">
                    <h2 id="att-reassign-title">Reassign unit</h2>
                    <p className="att-dossier-overlay__sub">
                      Select a fleet bus. Other buses with this attendant are cleared first.
                    </p>
                  </div>
                  <div className="att-dossier-overlay__list">
                    <button
                      type="button"
                      className={
                        "att-dossier-overlay__row " +
                        (reassignPick === null ? "att-dossier-overlay__row--selected" : "")
                      }
                      onClick={() => setReassignPick(null)}
                    >
                      <span className="att-dossier-overlay__row-k">Unassign all buses</span>
                      <span className="att-dossier-overlay__row-v">Remove attendant from every unit</span>
                    </button>
                    {buses.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        className={
                          "att-dossier-overlay__row " + (reassignPick === b.id ? "att-dossier-overlay__row--selected" : "")
                        }
                        onClick={() => setReassignPick(b.id)}
                      >
                        <span className="att-dossier-overlay__row-k">{b.busNumber}</span>
                        <span className="att-dossier-overlay__row-v">
                          {b.plateNumber ?? "—"} · {b.route ?? "No route"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="att-dossier-overlay__foot">
                    <button type="button" onClick={() => setReassignOpen(false)} disabled={reassignBusy}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="att-dossier-overlay__primary"
                      disabled={reassignBusy}
                      onClick={() => void applyReassign(reassignPick)}
                    >
                      {reassignBusy ? "Applying…" : "Apply assignment"}
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

  if (mongoProfile === undefined) {
    return (
      <ManagementDetailShell backModule="attendants" title="Attendant dossier" subtitle="Loading…">
        <p className="mgmt-mod__unknown">Loading…</p>
      </ManagementDetailShell>
    );
  }

  if (err || !mongoProfile) {
    return (
      <ManagementDetailShell backModule="attendants" title="Attendant dossier" subtitle="Verified roster">
        <p className="mgmt-mod__unknown">{err ?? "Not found."}</p>
      </ManagementDetailShell>
    );
  }

  const displayName = `${mongoProfile.firstName} ${mongoProfile.lastName}`.trim();
  const roleLabel = mongoProfile.role === "Operator" ? "Bus attendant" : mongoProfile.role;

  return (
    <div className="admin-mgmt">
      <div className="mgmt-mod mgmt-mod--wide">
        <div className="att-dossier">
          <div className="att-dossier__topbar">
            <MgmtBackLink to="/dashboard/management/attendants" label="Attendant roster" className="att-dossier__mgmt-back" />
          </div>

          <header className="att-dossier__header">
            <h1 className="att-dossier__name">{displayName}</h1>
            <div className="att-dossier__status" aria-live="polite">
              <span
                className={
                  "att-dossier__status-dot " + (onDuty ? "att-dossier__status-dot--on" : "att-dossier__status-dot--off")
                }
              />
              {onDuty ? "On-Duty" : "Off-Duty"}
            </div>
          </header>

          <div className="att-dossier__grid">
            <div className="att-dossier__tile">
              <span className="att-dossier__tile-label">Email</span>
              <p className="att-dossier__tile-value">{mongoProfile.email}</p>
            </div>
            <div className="att-dossier__tile">
              <span className="att-dossier__tile-label">Phone</span>
              <p className="att-dossier__tile-value att-dossier__tile-value--mono">{mongoProfile.phone || "—"}</p>
            </div>
            <div className="att-dossier__tile">
              <span className="att-dossier__tile-label">Role</span>
              <p className="att-dossier__tile-value">{roleLabel}</p>
            </div>
          </div>

          <div className="att-dossier__grid">
            <div className="att-dossier__tile">
              <span className="att-dossier__tile-label">Middle name</span>
              <p className="att-dossier__tile-value">{mongoProfile.middleName || "—"}</p>
            </div>
            <div className="att-dossier__tile">
              <span className="att-dossier__tile-label">Personnel ID (6-digit)</span>
              <p className="att-dossier__tile-value att-dossier__tile-value--mono">{mongoProfile.employeeId || "—"}</p>
            </div>
            <div className="att-dossier__tile">
              <span className="att-dossier__tile-label">Status</span>
              <p className="att-dossier__tile-value">{mongoProfile.otpVerified ? "Verified" : "Legacy"}</p>
            </div>
          </div>

          <div className="att-dossier__grid att-dossier__grid--assigned-slot">
            <AssignedUnitTile assignedBus={assignedBus} />
          </div>

          {stats ? (
            <div className="att-dossier__stats-row">
              <div className="att-dossier__stat-chip">
                <span className="att-dossier__stat-chip-k">Tickets issued</span>
                <span className="att-dossier__stat-chip-v">{stats.ticketCount}</span>
              </div>
              <div className="att-dossier__stat-chip">
                <span className="att-dossier__stat-chip-k">Total ₱ collected</span>
                <span className="att-dossier__stat-chip-v">₱{stats.totalRevenue.toFixed(2)}</span>
              </div>
            </div>
          ) : null}

          <footer className="att-dossier__dock">
            <div className="att-dossier__dock-primary">
              <button type="button" className="att-dossier__dock-btn att-dossier__dock-btn--blue" onClick={() => setEditOpen(true)}>
                Edit profile
              </button>
              <button
                type="button"
                className="att-dossier__dock-btn att-dossier__dock-btn--blue"
                onClick={() => {
                  setReassignPick(assignedBus?.id ?? null);
                  setReassignOpen(true);
                }}
              >
                Reassign unit
              </button>
            </div>
            <button type="button" className="att-dossier__dock-btn att-dossier__dock-btn--red" onClick={() => void handleRevoke()}>
              Revoke access
            </button>
          </footer>

          <div className="att-dossier__insights">
            <button
              type="button"
              className="att-dossier__insights-toggle"
              aria-expanded={insightsOpen}
              onClick={() => setInsightsOpen((v) => !v)}
            >
              {insightsOpen ? "Hide performance & shift activity" : "Show performance & shift activity"}
            </button>
            {insightsOpen ? (
              <AttendantInsightsBlock
                performancePct={performanceScore.pct}
                performanceBreakdown={performanceScore.breakdown}
                timelineEvents={timelineEvents}
                dailyShiftGroups={dailyShiftGroups}
                recentTickets={attendantTickets}
                attendantName={attendantDisplayName}
                assignedBusNumber={assignedBus?.busNumber ?? null}
              />
            ) : null}
          </div>

          <EditAttendantModal attendant={editOpen ? mongoProfile : null} onClose={() => setEditOpen(false)} onSave={handleEditSave} />

          {reassignOpen ? (
            <div className="att-dossier-overlay" role="dialog" aria-modal="true" aria-labelledby="att-reassign-title-mongo">
              <div className="att-dossier-overlay__panel">
                <div className="att-dossier-overlay__head">
                  <h2 id="att-reassign-title-mongo">Reassign unit</h2>
                  <p className="att-dossier-overlay__sub">Select a fleet bus. Other buses with this attendant are cleared first.</p>
                </div>
                <div className="att-dossier-overlay__list">
                  <button
                    type="button"
                    className={
                      "att-dossier-overlay__row " + (reassignPick === null ? "att-dossier-overlay__row--selected" : "")
                    }
                    onClick={() => setReassignPick(null)}
                  >
                    <span className="att-dossier-overlay__row-k">Unassign all buses</span>
                    <span className="att-dossier-overlay__row-v">Remove attendant from every unit</span>
                  </button>
                  {buses.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={
                        "att-dossier-overlay__row " + (reassignPick === b.id ? "att-dossier-overlay__row--selected" : "")
                      }
                      onClick={() => setReassignPick(b.id)}
                    >
                      <span className="att-dossier-overlay__row-k">{b.busNumber}</span>
                      <span className="att-dossier-overlay__row-v">
                        {b.plateNumber ?? "—"} · {b.route ?? "No route"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="att-dossier-overlay__foot">
                  <button type="button" onClick={() => setReassignOpen(false)} disabled={reassignBusy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="att-dossier-overlay__primary"
                    disabled={reassignBusy}
                    onClick={() => void applyReassign(reassignPick)}
                  >
                    {reassignBusy ? "Applying…" : "Apply assignment"}
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
