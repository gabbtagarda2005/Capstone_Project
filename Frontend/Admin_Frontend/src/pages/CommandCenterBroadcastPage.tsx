import { useCallback, useEffect, useId, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CommandCenterSubPageShell } from "@/components/CommandCenterSubPageShell";
import { postAdminAuditEvent, postAdminBroadcast } from "@/lib/api";
import "./CommandCenterPage.css";

const LS_BROADCAST = "command_center_broadcast_draft";
const LS_BROADCAST_SEVERITY = "command_center_broadcast_severity_v1";
const LS_BROADCAST_TARGETS = "command_center_broadcast_targets_v2";
/** @deprecated use LS_BROADCAST_TARGETS */
const LS_BROADCAST_TARGET_LEGACY = "command_center_broadcast_target_v1";
/** @deprecated migrated to LS_BROADCAST_SEVERITY */
const LS_BROADCAST_PRIORITY_LEGACY = "command_center_broadcast_priority_v1";

type BroadcastSeverity = "normal" | "medium" | "critical";

function targetSummary(toPassenger: boolean, toAttendant: boolean): string {
  if (toPassenger && toAttendant) return "Passenger App · Bus Attendant App";
  if (toPassenger) return "Passenger App";
  if (toAttendant) return "Bus Attendant App";
  return "No app selected";
}

