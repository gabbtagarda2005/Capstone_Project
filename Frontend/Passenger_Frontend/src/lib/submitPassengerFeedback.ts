import { fetchPublicPostJson } from "@/lib/fetchWithPublicApiBases";

export type PassengerFeedbackAbout = "bus" | "driver" | "attendant" | "location";

export type PassengerFeedbackPayload = {
  passengerName: string;
  rating: number;
  comment: string;
  routeName: string;
  feedbackAbout: PassengerFeedbackAbout;
  busPlate?: string;
  driverId?: string;
  driverName?: string;
  attendantName?: string;
  isSos?: boolean;
  latitude?: number | null;
  longitude?: number | null;
};

export async function submitPassengerFeedback(body: PassengerFeedbackPayload): Promise<{ ok: true }> {
  await fetchPublicPostJson<Record<string, unknown>>("/api/public/passenger-feedback", body);
  return { ok: true };
}
