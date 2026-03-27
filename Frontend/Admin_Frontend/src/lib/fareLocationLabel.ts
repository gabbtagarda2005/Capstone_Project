/**
 * Compact label for fare dropdowns and cards (e.g. "Don Carlos Bukidnon"
 * instead of full Nominatim / terminal strings).
 */
export function shortFareLocationLabel(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";

  const innerFromParen = s.match(/\(([^)]+)\)/);
  if (innerFromParen?.[1]) {
    const inner = innerFromParen[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const bukidnonIdx = inner.findIndex((x) => /^Bukidnon$/i.test(x));
    if (bukidnonIdx >= 1) {
      const city = inner[bukidnonIdx - 1];
      const prov = inner[bukidnonIdx];
      if (city && prov) return `${city} ${prov}`;
    }
    if (inner.length >= 2 && /Philippines$/i.test(inner[inner.length - 1] || "")) {
      const a = inner[0];
      const b = inner[1];
      if (a && b) return `${a} ${b}`;
    }
  }

  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  const bukidnonIdx = parts.findIndex((x) => /^Bukidnon$/i.test(x));
  if (bukidnonIdx >= 1) {
    const rawLeft = parts[bukidnonIdx - 1];
    const rawProv = parts[bukidnonIdx];
    if (rawLeft && rawProv) {
      const left = rawLeft.replace(/\s*\([^)]*\)\s*$/g, "").trim();
      return `${left} ${rawProv}`;
    }
  }

  let head = parts[0] || s;
  head = head
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+Integrated Bus Terminal.*$/i, "")
    .replace(/\s+Integrated Transport Terminal.*$/i, "")
    .replace(/\s+Bus Terminal$/i, "")
    .replace(/\s+Transport Terminal.*$/i, "")
    .trim();

  const parenTwo = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenTwo && !s.includes(",")) {
    const g1 = parenTwo[1];
    const g2 = parenTwo[2];
    if (g1 != null && g2 != null) {
      const a = g1
        .trim()
        .replace(/\s+Integrated Bus Terminal.*$/i, "")
        .replace(/\s+Integrated Transport Terminal.*$/i, "")
        .replace(/\s+Bus Terminal$/i, "")
        .replace(/\s+Transport Terminal.*$/i, "")
        .trim();
      const b = g2.trim();
      if (a && b) return `${a} ${b}`;
    }
  }

  return head || s;
}
