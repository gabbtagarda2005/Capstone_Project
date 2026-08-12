import { fetchPublicGetJson } from "@/lib/fetchWithPublicApiBases";

export type PublicPassengerHighlights = {
  activeRoutes: number;
  monthlyPassengers: number;
  onTimeTargetPct: number | null;
  basisCount: number;
};

export async function fetchPublicPassengerHighlights(): Promise<PublicPassengerHighlights> {
  const data = await fetchPublicGetJson<{
    activeRoutes?: number;
    monthlyPassengers?: number;
    onTimeTargetPct?: number | null;
    basisCount?: number;
    error?: string;
  }>("/api/public/passenger-highlights");

  const activeRoutes = Number.isFinite(Number(data.activeRoutes)) ? Math.max(0, Math.round(Number(data.activeRoutes))) : 0;
  const monthlyPassengers = Number.isFinite(Number(data.monthlyPassengers))
    ? Math.max(0, Math.round(Number(data.monthlyPassengers)))
    : 0;
  const basisCount = Number.isFinite(Number(data.basisCount)) ? Math.max(0, Math.round(Number(data.basisCount))) : 0;

  const onTimeRaw = data.onTimeTargetPct;
  const onTimeTargetPct =
    onTimeRaw == null || !Number.isFinite(Number(onTimeRaw))
      ? null
      : Math.max(0, Math.min(100, Math.round(Number(onTimeRaw))));

  return {
    activeRoutes,
    monthlyPassengers,
    onTimeTargetPct,
    basisCount,
  };
}
