import { useEffect, useMemo, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { fetchPublicCommandFeed } from "@/lib/fetchPublicCommandFeed";
import { submitPassengerFeedback, type PassengerFeedbackAbout } from "@/lib/submitPassengerFeedback";
import "./PassengerTacticalPanels.css";

export type TacticalPanelId = "schedules" | "news" | "feedback";

const ADMIN_BASE = (import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4001").replace(/\/+$/, "");

type BoardStatus = "on-time" | "delayed" | "cancelled" | "arriving";

/** Normalized row — same semantics as admin Live fleet departures board */
type LiveBoardBlock = {
  id: string;
  busId: string;
  routeLabel: string;
  scheduledDeparture: string;
  status: BoardStatus;
  gate?: string;
  currentTerminalGate?: string;
  arrivalTerminalName?: string;
  arrivalLockedEta?: string;
  etaMinutes?: number;
  trackingLost?: boolean;
  trackingDegraded?: boolean;
};

type LiveBoardPayload = {
  items?: Array<Record<string, unknown>>;
  holidayBanner?: { holidayName: string; message: string; updatedAt: string } | null;
  manilaDate?: string;
};

function manilaYmdClient(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Display like "Apr 13, 2026, 12:00 AM" — always Asia/Manila. */
function formatManilaFeedTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function useNowInterval(intervalMs: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return t;
}

function tripDisplayId(orderIndex: number): string {
  return String(orderIndex + 1).padStart(3, "0");
}

function gateForRow(bl: LiveBoardBlock): string {
  const a = bl.arrivalTerminalName?.trim();
  const c = bl.currentTerminalGate?.trim();
  const g = bl.gate?.trim();
  return a || c || g || "—";
}

function etaForRow(bl: LiveBoardBlock): string {
  if (bl.trackingLost) {
    return bl.status === "arriving" ? "SIGNAL LOST" : "ESTIMATED";
  }
  if (bl.trackingDegraded && bl.status === "arriving") {
    return "ESTIMATED";
  }
  if (bl.status === "arriving" && bl.arrivalLockedEta?.trim()) {
    return bl.arrivalLockedEta.trim();
  }
  if (bl.status === "cancelled") return "—";
  if (Number.isFinite(bl.etaMinutes) && (bl.etaMinutes ?? 0) >= 0) return `${Math.max(0, Math.round(bl.etaMinutes ?? 0))} mins`;
  return "ESTIMATED";
}

function statusLabel(status: BoardStatus): { text: string; emoji: string; mod: string } {
  if (status === "arriving") return { text: "ARRIVED", emoji: "🟢", mod: "pd-board__status--arrived" };
  if (status === "delayed") return { text: "DELAYED", emoji: "🟠", mod: "pd-board__status--delayed" };
  if (status === "cancelled") return { text: "CANCELLED", emoji: "⚫", mod: "pd-board__status--cancelled" };
  return { text: "ON-TIME", emoji: "🟢", mod: "pd-board__status--ontime" };
}

function normalizeBoardStatus(raw: string): BoardStatus {
  if (raw === "delayed" || raw === "cancelled") return raw;
  if (raw === "arriving") return "arriving";
  return "on-time";
}

function mapPayloadItem(row: Record<string, unknown>): LiveBoardBlock | null {
  const id = String(row.id ?? "");
  if (!id) return null;
  const depTime = String(row.departureTime ?? "").trim();
  return {
    id,
    busId: String(row.busId ?? ""),
    routeLabel: String(row.route ?? ""),
    scheduledDeparture: depTime || "—",
    status: normalizeBoardStatus(String(row.status ?? "on-time")),
    gate: row.gate != null ? String(row.gate) : undefined,
    currentTerminalGate: row.currentTerminalGate != null ? String(row.currentTerminalGate) : undefined,
    arrivalTerminalName: row.arrivalTerminalName != null ? String(row.arrivalTerminalName) : undefined,
    arrivalLockedEta: row.arrivalLockedEta != null ? String(row.arrivalLockedEta) : undefined,
    etaMinutes:
      row.etaMinutes != null && Number.isFinite(Number(row.etaMinutes))
        ? Math.max(0, Math.round(Number(row.etaMinutes)))
        : undefined,
    trackingLost: row.trackingLost === true,
    trackingDegraded: row.trackingDegraded === true,
  };
}

const DEMO_BLOCKS: LiveBoardBlock[] = [
  {
    id: "demo-1",
    busId: "BT-104",
    routeLabel: "Valencia ➔ Malaybalay",
    scheduledDeparture: "06:42",
    status: "on-time",
    trackingLost: false,
  },
];

type NewsItem = {
  id: string;
  category: string;
  title: string;
  body: string;
  publishedAt: Date;
};

/** Operator / terminal posts — LIVE when very recent. */
const LIVE_TERMINAL_MS = 90 * 60 * 1000;
/** Weather snapshot — refreshed ~10 min; keep badge warm for half a day. */
const LIVE_WEATHER_MS = 30 * 60 * 60 * 1000;
/** Delay / GPS hints from live board. */
const LIVE_TRAFFIC_MS = 2 * 60 * 60 * 1000;
/** Ticket + affinity demand cards. */
const LIVE_DEMAND_MS = 36 * 60 * 60 * 1000;

function commandFeedItemIsLive(item: NewsItem, nowMs: number): boolean {
  const t = item.publishedAt.getTime();
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  if (age < 0) return false;
  if (item.category === "Terminal notice" || item.category === "Operations") return age < LIVE_TERMINAL_MS;
  if (item.category === "Traffic & delays") return age < LIVE_TRAFFIC_MS;
  if (item.category === "Passenger demand") return age < LIVE_DEMAND_MS;
  if (item.category === "Weather alert") return age < LIVE_WEATHER_MS;
  return age < LIVE_WEATHER_MS;
}

function liveBadgeTitle(category: string): string {
  if (category === "Terminal notice" || category === "Operations") return "Posted within the last 90 minutes";
  if (category === "Traffic & delays") return "Based on live dispatch in the last 2 hours";
  if (category === "Passenger demand") return "Demand signal from the last 36 hours";
  if (category === "Weather alert") return "Weather snapshot is recent (refreshed about every 10 minutes)";
  return "Active advisory";
}

export function PassengerDepartureBoard() {
  const [blocks, setBlocks] = useState<LiveBoardBlock[]>(DEMO_BLOCKS);
  const [holiday, setHoliday] = useState<LiveBoardPayload["holidayBanner"]>(null);
  const [manilaDate, setManilaDate] = useState<string>(() => manilaYmdClient());
  const [source, setSource] = useState<"demo" | "live">("demo");
  const [socketConnected, setSocketConnected] = useState(false);

  useEffect(() => {
    const tick = window.setInterval(() => setManilaDate(manilaYmdClient()), 60_000);
    return () => window.clearInterval(tick);
  }, []);

  const sortedRows = useMemo(() => {
    return [...blocks].sort((a, b) => {
      const ba = a.busId.localeCompare(b.busId);
      if (ba !== 0) return ba;
      return a.scheduledDeparture.localeCompare(b.scheduledDeparture);
    });
  }, [blocks]);

  const displayDate = manilaDate || manilaYmdClient();

  useEffect(() => {
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;
    let socket: Socket | null = null;

    function applyPayload(payload: LiveBoardPayload) {
      if (cancelled) return;
      const items = payload.items;
      const mapped = Array.isArray(items)
        ? (items.map(mapPayloadItem).filter(Boolean) as LiveBoardBlock[])
        : [];
      setBlocks(mapped.length ? mapped : []);
      setHoliday(payload.holidayBanner ?? null);
      if (payload.manilaDate != null && String(payload.manilaDate).trim()) {
        setManilaDate(String(payload.manilaDate).trim().slice(0, 10));
      }
      setSource("live");
    }

    async function pull() {
      try {
        const r = await fetch(`${ADMIN_BASE}/api/public/live-board`, { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as LiveBoardPayload;
        applyPayload(j);
      } catch {
        /* keep demo / last snapshot */
      }
    }

    void pull();
    pollId = setInterval(() => void pull(), 45_000);

    try {
      socket = io(ADMIN_BASE, { path: "/socket.io/", transports: ["websocket", "polling"] });
      socket.on("connect", () => {
        setSocketConnected(true);
        socket?.emit("subscribe:liveBoard");
      });
      socket.on("disconnect", () => setSocketConnected(false));
      socket.on("liveBoardSnapshot", (payload: LiveBoardPayload) => applyPayload(payload));
    } catch {
      /* HTTP polling only */
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, []);

  return (
    <div className="pd-tactical pd-board" role="region" aria-label="Departure board">
      <header className="pd-tactical__head pd-board__mast">
        <div>
          <h1 className="pd-tactical__title">Live departures</h1>
          <p className="pd-tactical__sub">
            {source === "live" ? "Synced from operations · WebSocket + poll backup" : "Demo preview · connect admin dispatch"}
          </p>
        </div>
        <div className="pd-board__live" aria-live="polite">
          <span className={"pd-board__dot" + (socketConnected ? " pd-board__dot--on" : "")} aria-hidden />
          <span className="pd-board__live-label">{socketConnected ? "Live socket" : "Reconnecting…"}</span>
        </div>
      </header>
      {holiday ? (
        <div className="pd-board__holiday" role="status">
          <span className="pd-board__holiday-tag">{holiday.holidayName}</span>
          <p className="pd-board__holiday-msg">{holiday.message}</p>
        </div>
      ) : null}
      <div className="pd-board__wrap">
        <table className="pd-board__table pd-board__table--ops" aria-label="Live departures board">
          <thead>
            <tr>
              <th scope="col">TRP #</th>
              <th scope="col">ROUTE</th>
              <th scope="col">DATE</th>
              <th scope="col">ETA</th>
              <th scope="col">GATE</th>
              <th scope="col">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="pd-board__empty">
                  No published dispatches. Operations will appear here when trip blocks are active.
                </td>
              </tr>
            ) : (
              sortedRows.map((bl, idx) => {
                const st = statusLabel(bl.status);
                const eta = etaForRow(bl);
                const gate = gateForRow(bl);
                return (
                  <tr key={bl.id} className={"pd-board__row " + st.mod}>
                    <td className="pd-board__mono">{tripDisplayId(idx)}</td>
                    <td className="pd-board__route">{bl.routeLabel.replace(/\s*[–—-]\s*/g, " ➔ ")}</td>
                    <td className="pd-board__mono">{displayDate}</td>
                    <td className="pd-board__mono pd-board__eta-cell">{eta}</td>
                    <td className="pd-board__mono">{gate}</td>
                    <td>
                      <span className={"pd-board__status " + st.mod}>
                        {st.emoji} {st.text}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PassengerNewsFeed() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const nowMs = useNowInterval(30_000);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const raw = await fetchPublicCommandFeed();
      if (cancelled) return;
      const mapped: NewsItem[] = raw.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        body: r.body,
        publishedAt: new Date(r.publishedAt),
      }));
      setItems(mapped);
      setLoaded(true);
    }
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="pd-tactical pd-feed" role="region" aria-label="News and updates">
      <header className="pd-tactical__head">
        <h1 className="pd-tactical__title">Command feed</h1>
        <p className="pd-tactical__sub">
          Weather for every admin-defined hub and stop, trip delays, busy terminals, and operator messages · Philippines
          (PHT). Rain alerts remind you to bring an umbrella and allow extra time for buses.
        </p>
      </header>
      {!loaded ? (
        <p className="pd-feed__empty">Loading operational updates…</p>
      ) : items.length === 0 ? (
        <p className="pd-feed__empty">
          No advisories right now. After admins add locations, weather for each point appears here. When it rains, you will
          see umbrella and delay guidance; trip delays, busy terminals, and operations messages also show automatically.
        </p>
      ) : (
        <ol className="pd-feed__timeline">
          {items.map((item) => {
            const live = commandFeedItemIsLive(item, nowMs);
            const iso = Number.isFinite(item.publishedAt.getTime()) ? item.publishedAt.toISOString() : "";
            return (
              <li key={item.id} className="pd-feed__item">
                <span className="pd-feed__rail" aria-hidden />
                <article className="pd-feed__card">
                  <div className="pd-feed__card-head">
                    {live ? (
                      <span className="pd-feed__live" title={liveBadgeTitle(item.category)}>
                        <span className="pd-feed__live-dot" aria-hidden />
                        LIVE
                      </span>
                    ) : null}
                    <span className="pd-feed__category">{item.category}</span>
                  </div>
                  <h2 className="pd-feed__card-title">{item.title}</h2>
                  {item.body ? <p className="pd-feed__card-body">{item.body}</p> : null}
                  {iso ? (
                    <time className="pd-feed__time" dateTime={iso}>
                      {formatManilaFeedTime(item.publishedAt)}
                    </time>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function PassengerFeedbackConsole() {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [feedbackAbout, setFeedbackAbout] = useState<PassengerFeedbackAbout>("location");
  const [driverHint, setDriverHint] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (rating < 1) {
      setFormError("Select a star rating.");
      return;
    }
    if (rating < 4 && comment.trim().length < 4) {
      setFormError("Add a few words for ratings below 4 stars.");
      return;
    }

    const hint = driverHint.trim();
    if (feedbackAbout === "driver") {
      if (hint.length < 2) {
        setFormError("Add the driver's name as on the roster, or their 6-digit ID, so the report ties to the right person.");
        return;
      }
    }

    const isOid = /^[a-f0-9]{24}$/i.test(hint);
    const isSix = /^\d{6}$/.test(hint);

    setPending(true);
    try {
      await submitPassengerFeedback({
        passengerName: "Anonymous",
        rating,
        comment: comment.trim(),
        routeName: "",
        feedbackAbout,
        busPlate: "",
        driverId: feedbackAbout === "driver" && (isOid || isSix) ? hint : "",
        driverName: feedbackAbout === "driver" && !isOid && !isSix ? hint : "",
        attendantName: "",
      });
      setSent(true);
      setComment("");
      setRating(0);
      setFeedbackAbout("location");
      setDriverHint("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not send feedback.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pd-tactical pd-fb pd-tactical--centered" role="region" aria-label="Feedback">
      <form className="pd-fb-card pd-fb-card--lg" onSubmit={(ev) => void submit(ev)}>
        <h1 className="pd-fb-card__title">Send Feedback</h1>

        <label className="pd-fb-card__field-label" htmlFor="pd-fb-about">
          Mainly about
        </label>
        <select
          id="pd-fb-about"
          className="pd-fb-card__select"
          value={feedbackAbout}
          onChange={(e) => setFeedbackAbout(e.target.value as PassengerFeedbackAbout)}
        >
          <option value="location">Route, stop, or terminal</option>
          <option value="bus">Bus or vehicle</option>
          <option value="driver">Driver</option>
          <option value="attendant">Bus attendant</option>
        </select>

        {feedbackAbout === "driver" ? (
          <>
            <label className="pd-fb-card__field-label" htmlFor="pd-fb-driver-hint">
              Driver name or ID
            </label>
            <input
              id="pd-fb-driver-hint"
              className="pd-fb-card__input"
              value={driverHint}
              onChange={(e) => setDriverHint(e.target.value)}
              placeholder="Full name as on roster, or 6-digit driver ID"
              autoComplete="name"
            />
          </>
        ) : null}

        <label className="pd-fb-card__field-label" htmlFor="pd-fb-comment">
          Your feedback
        </label>
        <textarea
          id="pd-fb-comment"
          className="pd-fb-card__textarea pd-fb-card__textarea--lg"
          rows={6}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Your feedback…"
        />

        <div className="pd-fb-card__stars-block">
          <span className="pd-fb-card__field-label pd-fb-card__field-label--center" id="pd-fb-stars-label">
            Star rating
          </span>
          <div className="pd-fb-card__stars" role="group" aria-labelledby="pd-fb-stars-label">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={"pd-fb-card__star" + (rating >= n ? " pd-fb-card__star--on" : "")}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
                aria-pressed={rating >= n}
                onClick={() => setRating(n)}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <div className="pd-fb-card__toolbar" role="group" aria-label="Submit feedback">
          <span className="pd-fb-card__spacer" aria-hidden />
          <span className="pd-fb-card__spacer" aria-hidden />
          <button type="submit" className="pd-fb-card__send" disabled={pending} aria-label="Send feedback">
            {pending ? (
              <span className="pd-fb-card__send-label">Sending…</span>
            ) : (
              <svg
                className="pd-fb-card__send-icon"
                fill="none"
                viewBox="0 0 24 24"
                height="30"
                width="30"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <path
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeWidth="1.5"
                  d="M7.39999 6.32003L15.89 3.49003C19.7 2.22003 21.77 4.30003 20.51 8.11003L17.68 16.6C15.78 22.31 12.66 22.31 10.76 16.6L9.91999 14.08L7.39999 13.24C1.68999 11.34 1.68999 8.23003 7.39999 6.32003Z"
                />
                <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="1.5" d="M10.11 13.6501L13.69 10.0601" />
              </svg>
            )}
          </button>
        </div>

        {formError ? (
          <p className="pd-fb-card__err" role="alert">
            {formError}
          </p>
        ) : null}

        {sent ? (
          <p className="pd-fb-card__ack" role="status">
            Received. Thank you — operations will review your feedback.
          </p>
        ) : null}
      </form>
    </div>
  );
}
