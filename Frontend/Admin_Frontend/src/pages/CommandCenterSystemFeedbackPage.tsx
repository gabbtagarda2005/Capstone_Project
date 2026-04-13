import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CommandCenterSubPageShell } from "@/components/CommandCenterSubPageShell";
import { FeedbackHotspotMap } from "@/components/FeedbackHotspotMap";
import { FleetSatisfactionRing } from "@/components/FleetSatisfactionRing";
import { fetchPassengerFeedbackDashboard } from "@/lib/api";
import type {
  PassengerFeedbackAbout,
  PassengerFeedbackDashboardDto,
  PassengerFeedbackIntelRow,
} from "@/lib/types";
import "./CommandCenterPage.css";
import "./CommandCenterSentimentPage.css";

const POLL_MS = 35_000;

const FEEDBACK_ABOUT_LABELS: Record<PassengerFeedbackAbout, string> = {
  bus: "Bus",
  driver: "Driver",
  attendant: "Attendant",
  location: "Location / route",
};

type AboutFilter = "all" | PassengerFeedbackAbout;

function sanitizeFeedbackLoadError(raw: string): string {
  const t = raw.trim();
  if (/endpoint not found/i.test(t)) {
    return "Passenger feedback is not available on this server. Run the latest Admin_Backend with MongoDB, then refresh.";
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(t)) {
    return "Offline — start Admin_Backend, set VITE_ADMIN_API_URL to match its URL, then refresh.";
  }
  if (/operator-forgot-password|attendant recovery|could not reach the admin api/i.test(t)) {
    return "Offline — start Admin_Backend, set VITE_ADMIN_API_URL to match its URL, then refresh.";
  }
  return t;
}

function isMongoObjectId(id: string): boolean {
  return /^[a-f\d]{24}$/i.test(id.trim());
}

function formatIntelTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StarRow({ rating }: { rating: number }) {
  const tier = rating >= 4 ? "high" : rating <= 2 ? "low" : "mid";
  return (
    <div className={`sfi-tile__stars sfi-tile__stars--${tier}`} aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? "sfi-tile__star--on" : "sfi-tile__star--off"}>
          ★
        </span>
      ))}
    </div>
  );
}

function FeedbackIntelTile({ row, variant }: { row: PassengerFeedbackIntelRow; variant: "critical" | "feed" }) {
  const driverLink = row.driverId && isMongoObjectId(row.driverId) ? `/dashboard/management/drivers/${row.driverId}` : null;
  const about = (row.feedbackAbout ?? "location") as PassengerFeedbackAbout;
  const isLost = row.entryKind === "lost_item";

  const staffLabel = [row.driverName, row.attendantName].filter(Boolean).join(" · ") || "Staff —";

  const tileClass =
    "sfi-tile" +
    (variant === "critical"
      ? " sfi-tile--critical"
      : !isLost && (row.rating < 3 || row.isSos)
        ? " sfi-tile--low"
        : "");

  return (
    <article className={tileClass}>
      <div className="sfi-tile__head">
        <h3 className="sfi-tile__name">
          {row.passengerName}
          {isLost ? (
            <>
              {" "}
              <span className="sfi-tile__lost-badge" title="Lost & found report from passenger web">
                LOST
              </span>
            </>
          ) : null}
          {row.isSos ? (
            <span className="sfi-tile__sos" title="Passenger flagged SOS">
              SOS
            </span>
          ) : null}
        </h3>
        {isLost ? (
          <span className="sfi-tile__lost-stars" title="Not a star rating">
            Left something?
          </span>
        ) : (
          <StarRow rating={row.rating} />
        )}
      </div>
      <p className="sfi-tile__about" title="What this feedback is mainly about">
        {isLost ? "Lost item / registry" : FEEDBACK_ABOUT_LABELS[about]}
      </p>
      {row.comment ? <p className="sfi-tile__comment">{row.comment}</p> : null}
      <div className="sfi-tile__meta">
        {driverLink ? (
          <Link to={driverLink} className="sfi-tile__pill">
            {staffLabel}
          </Link>
        ) : (
          <span className="sfi-tile__pill" title="Driver / attendant on duty">
            {staffLabel}
          </span>
        )}
        <span title="Driver ID">
          <strong>DRV</strong> {row.driverId || "—"}
        </span>
        <span title="Bus plate">
          <strong>BUS</strong> {row.busPlate || "—"}
        </span>
        <span className="sfi-tile__route" title="Corridor / route">
          <strong>RTE</strong> {row.routeName || "—"}
        </span>
        <time className="sfi-tile__time" dateTime={row.createdAt ?? undefined}>
          {formatIntelTime(row.createdAt)}
        </time>
      </div>
    </article>
  );
}

