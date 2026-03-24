import type { TicketRow } from "@/lib/types";

/** Hour 0-23 -> count */
export function peakByHourForDay(tickets: TicketRow[], day: Date): { hour: number; count: number }[] {
  const y = day.getFullYear();
  const m = day.getMonth();
  const d = day.getDate();
  const counts = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  for (const t of tickets) {
    const dt = new Date(t.createdAt);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) continue;
    counts[dt.getHours()]!.count += 1;
  }
  return counts;
}

/** Day of month 1..31 -> count (current month) */
export function peakByDayOfMonth(tickets: TicketRow[], ref: Date): { day: number; count: number }[] {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const counts: { day: number; count: number }[] = [];
  for (let day = 1; day <= last; day++) counts.push({ day, count: 0 });
  for (const t of tickets) {
    const dt = new Date(t.createdAt);
    if (dt.getFullYear() !== y || dt.getMonth() !== m) continue;
    const dom = dt.getDate();
    counts[dom - 1]!.count += 1;
  }
  return counts;
}

/** Month 1-12 -> count (current year) */
export function peakByMonthYear(tickets: TicketRow[], year: number): { month: string; count: number }[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const counts = months.map((name) => ({ month: name, count: 0 }));
  for (const t of tickets) {
    const dt = new Date(t.createdAt);
    if (dt.getFullYear() !== year) continue;
    counts[dt.getMonth()]!.count += 1;
  }
  return counts;
}

export function revenueByHourDay(tickets: TicketRow[], day: Date): { hour: number; revenue: number }[] {
  const y = day.getFullYear();
  const m = day.getMonth();
  const d = day.getDate();
  const sums = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0 }));
  for (const t of tickets) {
    const dt = new Date(t.createdAt);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) continue;
    sums[dt.getHours()]!.revenue += t.fare;
  }
  return sums;
}

export function revenueByDayOfMonth(tickets: TicketRow[], ref: Date): { day: number; revenue: number }[] {
  const y = ref.getFullYear();
  const mo = ref.getMonth();
  const last = new Date(y, mo + 1, 0).getDate();
  const sums: { day: number; revenue: number }[] = [];
  for (let day = 1; day <= last; day++) sums.push({ day, revenue: 0 });
  for (const t of tickets) {
    const dt = new Date(t.createdAt);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo) continue;
    sums[dt.getDate() - 1]!.revenue += t.fare;
  }
  return sums;
}

export function revenueByMonthYear(tickets: TicketRow[], year: number): { month: string; revenue: number }[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sums = months.map((name) => ({ month: name, revenue: 0 }));
  for (const t of tickets) {
    const dt = new Date(t.createdAt);
    if (dt.getFullYear() !== year) continue;
    sums[dt.getMonth()]!.revenue += t.fare;
  }
  return sums;
}

export function totalPassengersAllTime(tickets: TicketRow[]): number {
  return tickets.length;
}

export function totalRevenueAllTime(tickets: TicketRow[]): number {
  return tickets.reduce((s, t) => s + t.fare, 0);
}
