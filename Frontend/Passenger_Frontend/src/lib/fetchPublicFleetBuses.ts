import { fetchPublicGetJson } from "@/lib/fetchWithPublicApiBases";

export type PublicFleetBus = {
  busId: string;
  busNumber: string;
  plateNumber: string | null;
  route: string | null;
  status: string;
  seatCapacity: number;
};

export async function fetchPublicFleetBuses(): Promise<PublicFleetBus[]> {
  const data = await fetchPublicGetJson<{ items?: PublicFleetBus[]; error?: string }>("/api/public/fleet-buses");
  return Array.isArray(data.items) ? data.items : [];
}