export function CommandCenterSystemFeedbackPage() {
  const [data, setData] = useState<PassengerFeedbackDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aboutFilter, setAboutFilter] = useState<AboutFilter>("all");

  const load = useCallback(async () => {
    try {
      const d = await fetchPassengerFeedbackDashboard();
      setData(d);
      setError(null);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Failed to load passenger feedback";
      setError(sanitizeFeedbackLoadError(raw));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const filteredFeed = useMemo(() => {
    const rows = data?.liveSignalFeed ?? [];
    if (aboutFilter === "all") return rows;
    return rows.filter((r) => (r.feedbackAbout ?? "location") === aboutFilter);
  }, [data?.liveSignalFeed, aboutFilter]);

  const aboutButtons: { id: AboutFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "bus", label: "Bus" },
    { id: "driver", label: "Driver" },
    { id: "attendant", label: "Attendant" },
    { id: "location", label: "Location" },
  ];

  return (
    <div className="command-center command-center--tactical command-center--sub command-center--crumbs-left command-center--feedback-intel-full">
      <CommandCenterSubPageShell page="feedback">
        <header className="command-center__sub-head">
          <h1 className="command-center__sub-title">Feedback intelligence</h1>
          <p className="command-center__sub-lead">
            Passenger ratings, comments, route context, and &quot;Left something?&quot; lost-item reports from the web app.
          </p>
        </header>

        <div className="sentiment-cmd">
        <div className={"sentiment-cmd__banner" + (error ? " sentiment-cmd__banner--err" : "")}>
          <span>
            {loading && !data
              ? "Loading passenger feedback…"
              : error
                ? error
                : `${data?.totalSamples ?? 0} passenger ratings · updated ${data ? new Date(data.updatedAt).toLocaleTimeString() : "—"}`}
          </span>
        </div>

        <div className="sentiment-cmd__grid-top">
          <div className="sentiment-cmd__ring-cell">
            <FleetSatisfactionRing positivePct={data?.overallPositivePct ?? 0} />
            <p className="sentiment-cmd__empty" style={{ marginTop: "0.65rem", textAlign: "center", border: "none", background: "transparent" }}>
              Fleet-wide share of 4–5★ ratings {data && data.totalSamples === 0 ? "(no samples yet)" : ""}
            </p>
          </div>

          <div className="sentiment-cmd__map-cell">
            <FeedbackHotspotMap hotspots={data?.routeHotspots ?? []} />
            <div className="sentiment-cmd__about-filter" role="group" aria-label="Filter live feedback by topic">
              <span className="sentiment-cmd__about-filter-label">Show in feed</span>
              <div className="sentiment-cmd__about-filter-btns">
                {aboutButtons.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={
                      "sentiment-cmd__about-btn" + (aboutFilter === b.id ? " sentiment-cmd__about-btn--active" : "")
                    }
                    onClick={() => setAboutFilter(b.id)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <section aria-labelledby="sentiment-feed-heading">
          <h2 id="sentiment-feed-heading" className="sentiment-cmd__section-title">
            Live feedback feed
          </h2>
          <div className="sentiment-cmd__feed-list">
            {(data?.liveSignalFeed ?? []).length === 0 && !loading ? (
              <p className="sentiment-cmd__empty">
                No passenger feedback yet. Trip feedback, lost-item reports (Left something?), and ratings will show here.
              </p>
            ) : null}
            {(data?.liveSignalFeed ?? []).length > 0 && filteredFeed.length === 0 && !loading ? (
              <p className="sentiment-cmd__empty">No feedback in this category. Try another filter or choose All.</p>
            ) : null}
            {filteredFeed.map((row) => (
              <FeedbackIntelTile key={row.id} row={row} variant="feed" />
            ))}
          </div>
        </section>
        </div>
      </CommandCenterSubPageShell>
    </div>
  );
}
