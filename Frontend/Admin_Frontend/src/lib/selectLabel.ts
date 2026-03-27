/**
 * Compact dropdown labels for better scanability.
 * Example: "Don Carlos Integrated Bus Terminal (Don Carlos, Bukidnon, ...)"
 * -> "Don Carlos, Bukidnon"
 */
export function compactOptionLabel(raw: string, maxLen = 26): string {
  const src = String(raw || "").trim();
  if (!src) return "";
  if (src.length <= maxLen) return src;

  const cleaned = src
    .replace(/Integrated Bus Terminal/gi, "")
    .replace(/Integrated Transport Terminal Complex/gi, "")
    .replace(/Integrated Transport Terminal/gi, "")
    .replace(/Transport Terminal/gi, "")
    .replace(/Northern Mindanao/gi, "")
    .replace(/Philippines/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned
    .split(/[,(]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const head = (parts[0] || "").trim();
  const second = (parts[1] || "").trim();

  if (head && second) {
    const combo = `${head}, ${second}`;
    if (combo.length <= maxLen + 8) return combo;
  }
  if (head) {
    if (head.length <= maxLen + 8) return head;
    return head.slice(0, maxLen - 1).trimEnd() + "…";
  }
  return cleaned.slice(0, maxLen - 1).trimEnd() + "…";
}

