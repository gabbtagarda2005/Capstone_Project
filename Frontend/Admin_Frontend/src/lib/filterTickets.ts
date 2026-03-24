import type { TicketRow } from "@/lib/types";

export type DatePreset = "all" | "day" | "month" | "year";

export type FilterState = {
  passengerIdQuery: string;
  preset: DatePreset;
  /** yyyy-mm-dd when preset is day */
  day: string;
  /** yyyy-mm when preset is month */
  month: string;
  /** yyyy when preset is year */
  year: string;
  from: string;
  to: string;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Inclusive from/to as date strings yyyy-mm-dd */
function rangeFromPreset(state: FilterState): { start: Date | null; end: Date | null } {
  switch (state.preset) {
    case "all":
      return { start: null, end: null };
    case "day": {
      if (!state.day) return { start: null, end: null };
      const d = new Date(state.day + "T12:00:00");
      if (Number.isNaN(d.getTime())) return { start: null, end: null };
      return { start: startOfDay(d), end: endOfDay(d) };
    }
    case "month": {
      if (!state.month) return { start: null, end: null };
      const [y, m] = state.month.split("-").map(Number);
      if (!y || !m) return { start: null, end: null };
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case "year": {
      if (!state.year) return { start: null, end: null };
      const y = Number(state.year);
      if (!y) return { start: null, end: null };
      return {
        start: new Date(y, 0, 1),
        end: new Date(y, 11, 31, 23, 59, 59, 999),
      };
    }
    default:
      return { start: null, end: null };
  }
}

function rangeFromManual(state: FilterState): { start: Date | null; end: Date | null } {
  if (!state.from && !state.to) return { start: null, end: null };
  const start = state.from ? startOfDay(new Date(state.from + "T12:00:00")) : null;
  const end = state.to ? endOfDay(new Date(state.to + "T12:00:00")) : null;
  return { start, end };
}

export function filterTickets(all: TicketRow[], state: FilterState): TicketRow[] {
  let start: Date | null = null;
  let end: Date | null = null;

  const hasManual = Boolean(state.from || state.to);
  if (hasManual) {
    const r = rangeFromManual(state);
    start = r.start;
    end = r.end;
  } else {
    const r = rangeFromPreset(state);
    start = r.start;
    end = r.end;
  }

  const q = state.passengerIdQuery.trim().toLowerCase();

  return all.filter((t) => {
    const created = new Date(t.createdAt);
    if (Number.isNaN(created.getTime())) return false;

    if (q && !t.passengerId.toLowerCase().includes(q)) return false;

    if (start && created < start) return false;
    if (end && created > end) return false;

    return true;
  });
}

export function sumFare(rows: TicketRow[]): number {
  return rows.reduce((s, r) => s + r.fare, 0);
}
