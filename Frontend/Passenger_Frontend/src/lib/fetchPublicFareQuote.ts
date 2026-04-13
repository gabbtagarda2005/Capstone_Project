import { fetchPublicPostJson } from "@/lib/fetchWithPublicApiBases";

export type FareCategoryUi = "regular" | "student" | "senior" | "pwd";

export type PublicFareQuoteOk = {
  matched: true;
  fare: number;
  baseFarePesos: number | null;
  distanceChargePesos: number;
  subtotalRoundedHalfPeso: number | null;
  discountPct: number;
  discountAmount: number;
  passengerCategory: string;
  pricingMode: string;
  fareBreakdownDisplay: string | null;
  /** Present when API sends a prose summary (e.g. pre-terminal distance-only trips). */
  pricingSummary?: string | null;
};

export type PublicFareQuoteNo = {
  matched: false;
  message: string;
  passengerCategory?: string;
};

export type PublicFareQuoteResponse = PublicFareQuoteOk | PublicFareQuoteNo;

export async function fetchPublicFareQuote(body: {
  startLocation: string;
  destination: string;
  passengerCategory: FareCategoryUi;
}): Promise<PublicFareQuoteResponse> {
  try {
    const data = await fetchPublicPostJson<PublicFareQuoteResponse & { error?: string }>("/api/public/fare-quote", {
      startLocation: body.startLocation.trim(),
      destination: body.destination.trim(),
      passengerCategory: body.passengerCategory,
    });
    return data as PublicFareQuoteResponse;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fare quote failed";
    const hint =
      msg === "Endpoint not found."
        ? " Configure VITE_PASSENGER_API_URL (Passenger API with Admin proxy) or VITE_ADMIN_API_URL, and ensure Admin_Backend includes POST /api/public/fare-quote."
        : "";
    throw new Error(msg + hint);
  }
}
