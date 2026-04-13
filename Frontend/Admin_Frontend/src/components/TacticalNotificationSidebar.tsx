import { useNavigate } from "react-router-dom";
import { useSosInterceptOptional } from "@/context/SosInterceptContext";
import { useTacticalNotifications } from "@/context/TacticalNotificationContext";
import type { TacticalFeedItem, TacticalVisualKind } from "@/context/TacticalNotificationContext";
import { tacticalMapFlyTo } from "@/lib/tacticalMapFlyTo";
import "./SosCriticalOverlay.css";
import "./TacticalNotificationSidebar.css";

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function kindMeta(kind: TacticalVisualKind): { emoji: string; tag: string; cardClass: string } {
  switch (kind) {
    case "sos":
      return { emoji: "🚨", tag: "SOS ALERT", cardClass: "tactical-side__card--sos" };
    case "geofence":
      return { emoji: "🟢", tag: "GEOFENCE", cardClass: "tactical-side__card--geo" };
    case "system":
      return { emoji: "🔵", tag: "SYSTEM SYNC", cardClass: "tactical-side__card--sys" };
    case "maintenance":
      return { emoji: "🟠", tag: "MAINTENANCE", cardClass: "tactical-side__card--maint" };
    case "lost":
      return { emoji: "🧳", tag: "LOST & FOUND", cardClass: "tactical-side__card--maint" };
    default:
      return { emoji: "•", tag: "ALERT", cardClass: "" };
  }
}

