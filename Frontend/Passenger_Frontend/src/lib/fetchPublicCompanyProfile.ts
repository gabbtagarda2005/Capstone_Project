import { fetchPublicGetJson } from "@/lib/fetchWithPublicApiBases";

export type PublicCompanyProfile = {
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  logoUrl: string | null;
};

const DEFAULT_NAME = "Bukidnon Transit";

/**
 * Admin portal branding (Settings → Brand identity): name + sidebar logo URL.
 * Served by Admin_Backend GET /api/public/company-profile (optionally via Passenger API proxy).
 */
export async function fetchPublicCompanyProfile(): Promise<PublicCompanyProfile> {
  const d = await fetchPublicGetJson<Record<string, unknown>>("/api/public/company-profile");
  const name = typeof d.name === "string" && d.name.trim() ? d.name.trim() : DEFAULT_NAME;
  const logoUrl =
    typeof d.logoUrl === "string" && d.logoUrl.trim() ? d.logoUrl.trim() : null;
  return {
    name,
    email: typeof d.email === "string" && d.email.trim() ? d.email.trim() : null,
    phone: typeof d.phone === "string" && d.phone.trim() ? d.phone.trim() : null,
    location: typeof d.location === "string" && d.location.trim() ? d.location.trim() : null,
    logoUrl,
  };
}
