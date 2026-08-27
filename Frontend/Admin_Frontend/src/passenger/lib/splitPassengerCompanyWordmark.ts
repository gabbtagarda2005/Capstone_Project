const FALLBACK = "Bukidnon Transit";

/**
 * Split company name for a Fintech-style wordmark: first segment in accent purple, remainder in white.
 * Multi-word: first word / rest. Single long word: ~first 38% of letters / rest.
 */
export function splitPassengerCompanyWordmark(name: string): { lead: string; rest: string } {
  const t = name.trim() || FALLBACK;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return { lead: words[0] ?? FALLBACK, rest: " " + words.slice(1).join(" ") };
  }
  const w = words[0] ?? FALLBACK;
  if (w.length <= 4) {
    return { lead: w, rest: "" };
  }
  const cut = Math.max(2, Math.min(Math.round(w.length * 0.38), w.length - 1));
  return { lead: w.slice(0, cut), rest: w.slice(cut) };
}