function FeedTile({
  item,
  onFly,
  onDismiss,
  onBroadcast,
}: {
  item: TacticalFeedItem;
  onFly: () => void;
  onDismiss: () => void;
  onBroadcast: (busId?: string) => void;
}) {
  const m = kindMeta(item.kind);
  const canTrack = item.latitude != null && item.longitude != null;

  return (
    <article
      className={"tactical-side__card " + m.cardClass}
      data-kind={item.kind}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (canTrack) onFly();
      }}
    >
      <div className="tactical-side__card-head">
        <span className="tactical-side__emoji" aria-hidden>
          {m.emoji}
        </span>
        <div className="tactical-side__card-titles">
          <span className="tactical-side__tag">{m.tag}</span>
          <h3 className="tactical-side__card-title">{item.title}</h3>
        </div>
      </div>
      <p className="tactical-side__card-sub">{item.subtitle}</p>
      <div className="tactical-side__mono-block">
        {item.busId ? (
          <div>
            <span className="tactical-side__mono-label">BUS</span>{" "}
            <span className="tactical-side__mono">{item.busId}</span>
          </div>
        ) : null}
        <div>
          <span className="tactical-side__mono-label">TS</span>{" "}
          <span className="tactical-side__mono">{formatTs(item.createdAt)}</span>
        </div>
        {canTrack ? (
          <div>
            <span className="tactical-side__mono-label">LL</span>{" "}
            <span className="tactical-side__mono">
              {item.latitude!.toFixed(5)}, {item.longitude!.toFixed(5)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="tactical-side__actions">
        <button
          type="button"
          className="tactical-side__btn tactical-side__btn--track"
          disabled={!canTrack}
          onClick={onFly}
        >
          Track bus
        </button>
        <button type="button" className="tactical-side__btn tactical-side__btn--bc" onClick={() => onBroadcast(item.busId)}>
          Broadcast
        </button>
        {item.dismissable ? (
          <button type="button" className="tactical-side__btn tactical-side__btn--dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function TacticalNotificationSidebar() {
  const navigate = useNavigate();
  const { sidebarOpen, setSidebarOpen, items, dismiss, flyToItem } = useTacticalNotifications();
  const sos = useSosInterceptOptional();

  const goBroadcast = (busId?: string, sosPrefix?: boolean) => {
    const hint = sosPrefix && busId ? `SOS coordination — Bus ${busId}: ` : busId ? `Ops notice — Bus ${busId}: ` : "";
    try {
      if (hint) localStorage.setItem("command_center_broadcast_draft", hint);
    } catch {
      /* ignore */
    }
    navigate("/dashboard/command/broadcast", { state: { tacticalBroadcastHint: hint } });
    setSidebarOpen(false);
  };

  const trackAndMap = (lat: number, lng: number, zoom: number) => {
    tacticalMapFlyTo(lat, lng, zoom);
    navigate("/dashboard/locations");
    setSidebarOpen(false);
  };

  const incident = sos?.activeIncident;
  const la = incident != null ? (sos?.liveLat ?? incident.latitude) : null;
  const ln = incident != null ? (sos?.liveLng ?? incident.longitude) : null;

  return (
    <>
      <div
        className={"tactical-side__backdrop" + (sidebarOpen ? " tactical-side__backdrop--on" : "")}
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        className={"tactical-side" + (sidebarOpen ? " tactical-side--open" : "")}
        aria-label="Tactical notification hub"
        aria-hidden={!sidebarOpen}
      >
        <div className="tactical-side__header">
          <h2 className="tactical-side__h2">Tactical feed</h2>
          <button type="button" className="tactical-side__close" onClick={() => setSidebarOpen(false)} aria-label="Close feed">
            ×
          </button>
        </div>
        <div className="tactical-side__scroll">
          {incident && la != null && ln != null ? (
            <article
              className="tactical-side__card tactical-side__card--sos tactical-side__card--pulse tactical-side__sos-article"
              data-kind="sos"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                trackAndMap(la, ln, 16);
              }}
            >
              <div className="sos-banner__main tactical-side__sos-banner-main">
                <span className="sos-banner__pulse-dot" aria-hidden />
                <p className="sos-banner__critical">
                  CRITICAL SOS: {incident.busId} — {incident.driverName}
                </p>
              </div>
              <div className="sos-banner__meta tactical-side__sos-meta">
                <span>PLATE {incident.plateNumber}</span>
                <span>
                  ATT{" "}
                  {incident.attendantEmail != null && String(incident.attendantEmail).trim()
                    ? String(incident.attendantEmail).trim()
                    : incident.attendantName}
                </span>
                <span>
                  GPS {la.toFixed(6)}, {ln.toFixed(6)}
                </span>
              </div>
              <p className="tactical-side__sos-ts">Reported {formatTs(incident.createdAt)}</p>
              <div className="sos-banner__actions tactical-side__sos-actions">
                <button
                  type="button"
                  className="sos-banner__btn sos-banner__btn--mute"
                  onClick={() => sos?.setMuted(!sos.muted)}
                >
                  {sos?.muted ? "Unmute ping" : "Mute ping"}
                </button>
                <button type="button" className="sos-banner__btn sos-banner__btn--resolve" onClick={() => sos?.openResolveModal()}>
                  Resolve incident…
                </button>
              </div>
              <div className="tactical-side__actions tactical-side__actions--sos-secondary">
                <button type="button" className="tactical-side__btn tactical-side__btn--track" onClick={() => trackAndMap(la, ln, 16)}>
                  Track on map
                </button>
                <button
                  type="button"
                  className="tactical-side__btn tactical-side__btn--bc"
                  onClick={() => goBroadcast(incident.busId, true)}
                >
                  Broadcast
                </button>
              </div>
            </article>
          ) : null}

          {items.length === 0 && !incident ? (
            <p className="tactical-side__empty">No queued alerts. Geofence breaches and attendant reports appear here.</p>
          ) : null}

          {items.map((item) => (
            <FeedTile
              key={item.id}
              item={item}
              onFly={() => {
                flyToItem(item);
                navigate("/dashboard/locations");
                setSidebarOpen(false);
              }}
              onDismiss={() => dismiss(item.id)}
              onBroadcast={(busId) => goBroadcast(busId)}
            />
          ))}
        </div>
      </aside>
    </>
  );
}
