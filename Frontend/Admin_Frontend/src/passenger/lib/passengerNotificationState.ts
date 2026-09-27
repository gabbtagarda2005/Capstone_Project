const FIRST_SEEN_KEY = "passenger_notif_first_seen_v1";
const DISMISSED_KEY = "passenger_notif_dismissed_v1";

/** Notifications from the feed carry no real "sent at" timestamp of their own (the same id can
 *  keep recurring every poll for as long as its underlying condition holds), so "sent" is treated
 *  as "first time this device observed this notification id" — timestamps below are keyed that way. */
export const NOTIF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type TimestampMap = Record<string, number>;

function loadMap(key: string): TimestampMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: TimestampMap = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(key: string, map: TimestampMap): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function loadFirstSeenAt(): TimestampMap {
  return loadMap(FIRST_SEEN_KEY);
}

export function saveFirstSeenAt(map: TimestampMap): void {
  saveMap(FIRST_SEEN_KEY, map);
}

export function loadDismissedAt(): TimestampMap {
  return loadMap(DISMISSED_KEY);
}

export function saveDismissedAt(map: TimestampMap): void {
  saveMap(DISMISSED_KEY, map);
}

/** Bounds storage growth: keeps an entry only while its id is still coming back from the feed.
 *  Once the underlying condition genuinely clears (id stops appearing), it's safe to forget —
 *  this must NOT be age-based, since a >24h-old entry is exactly what marks a notification as
 *  expired while its id is still active; erasing it on that basis would undo the expiry itself. */
export function pruneToActiveIds(map: TimestampMap, activeIds: ReadonlySet<string>): TimestampMap {
  const out: TimestampMap = {};
  for (const [id, at] of Object.entries(map)) {
    if (activeIds.has(id)) out[id] = at;
  }
  return out;
}

export function isNotificationExpired(firstSeenAtMs: number, now: number = Date.now()): boolean {
  return now - firstSeenAtMs >= NOTIF_MAX_AGE_MS;
}
