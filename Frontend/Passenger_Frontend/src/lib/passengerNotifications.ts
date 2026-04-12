const ADMIN_BASE = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4001";

export type PassengerNotificationItem = {
  id: string;
  title: string;
  body: string;
  timeLabel: string;
  kind: "broadcast" | "arrival" | "schedule" | "delay";
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "Now";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Now";
  const diff = Date.now() - t;
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hr ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LiveBoardTrip = {
  id: string;
  busId: string;
  route: string;
  status: string;
  etaMinutes: number | null;
  nextTerminal: string | null;
  arrivalTerminalName: string | null;
  departureTime?: string;
  trackingLost?: boolean;
};

type LiveBoardPayload = {
  items?: LiveBoardTrip[];
  holidayBanner?: string | null;
  serverTime?: string;
};

type BroadcastPayload = {
  message?: string;
  severity?: string;
  updatedAt?: string | null;
};

/**
 * Aggregates admin broadcast, live-board advisories, arrival ETAs, and delay hints for the passenger bell drawer.
 */
export async function fetchPassengerNotificationFeed(): Promise<PassengerNotificationItem[]> {
  const base = ADMIN_BASE.replace(/\/$/, "");
  const out: PassengerNotificationItem[] = [];

  let broadcast: BroadcastPayload = {};
  let board: LiveBoardPayload = {};
  try {
    const [br, lr] = await Promise.all([
      fetch(`${base}/api/public/broadcast/passenger`, { cache: "no-store" }),
      fetch(`${base}/api/public/live-board`, { cache: "no-store" }),
    ]);
    if (br.ok) broadcast = (await br.json()) as BroadcastPayload;
    if (lr.ok) board = (await lr.json()) as LiveBoardPayload;
  } catch {
    return out;
  }

  const msg = String(broadcast.message || "").trim();
  if (msg) {
    out.push({
      id: "broadcast-ops",
      title: "Operations",
      body: msg,
      timeLabel: fmtTime(broadcast.updatedAt),
      kind: "broadcast",
    });
  }

  const banner = String(board.holidayBanner || "").trim();
  if (banner) {
    out.push({
      id: "schedule-banner",
      title: "Schedule advisory",
      body: banner,
      timeLabel: "Today",
      kind: "schedule",
    });
  }

  const trips = Array.isArray(board.items) ? board.items : [];
  const seenArrival = new Set<string>();

  for (const trip of trips) {
    const terminal = trip.nextTerminal || trip.arrivalTerminalName || "";
    const eta = trip.etaMinutes;
    const busLabel = String(trip.busId || "").trim() || "Bus";
    const route = String(trip.route || "").trim() || "Corridor";

    if (trip.status === "delayed") {
      out.push({
        id: `delay-${trip.id}`,
        title: "Schedule change",
        body: `${busLabel} on ${route} is running behind the published time. Check the live departures board for updates.`,
        timeLabel: trip.departureTime || "Live board",
        kind: "delay",
      });
    }

    if (trip.trackingLost && trip.status !== "cancelled") {
      out.push({
        id: `track-${trip.id}`,
        title: "Live tracking",
        body: `${busLabel} — GPS signal is weak or paused. Arrival times may update when the bus reconnects.`,
        timeLabel: "Live board",
        kind: "schedule",
      });
    }

    const near =
      trip.status === "arriving" ||
      (Number.isFinite(Number(eta)) && Number(eta) <= 14 && Boolean(terminal));
    if (near && !seenArrival.has(trip.id)) {
      seenArrival.add(trip.id);
      const etaBit = Number.isFinite(Number(eta)) ? `ETA about ${Math.max(0, Math.round(Number(eta)))} min` : "Approaching";
      out.push({
        id: `arrival-${trip.id}`,
        title: "Bus nearing your corridor",
        body: `${busLabel} · ${route} — ${etaBit}${terminal ? ` toward ${terminal}.` : "."}`,
        timeLabel: trip.departureTime || fmtTime(board.serverTime),
        kind: "arrival",
      });
    }
  }

  return out.slice(0, 24);
}
