/** Short hub / stop label for dense ops tables (matches full address in title tooltips). */
export function shortLocationLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return "—";
  const lower = t.toLowerCase();
  if (lower.includes("valencia city integrated")) return "Valencia City";
  if (lower.includes("lumbo") && lower.includes("valencia")) return "Valencia (Lumbo)";
  if (lower.includes("valencia")) return "Valencia";
  if (lower.includes("malaybalay integrated")) return "Malaybalay";
  if (lower.includes("malaybalay")) return "Malaybalay";
  if (lower.includes("maramag integrated")) return "Maramag";
  if (lower.includes("maramag")) return "Maramag";
  if (lower.includes("don carlos")) return "Don Carlos";
  const comma = t.indexOf(",");
  const head = comma > 0 ? t.slice(0, comma).trim() : t;
  if (head.length <= 26) return head;
  return `${head.slice(0, 23)}…`;
}
