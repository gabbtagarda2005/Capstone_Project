import { useEffect, useMemo, useState } from "react";
import { MgmtBackLink } from "@/components/MgmtBackLink";
import { fetchFleetHardwareStatus } from "@/lib/api";
import type { FleetHardwareStatusRow } from "@/lib/types";
import { COMMAND_CENTER_HUB } from "@/pages/commandCenterPaths";
import "./CommandCenterFleetSensorsPage.css";

function fmtLastSeen(s: number | null): string {
  if (s == null) return "Never";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s ago`;
}

function voltagePct(v: number | null): number {
  if (v == null || !Number.isFinite(v)) return 0;
  const p = ((v - 4.3) / (5.2 - 4.3)) * 100;
  return Math.max(0, Math.min(100, p));
}

function signalPct(dbm: number | null): number {
  if (dbm == null || !Number.isFinite(dbm)) return 0;
  const p = ((dbm - -125) / (-75 - -125)) * 100;
  return Math.max(0, Math.min(100, p));
}

export function CommandCenterFleetSensorsPage() {
  const [rows, setRows] = useState<FleetHardwareStatusRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    let dead = false;
    const run = async () => {
      try {
        const r = await fetchFleetHardwareStatus();
        if (dead) return;
        setRows(r.items ?? []);
        setErr(null);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : "Failed to read hardware status");
      }
    };
    void run();
    const t = window.setInterval(() => void run(), 5000);
    const tick = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => {
      dead = true;
      window.clearInterval(t);
      window.clearInterval(tick);
    };
  }, []);

  const summary = useMemo(() => {
    const hw = rows.filter((r) => String(r.source).toLowerCase() === "hardware");
    const wifi = hw.filter((r) => r.activeLink === "wifi").length;
    const lte = hw.filter((r) => r.activeLink === "lte").length;
    const alerts = rows.filter((r) => r.alertRedPulse).length;
    return { wifi, lte, alerts, staffGps: rows.filter((r) => r.activeLink === "staff").length };
  }, [rows, nowTick]);

  return (
    <div className="fleet-sensors">
      <header className="fleet-sensors__hero">
        <MgmtBackLink to={COMMAND_CENTER_HUB} label="Command center" className="fleet-sensors__mgmt-back" />
        <h1>FLEET SENSORS</h1>
        <p>Hardware pulse monitor for LILYGO T-A7670E units</p>
      </header>

      {err ? <p className="fleet-sensors__err">{err}</p> : null}

      <section className="fleet-sensors__kpis">
        <div className="fleet-sensors__kpi">
          <span>Wi‑Fi links</span>
          <strong>{summary.wifi}</strong>
          <small className="fleet-sensors__kpi-sub">LILYGO hardware reporting Wi‑Fi</small>
        </div>
        <div className="fleet-sensors__kpi">
          <span>LTE links</span>
          <strong>{summary.lte}</strong>
          <small className="fleet-sensors__kpi-sub">Hardware on cellular / inferred uplink</small>
        </div>
        <div className="fleet-sensors__kpi">
          <span>Attendant GPS</span>
          <strong>{summary.staffGps}</strong>
          <small className="fleet-sensors__kpi-sub">Live via attendant app (not LILYGO)</small>
        </div>
        <div className={"fleet-sensors__kpi" + (summary.alerts > 0 ? " fleet-sensors__kpi--alert" : "")}>
          <span>Critical alerts</span>
          <strong>{summary.alerts}</strong>
          <small className="fleet-sensors__kpi-sub">Weak LTE or low battery</small>
        </div>
      </section>

      <section className="fleet-sensors__table-wrap">
        <table className="fleet-sensors__table">
          <thead>
            <tr>
              <th>Bus</th>
              <th>Active Link</th>
              <th>Battery Voltage</th>
              <th>LTE Signal (dBm)</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const vp = voltagePct(r.voltage);
              const sp = signalPct(r.signalStrengthDbm);
              const linkLabel =
                r.activeLink === "wifi"
                  ? "Wi‑Fi"
                  : r.activeLink === "lte"
                    ? r.uplinkInferred
                      ? "LTE / SIM (inferred)"
                      : "LTE / SIM"
                    : r.activeLink === "staff"
                      ? "Attendant app"
                      : "Uplink unknown";
              const linkClass =
                r.activeLink === "wifi"
                  ? "fleet-sensors__link--wifi"
                  : r.activeLink === "lte"
                    ? "fleet-sensors__link--lte"
                    : r.activeLink === "staff"
                      ? "fleet-sensors__link--staff"
                      : "fleet-sensors__link--down";
              const rowClass = r.alertRedPulse ? " fleet-sensors__row--alert" : "";
              return (
                <tr key={r.busId} className={rowClass}>
                  <td>
                    <div className="fleet-sensors__bus">
                      <strong>{r.busNumber || r.busId}</strong>
                      <span>{r.route || "—"}</span>
                    </div>
                  </td>
                  <td>
                    <span className={"fleet-sensors__link " + linkClass}>{linkLabel}</span>
                  </td>
                  <td>
                    <div className="fleet-sensors__gauge-cell">
                      <div
                        className="fleet-sensors__gauge"
                        style={{ background: `conic-gradient(#22d3ee ${vp}%, rgba(30,41,59,0.9) ${vp}% 100%)` }}
                        title={`${r.voltage?.toFixed(2) ?? "—"}V`}
                      >
                        <span>{r.voltage != null ? `${r.voltage.toFixed(2)}V` : "—"}</span>
                      </div>
                      <small className={"fleet-sensors__badge fleet-sensors__badge--" + r.voltageLevel}>{r.voltageLabel}</small>
                    </div>
                  </td>
                  <td>
                    <div className="fleet-sensors__bars-cell">
                      <div className="fleet-sensors__bars" title={r.signalStrengthDbm != null ? `${r.signalStrengthDbm} dBm` : "No data"}>
                        {Array.from({ length: 8 }).map((_, i) => {
                          const on = sp >= ((i + 1) / 8) * 100;
                          return <span key={i} className={on ? "on" : ""} />;
                        })}
                      </div>
                      <small className={"fleet-sensors__badge fleet-sensors__badge--" + r.signalLevel}>
                        {r.activeLink === "staff" && r.attendantSignalTier
                          ? `${String(r.attendantSignalTier)} (app est.)`
                          : r.signalStrengthDbm != null
                            ? `${r.signalStrengthDbm} dBm`
                            : "—"}{" "}
                        · {r.signalLabel}
                      </small>
                    </div>
                  </td>
                  <td>
                    <span className="fleet-sensors__mono">{fmtLastSeen(r.staleSeconds)}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="fleet-sensors__empty">
                  No hardware telemetry yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

