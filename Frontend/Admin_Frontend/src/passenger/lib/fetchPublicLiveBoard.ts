import { fetchPublicGetJson } from "@/passenger/lib/fetchWithPublicApiBases";

/** "connected" | "fallback" (SMS) | "signal_lost" | "simulated" — whether a device is actually
 *  reporting right now, independent of the trip's dispatch `status`. */
export type PublicGpsStatus = "connected" | "fallback" | "signal_lost" | "simulated";

export type PublicLiveBoardItem = {
  id: string;
  busId: string;
  route: string | null;
  etaMinutes: number | null;
  /** "live" = computed from a real GPS fix; "scheduled" = estimated from the timetable because
   *  no device has reported in yet; null/absent = no estimate available either way. */
  etaSource?: "live" | "scheduled" | null;
  nextTerminal: string | null;
  status?: string;
  /** Raw published schedule (HH:mm) — the original timetable slot, not the live-status clock. */
  scheduledDeparture?: string | null;
  gpsStatus?: PublicGpsStatus | null;
};

export async function fetchPublicLiveBoard(): Promise<PublicLiveBoardItem[]> {
  const data = await fetchPublicGetJson<{ items?: PublicLiveBoardItem[]; error?: string }>("/api/public/live-board");
  return Array.isArray(data.items) ? data.items : [];
}

/** Prefer the smallest ETA when a bus appears on multiple board rows. */
type BestEtaEntry = {
  eta: number | null;
  nextTerminal: string | null;
  status: string | null;
  scheduledDeparture: string | null;
  etaSource: "live" | "scheduled" | null;
  gpsStatus: PublicGpsStatus | null;
};

export function bestEtaByBusId(items: PublicLiveBoardItem[]): Map<string, BestEtaEntry> {
  const m = new Map<string, BestEtaEntry>();
  for (const it of items) {
    const bid = String(it.busId ?? "").trim();
    if (!bid) continue;
    const etaRaw = it.etaMinutes;
    const eta =
      etaRaw != null && Number.isFinite(Number(etaRaw)) ? Math.max(0, Math.round(Number(etaRaw))) : null;
    const nextTerminal = it.nextTerminal?.trim() || null;
    const status = it.status?.trim() || null;
    const scheduledDeparture = it.scheduledDeparture?.trim() || null;
    const etaSource = it.etaSource ?? null;
    const gpsStatus = it.gpsStatus ?? null;
    const prev = m.get(bid);
    if (!prev || (eta != null && (prev.eta == null || eta < prev.eta))) {
      m.set(bid, { eta, nextTerminal, status, scheduledDeparture, etaSource, gpsStatus });
    }
  }
  return m;
}