export function CommandCenterBroadcastPage() {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const [broadcast, setBroadcast] = useState("");
  const [toPassenger, setToPassenger] = useState(true);
  const [toAttendant, setToAttendant] = useState(false);
  const [severity, setSeverity] = useState<BroadcastSeverity>("normal");
  const [sentFlash, setSentFlash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    try {
      const d = localStorage.getItem(LS_BROADCAST);
      if (d) setBroadcast(d);
      const rawTargets = localStorage.getItem(LS_BROADCAST_TARGETS);
      if (rawTargets) {
        const arr = JSON.parse(rawTargets) as unknown;
        if (Array.isArray(arr)) {
          setToPassenger(arr.includes("passenger"));
          setToAttendant(arr.includes("attendant"));
        }
      } else {
        const leg = localStorage.getItem(LS_BROADCAST_TARGET_LEGACY);
        if (leg === "attendant") {
          setToPassenger(false);
          setToAttendant(true);
        } else if (leg === "passenger") {
          setToPassenger(true);
          setToAttendant(false);
        }
      }
      const sev = localStorage.getItem(LS_BROADCAST_SEVERITY);
      if (sev === "normal" || sev === "medium" || sev === "critical") {
        setSeverity(sev);
      } else if (localStorage.getItem(LS_BROADCAST_PRIORITY_LEGACY) === "1") {
        setSeverity("critical");
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const hint = (location.state as { tacticalBroadcastHint?: string } | null)?.tacticalBroadcastHint?.trim();
    if (!hint) return;
    setBroadcast((prev) => {
      const p = prev.trim();
      if (!p) return hint;
      if (p.includes(hint)) return prev;
      return `${p}\n\n${hint}`;
    });
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_BROADCAST_SEVERITY, severity);
    } catch {
      /* ignore */
    }
  }, [severity]);

  useEffect(() => {
    try {
      const targets: string[] = [];
      if (toPassenger) targets.push("passenger");
      if (toAttendant) targets.push("attendant");
      localStorage.setItem(LS_BROADCAST_TARGETS, JSON.stringify(targets));
    } catch {
      /* ignore */
    }
  }, [toPassenger, toAttendant]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_BROADCAST, broadcast);
    } catch {
      /* ignore */
    }
  }, [broadcast]);

  const sendBroadcast = useCallback(async () => {
    const msg = broadcast.trim();
    setSendError(null);
    if (!msg) {
      setSendError("Enter a message to broadcast.");
      return;
    }
    const targets: ("passenger" | "attendant")[] = [];
    if (toPassenger) targets.push("passenger");
    if (toAttendant) targets.push("attendant");
    if (targets.length === 0) {
      setSendError("Turn on at least one app: Passenger App and/or Bus Attendant App.");
      return;
    }
    setSending(true);
    try {
      await postAdminBroadcast({
        targets,
        message: msg,
        severity,
      });
      const tgtLabel = targets.map((t) => t.toUpperCase()).join(" + ");
      void postAdminAuditEvent({
        action: "BROADCAST",
        module: "Command Center",
        details: `[${severity.toUpperCase()}] [${tgtLabel}] Sent to app(s): ${msg.slice(0, 400)}${msg.length > 400 ? "…" : ""}`,
      }).catch(() => {});
      setSentFlash(`Sent to ${targetSummary(toPassenger, toAttendant)}.`);
      window.setTimeout(() => setSentFlash(null), 3200);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Broadcast failed.");
    } finally {
      setSending(false);
    }
  }, [broadcast, toPassenger, toAttendant, severity]);

  const severityClass =
    severity === "critical"
      ? " command-center--broadcast-severity-critical"
      : severity === "medium"
        ? " command-center--broadcast-severity-medium"
        : "";

  return (
    <div className={"command-center command-center--tactical command-center--sub command-center--crumbs-left" + severityClass}>
      <CommandCenterSubPageShell page="broadcast">
        <header className="command-center__sub-head">
          <h1 className="command-center__sub-title">Broadcast center</h1>
          <p className="command-center__sub-lead">Push notices to Passenger and Bus Attendant apps</p>
        </header>

        {sentFlash ? <div className="command-center__flash">{sentFlash}</div> : null}
        {sendError ? (
          <div className="command-center__flash command-center__flash--err" role="alert">
            {sendError}
          </div>
        ) : null}

        <div className="command-center__sub-body command-center__sub-body--narrow">
        <section className="command-center__card command-center__card--glass command-center__card--broadcast" aria-labelledby={`${id}-bc`}>
          <h2 id={`${id}-bc`} className="command-center__h2">
            Broadcast
          </h2>

          <div className="command-center__severity-row" role="group" aria-label="Broadcast priority">
            <span className="command-center__severity-label">Priority</span>
            <div className="command-center__severity-btns">
              {(
                [
                  { id: "normal" as const, label: "Normal" },
                  { id: "medium" as const, label: "Medium" },
                  { id: "critical" as const, label: "Critical" },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={
                    "command-center__severity-btn" + (severity === s.id ? " command-center__severity-btn--active" : "")
                  }
                  aria-pressed={severity === s.id}
                  onClick={() => setSeverity(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="command-center__target-row" role="group" aria-label="Broadcast target (toggle each app on or off)">
            <button
              type="button"
              className={
                "command-center__btn command-center__btn--target" + (toPassenger ? " command-center__btn--target-active" : "")
              }
              onClick={() => setToPassenger((v) => !v)}
              aria-pressed={toPassenger}
            >
              Passenger App
            </button>
            <button
              type="button"
              className={
                "command-center__btn command-center__btn--target" + (toAttendant ? " command-center__btn--target-active" : "")
              }
              onClick={() => setToAttendant((v) => !v)}
              aria-pressed={toAttendant}
            >
              Bus Attendant App
            </button>
          </div>
          <p className="command-center__hint command-center__hint--tight" style={{ marginTop: "0.35rem", textAlign: "center" }}>
            Turn on one or both — the same message is sent to every selected app.
          </p>
          <textarea
            className="command-center__textarea command-center__textarea--terminal"
            rows={4}
            value={broadcast}
            onChange={(e) => setBroadcast(e.target.value)}
            placeholder="e.g. Route 12 delayed 15 minutes due to weather in Valencia…"
            maxLength={2000}
          />
          <div className="command-center__row">
            <span className="command-center__meta">Target: {targetSummary(toPassenger, toAttendant)}</span>
            <div className="command-center__btn-row">
              <button
                type="button"
                className="command-center__btn command-center__btn--primary"
                onClick={() => void sendBroadcast()}
                disabled={sending || (!toPassenger && !toAttendant)}
              >
                {sending ? "Sending…" : `Send to ${targetSummary(toPassenger, toAttendant)}`}
              </button>
            </div>
          </div>
        </section>
        </div>
      </CommandCenterSubPageShell>
    </div>
  );
}
