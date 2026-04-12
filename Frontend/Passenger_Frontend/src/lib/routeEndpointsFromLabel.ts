/** Split corridor labels like "Malaybalay → Valencia" into start / end for display cards. */
export function routeEndpointsFromLabel(route: string | null | undefined): { start: string; end: string } {
  const r = (route ?? "").trim();
  if (!r) return { start: "—", end: "—" };
  const parts = r.split(/\s*(?:→|->|—>|–>)\s*/);
  if (parts.length >= 2) {
    const start = (parts[0] ?? "").trim() || "—";
    const end = parts.slice(1).join(" → ").trim() || "—";
    return { start, end };
  }
  return { start: "—", end: r };
}
