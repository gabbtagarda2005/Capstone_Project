import { useEffect, useState } from "react";
import { fetchTrafficDiagnostics, type TrafficDiagnosticsDto } from "@/lib/api";
import "@/pages/CommandCenterPage.css";
import "./TrafficProviderCard.css";

function formatAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return new Date(iso).toLocaleString();
}

/** Real, measured OSRM/congestion-engine health — see services/congestionEngine.js and
 * services/osrmTrafficService.js. Nothing here is simulated; "requests: 0" genuinely means no
 * traffic/ETA computation has run yet this process. */
export function TrafficProviderCard() {
  const [data, setData] = useState<TrafficDiagnosticsDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetchTrafficDiagnostics();
        if (!cancelled) {
          setData(r);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load traffic diagnostics.");
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const provider = data?.trafficProvider;
  const tone: "ok" | "warn" | "bad" | "unknown" = !provider
    ? "unknown"
    : !provider.enabled
      ? "bad"
      : provider.online == null
        ? "unknown"
        : provider.online
          ? "ok"
          : "bad";
  const label = !provider
    ? "Loading…"
    : !provider.enabled
      ? "Disabled"
      : provider.online == null
        ? "No requests yet"
        : provider.online
          ? "Online"
          : "Offline";

  return (
    <section className="command-center__card command-center__card--glass" aria-label="Traffic provider health">
      <h2 className="command-center__h2">Traffic provider</h2>
      {err ? <p className="api-health__empty">{err}</p> : null}
      {!err && provider ? (
        <>
          <p className="traffic-provider__status">
            <span className={`traffic-provider__dot traffic-provider__dot--${tone}`} />
            <strong>{label}</strong>
            <span className="traffic-provider__host">{provider.host}</span>
          </p>
          <dl className="traffic-provider__grid">
            <div>
              <dt>Requests</dt>
              <dd>{provider.requests}</dd>
            </div>
            <div>
              <dt>Failures</dt>
              <dd>{provider.failures}</dd>
            </div>
            <div>
              <dt>Avg response</dt>
              <dd>{provider.avgResponseMs != null ? `${provider.avgResponseMs} ms` : "—"}</dd>
            </div>
            <div>
              <dt>Active buses</dt>
              <dd>{data?.activeBuses ?? "—"}</dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>{formatAgo(provider.lastSuccessAt)}</dd>
            </div>
            <div>
              <dt>Last failure</dt>
              <dd title={provider.lastFailureReason ?? undefined}>{formatAgo(provider.lastFailureAt)}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </section>
  );
}
