import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import "@/pages/CommandCenterPage.css";
import "./ApiHealthTable.css";

type ApiMetricRow = {
  method: string;
  path: string;
  count: number;
  avgMs: number;
  errorCount: number;
  lastStatus: number | null;
  lastAt: string | null;
};

function rowTone(row: ApiMetricRow): "ok" | "warn" | "bad" {
  if (row.errorCount > 0) return "bad";
  if (row.avgMs >= 1500) return "bad";
  if (row.avgMs >= 800) return "warn";
  return "ok";
}

function toneLabel(tone: "ok" | "warn" | "bad", row: ApiMetricRow): string {
  if (tone === "bad") return row.errorCount > 0 ? "Failing" : "Critical";
  if (tone === "warn") return "Slow";
  return "Healthy";
}

function EndpointRow({ row }: { row: ApiMetricRow }) {
  const tone = rowTone(row);
  return (
    <tr className={"api-health__row api-health__row--" + tone}>
      <td>
        <span className={"api-health__dot api-health__dot--" + tone} title={toneLabel(tone, row)} />
        <span className="api-health__method">{row.method}</span> {row.path}
      </td>
      <td>{row.count}</td>
      <td>{row.avgMs} ms</td>
      <td>{row.errorCount}</td>
      <td>{row.lastStatus ?? "—"}</td>
    </tr>
  );
}

/** Real measured request counts / average latency / error counts per route, since this
 * process started — nothing here is simulated; a route with no traffic just isn't listed yet. */
export function ApiHealthTable() {
  const [rows, setRows] = useState<ApiMetricRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showHealthy, setShowHealthy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api<{ items: ApiMetricRow[] }>("/api/admin/api-metrics");
        if (!cancelled) {
          setRows(r.items ?? []);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load API metrics.");
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const needsAttention = rows.filter((r) => rowTone(r) !== "ok").sort((a, b) => {
    const aBad = rowTone(a) === "bad" ? 0 : 1;
    const bBad = rowTone(b) === "bad" ? 0 : 1;
    if (aBad !== bBad) return aBad - bBad;
    return b.avgMs - a.avgMs;
  });
  const healthy = rows.filter((r) => rowTone(r) === "ok");
  const failingCount = rows.filter((r) => rowTone(r) === "bad").length;
  const slowCount = rows.filter((r) => rowTone(r) === "warn").length;

  return (
    <section className="command-center__card command-center__card--glass" aria-label="API endpoint health">
      <h2 className="command-center__h2">API endpoint health</h2>
      {err ? <p className="api-health__empty">{err}</p> : null}
      {!err && rows.length === 0 ? (
        <p className="api-health__empty">No requests observed yet this session — this fills in as traffic flows through the API.</p>
      ) : null}
      {!err && rows.length > 0 ? (
        <>
          <p className="api-health__summary">
            {rows.length} monitored ·{" "}
            <span className="api-health__summary-ok">{healthy.length} healthy</span> ·{" "}
            <span className="api-health__summary-warn">{slowCount} slow</span> ·{" "}
            <span className="api-health__summary-bad">{failingCount} failing</span>
          </p>

          {needsAttention.length > 0 ? (
            <div className="api-health__wrap">
              <table className="api-health__table">
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Requests</th>
                    <th>Avg response</th>
                    <th>Errors</th>
                    <th>Last status</th>
                  </tr>
                </thead>
                <tbody>
                  {needsAttention.map((r) => (
                    <EndpointRow key={`${r.method} ${r.path}`} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="api-health__empty">No slow or failing endpoints right now.</p>
          )}

          {healthy.length > 0 ? (
            <>
              <button
                type="button"
                className="api-health__toggle"
                onClick={() => setShowHealthy((v) => !v)}
                aria-expanded={showHealthy}
              >
                {showHealthy ? "Hide" : "Show"} {healthy.length} healthy endpoint{healthy.length === 1 ? "" : "s"}
              </button>
              {showHealthy ? (
                <div className="api-health__wrap">
                  <table className="api-health__table">
                    <thead>
                      <tr>
                        <th>Endpoint</th>
                        <th>Requests</th>
                        <th>Avg response</th>
                        <th>Errors</th>
                        <th>Last status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {healthy.map((r) => (
                        <EndpointRow key={`${r.method} ${r.path}`} row={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
