import { fetchPublicGetJson } from "@/lib/fetchWithPublicApiBases";

export type PublicLiveBoardItem = {
  id: string;
  busId: string;
  route: string | null;
  etaMinutes: number | null;
  nextTerminal: string | null;
  status?: string;
};

export async function fetchPublicLiveBoard(): Promise<PublicLiveBoardItem[]> {
  const data = await fetchPublicGetJson<{ items?: PublicLiveBoardItem[]; error?: string }>("/api/public/live-board");
  return Array.isArray(data.items) ? data.items : [];
}

/** Prefer the smallest ETA when a bus appears on multiple board rows. */
export function bestEtaByBusId(items: PublicLiveBoardItem[]): Map<string, { eta: number | null; nextTerminal: string | null }> {
  const m = new Map<string, { eta: number | null; nextTerminal: string | null }>();
  for (const it of items) {
    const bid = String(it.busId ?? "").trim();
    if (!bid) continue;
    const etaRaw = it.etaMinutes;
    const eta =
      etaRaw != null && Number.isFinite(Number(etaRaw)) ? Math.max(0, Math.round(Number(etaRaw))) : null;
    const nextTerminal = it.nextTerminal?.trim() || null;
    const prev = m.get(bid);
    if (!prev || (eta != null && (prev.eta == null || eta < prev.eta))) {
      m.set(bid, { eta, nextTerminal });
    }
  }
  return m;
}
