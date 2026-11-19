import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import "@/pages/CommandCenterPage.css";
import "./GpsSourceStatusPanel.css";

type ArbiterSource = "phone" | "lilygo" | "lilygo_sms";
type SourceStatus = "ACTIVE" | "STALE" | "FALLBACK" | "RECOVERING" | "NO_SIGNAL";

type SwitchEvent = { from: ArbiterSource | null; to: ArbiterSource; reason: string; at: string };

type BusSourceRow = {
  busId: string;
  activeSource: ArbiterSource | null;
  activeSourceLabel: string | null;
  status: SourceStatus;
  lastPublishedFixAt?: string | null;
  msSinceLastPublished?: number | null;
  phoneRecovery?: { count: number; required: number };
  perSource?: Record<ArbiterSource, { lastValidFixAt: string | null; msSinceLastValid: number | null }>;
  lastSwitch: SwitchEvent | null;
};

type GatewayStatus = {
  state:
    | "OPERATIONAL"
    | "NOT_CONFIGURED"
    | "DISABLED"
    | "DISCONNECTED"
    | "NO_HEARTBEAT"
    | "NOT_REGISTERED"
    | "SMS_NOT_READY";
  operational: boolean;
  disabledReason: string | null;
  portOpen: boolean;
  msSinceLastHeartbeat: number | null;
  heartbeat: { registered: boolean; smsReady: boolean; rssiDbm: number | null } | null;
  lastSmsAcceptedAt: string | null;
  lastRejectAt: string | null;
  lastRejectReason: string | null;
  counts: { accepted: number; rejected: number; duplicates: number };
};

type StatusResponse = { generatedAt: string; buses: BusSourceRow[]; smsGateway: GatewayStatus };

const SOURCE_SHORT: Record<ArbiterSource, string> = {
  phone: "Attendant phone",
  lilygo: "LILYGO data",
  lilygo_sms: "LILYGO SMS",
};

const STATUS_LABEL: Record<SourceStatus, string> = {
  ACTIVE: "🟢 Active",
  FALLBACK: "🟠 Fallback",
  RECOVERING: "🔵 Recovering",
  STALE: "🔴 Stale",
  NO_SIGNAL: "⚪ No signal",
};

const GATEWAY_LABEL: Record<GatewayStatus["state"], string> = {
  OPERATIONAL: "🟢 Operational",
  NOT_CONFIGURED: "⚪ Not configured on this server",
  DISABLED: "⚪ Receiver disabled",
  DISCONNECTED: "🔴 Disconnected (serial port closed)",
  NO_HEARTBEAT: "🟠 Port open, no heartbeat from gateway",
  NOT_REGISTERED: "🔴 Gateway SIM not registered",
  SMS_NOT_READY: "🟠 Gateway SMS mode not ready",
};

function ago(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function agoIso(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? ago(nowMs - t) : "—";
}

/**
 * Live GPS source arbitration status from GET /api/buses/gps-source-status — which source is
 * currently driving each bus's map position, Active/Stale/Fallback/Recovering, per-source freshness,
 * the last switch event, and the SMS gateway's real connection state. Pass busId to show one bus.
 */
export function GpsSourceStatusPanel({ busId, pollMs = 3000 }: { busId?: string; pollMs?: number }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const r = await api<StatusResponse>("/api/buses/gps-source-status");
        if (!cancelled) {
          setData(r);
          setErr(null);
          setNowMs(Date.now());
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load GPS source status.");
      } finally {
        inFlight = false;
      }
    };
    void load();
    const id = window.setInterval(() => void load(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollMs]);

  const rows = (data?.buses ?? []).filter((b) => (busId ? b.busId === busId : true));
  const gw = data?.smsGateway;

  return (
    <section className="command-center__card command-center__card--glass gps-src" aria-label="GPS source status">
      <h2 className="command-center__h2">GPS source status{busId ? ` — ${busId}` : ""}</h2>

      {gw ? (
        <p className="gps-src__gateway">
          <span className="gps-src__gateway-label">SMS gateway:</span> <strong>{GATEWAY_LABEL[gw.state]}</strong>
          {gw.heartbeat?.rssiDbm != null ? <> · signal {gw.heartbeat.rssiDbm} dBm</> : null}
          {gw.msSinceLastHeartbeat != null ? <> · heartbeat {ago(gw.msSinceLastHeartbeat)}</> : null}
          {" · "}SMS accepted {gw.counts.accepted}, rejected {gw.counts.rejected}, duplicates {gw.counts.duplicates}
          {gw.lastRejectReason ? (
            <>
              {" "}· last reject: {gw.lastRejectReason.replace(/_/g, " ")} ({agoIso(gw.lastRejectAt, nowMs)})
            </>
          ) : null}
        </p>
      ) : null}

      {err ? <p className="gps-src__empty">{err}</p> : null}
      {!err && data && rows.length === 0 ? <p className="gps-src__empty">No buses found.</p> : null}

      {rows.length > 0 ? (
        <div className="gps-src__table-wrap">
          <table className="gps-src__table">
            <thead>
              <tr>
                {busId ? null : <th>Bus</th>}
                <th>Active source</th>
                <th>Status</th>
                <th>Last valid update</th>
                <th>Phone</th>
                <th>LILYGO data</th>
                <th>LILYGO SMS</th>
                <th>Last switch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.busId}>
                  {busId ? null : <td className="gps-src__bus">{b.busId}</td>}
                  <td>{b.activeSourceLabel ?? "—"}</td>
                  <td>
                    <span className={`gps-src__badge gps-src__badge--${b.status.toLowerCase()}`}>
                      {STATUS_LABEL[b.status]}
                    </span>
                    {b.status === "RECOVERING" && b.phoneRecovery ? (
                      <span className="gps-src__sub">
                        phone {b.phoneRecovery.count}/{b.phoneRecovery.required}
                      </span>
                    ) : null}
                  </td>
                  <td>{ago(b.msSinceLastPublished)}</td>
                  {(["phone", "lilygo", "lilygo_sms"] as ArbiterSource[]).map((src) => (
                    <td key={src}>{ago(b.perSource?.[src]?.msSinceLastValid)}</td>
                  ))}
                  <td>
                    {b.lastSwitch ? (
                      <>
                        {b.lastSwitch.from ? SOURCE_SHORT[b.lastSwitch.from] : "—"} → {SOURCE_SHORT[b.lastSwitch.to]}
                        <span className="gps-src__sub">
                          {agoIso(b.lastSwitch.at, nowMs)} · {b.lastSwitch.reason}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="gps-src__note">
        Times are since the server last accepted a valid, fresh fix from that source. Source state resets when the
        server restarts.
      </p>
    </section>
  );
}
