import type { ReportsAnalyticsDto } from "@/lib/types";

export const SLIDE_UP = "#87A8DA";
export const SLIDE_DOWN = "#f87171";

export type PctTrend = {
  label: string;
  positive: boolean | null;
  pct: number | null;
};

/** Percent change; null previous → treat as no baseline. */
export function pctChange(current: number, previous: number): PctTrend {
  if (previous <= 0 && current <= 0) return { label: "—", positive: null, pct: null };
  if (previous <= 0) return { label: "▲ baseline", positive: true, pct: null };
  const raw = ((current - previous) / previous) * 100;
  const positive = raw >= 0;
  return {
    label: `${positive ? "▲" : "▼"} ${Math.abs(raw).toFixed(1)}%`,
    positive,
    pct: raw,
  };
}

const WMA_WEIGHTS = [7, 6, 5, 4, 3, 2, 1];

/** Last 7 daily revenues, oldest → newest (length ≤ 7 uses available). */
export function weightedMovingAverageNextDay(dailyRevenues: number[]): number {
  if (!dailyRevenues.length) return 0;
  const slice = dailyRevenues.slice(-7);
  const n = slice.length;
  const weights = WMA_WEIGHTS.slice(-n);
  const wSum = weights.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const rev = slice[i] ?? 0;
    const w = weights[i] ?? 1;
    sum += rev * w;
  }
  return wSum > 0 ? sum / wSum : 0;
}

export function weekendSurgeMultiplier(forDate: Date): number {
  const d = forDate.getDay();
  return d === 0 || d === 6 ? 1.15 : 1;
}

export function smartTomorrowProjection(d: ReportsAnalyticsDto): number {
  const daily = d.dailyLast14 ?? [];
  const last7 = daily.slice(-7).map((x) => x.revenue);
  let base = weightedMovingAverageNextDay(last7);
  if (base <= 0 && d.executive.avgDailyLast7Days > 0) {
    base = d.executive.avgDailyLast7Days;
  }
  if (base <= 0) return d.executive.tomorrowProjection ?? 0;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return base * weekendSurgeMultiplier(tomorrow);
}

/** Avg tickets per clock hour across last 7 days (rough). */
export function avgTicketsPerHourLast7Days(d: ReportsAnalyticsDto): number {
  const daily = d.dailyLast14 ?? [];
  const last7 = daily.slice(-7);
  const totalT = last7.reduce((s, x) => s + x.tickets, 0);
  return totalT / (7 * 24);
}

/** Hour bucket on today's chart to compare (previous clock hour, or 0 at midnight). */
export function lastCompletedHourIndex(now = new Date()): number {
  const h = now.getHours();
  return Math.max(0, h - 1);
}

export function isPeakHourVolume(d: ReportsAnalyticsDto, now = new Date()): boolean {
  const avg = avgTicketsPerHourLast7Days(d);
  if (avg <= 0) return false;
  const hr = lastCompletedHourIndex(now);
  const cell = d.hourlyToday.find((x) => x.hour === hr);
  const t = cell?.tickets ?? 0;
  return t > avg * 1.15;
}

export function daysLeftInMonth(now = new Date()): number {
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, last - now.getDate() + 1);
}

export function daysInMonth(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export type GoalPace = {
  requiredPerDay: number;
  daysLeft: number;
  behindSchedule: boolean;
  expectedProgressPct: number;
};

export function goalPaceAnalysis(
  monthlyGoal: number,
  monthlyRev: number,
  goalProgressPct: number,
  now = new Date()
): GoalPace {
  const dim = daysInMonth(now);
  const dom = now.getDate();
  const expectedProgressPct = (dom / dim) * 100;
  const behindSchedule = goalProgressPct + 4 < expectedProgressPct;
  const remaining = Math.max(0, monthlyGoal - monthlyRev);
  const daysLeft = daysLeftInMonth(now);
  return {
    requiredPerDay: remaining / daysLeft,
    daysLeft,
    behindSchedule,
    expectedProgressPct,
  };
}

export function linearMonthEndProjection(monthlyRev: number, now = new Date()): number {
  const dom = now.getDate();
  const dim = daysInMonth(now);
  if (dom <= 0) return monthlyRev;
  return (monthlyRev / dom) * dim;
}

export function buildExecutiveForecastLine(d: ReportsAnalyticsDto): string {
  const goal = d.constants.monthlyProfitGoalPesos ?? 100_000;
  const mtd = d.executive.monthlyRevenue ?? 0;
  const proj = linearMonthEndProjection(mtd);
  const gap = goal - proj;
  const corridor = d.insights.peakCorridorHint?.trim() || "primary corridors";
  if (mtd <= 0 && proj <= 0) {
    return "AI forecast: Connect ticketing to model month-end trajectory and corridor actions.";
  }
  if (gap <= 0) {
    return `AI forecast: On track for ~₱${proj.toLocaleString(undefined, { maximumFractionDigits: 0 })} MTD pace — at or above ₱${goal.toLocaleString()} goal. Reinforce ${corridor} during peak windows.`;
  }
  const pctBelow = goal > 0 ? Math.round((gap / goal) * 100) : 0;
  return `AI forecast: Current trajectory ~₱${proj.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${pctBelow}% below goal). Consider added frequency on ${corridor} to close ~₱${Math.max(0, gap).toLocaleString(undefined, { maximumFractionDigits: 0 })}.`;
}
