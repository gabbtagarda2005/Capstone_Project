import type { FilterState } from "@/lib/filterTickets";

export function filtersToSearchParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.passengerIdQuery.trim()) p.set("passengerId", f.passengerIdQuery.trim());
  p.set("preset", f.preset);
  if (f.day) p.set("day", f.day);
  if (f.month) p.set("month", f.month);
  if (f.year) p.set("year", f.year);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p;
}
