import { useMemo } from "react";
import { Sparkline } from "@/components/Sparkline";
import type { ReportsAnalyticsDto } from "@/lib/types";
import {
  buildExecutiveForecastLine,
  goalPaceAnalysis,
  isPeakHourVolume,
  lastCompletedHourIndex,
  pctChange,
  smartTomorrowProjection,
  avgTicketsPerHourLast7Days,
  type PctTrend,
} from "@/lib/reportsExecutiveIntel";

type Props = {
  analytics: ReportsAnalyticsDto;
  isLive: boolean;
  goalAnomalyPulse: boolean;
};

function TrendIndicator({ trend, suffix }: { trend: PctTrend; suffix?: string }) {
  const cls =
    trend.positive === null ? "reports-exec-trend--flat" : trend.positive ? "reports-exec-trend--up" : "reports-exec-trend--down";
  return (
    <div className={`reports-exec-trend ${cls}`}>
      <span className="reports-exec-trend__pct reports-hub__animate-heartbeat">{trend.label}</span>
      {suffix ? <span className="reports-exec-trend__suffix">{suffix}</span> : null}
    </div>
  );
}

function GoalRing({ pct, warn }: { pct: number; warn: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const gradId = "reportsGoalRingGrad";
  const segments = 24;
  const safePct = Math.max(0, Math.min(100, pct));
  const onSegments = Math.round((safePct / 100) * segments);
  const segLen = c / segments;

  const onStroke = warn ? "#f87171" : `url(#${gradId})`;
  const offStroke = "rgba(59,130,246,0.18)";

  // Keep the subtle background ring for depth.
  return (
    <div className="reports-exec-goal-ring" aria-hidden>
      <svg width="120" height="120" viewBox="0 0 120 120" className="reports-exec-goal-ring__svg">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(59,130,246,0.2)" strokeWidth="10" />
        {Array.from({ length: segments }, (_, i) => {
          const isOn = i < onSegments;
          return (
            <circle
              key={i}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={isOn ? onStroke : offStroke}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${segLen} ${c - segLen}`}
              strokeDashoffset={-i * segLen}
              transform="rotate(-90 60 60)"
              className="reports-exec-goal-ring__arc"
            />
          );
        })}
      </svg>
      <div className="reports-exec-goal-ring__center">
        <strong>{pct.toFixed(1)}%</strong>
        <span>of goal</span>
      </div>
    </div>
  );
}

export function ReportsExecutiveMetrics({ analytics: d, isLive, goalAnomalyPulse }: Props) {
  const ex = d.executive;
  const SLIDE_OCEAN = "#4A6BBE";
  const daily = d.dailyLast14 ?? [];
  const months = d.monthlyThisYear ?? [];
  const now = new Date();

  const todayBucket = daily.length ? daily[daily.length - 1] : null;
  const yesterdayBucket = daily.length >= 2 ? daily[daily.length - 2] : null;

  const todayRev = todayBucket?.revenue ?? ex.todayRevenue;
  const yesterdayRev = yesterdayBucket?.revenue ?? 0;
  const todayTk = todayBucket?.tickets ?? ex.todayTickets;
  const yesterdayTk = yesterdayBucket?.tickets ?? 0;

  const cm = now.getMonth() + 1;
  const curMonthRev = months[cm - 1]?.revenue ?? 0;
  const prevMonthRev = cm > 1 ? months[cm - 2]?.revenue ?? 0 : 0;
  const curMonthTk = months[cm - 1]?.tickets ?? 0;
  const prevMonthTk = cm > 1 ? months[cm - 2]?.tickets ?? 0 : 0;

  const revDayTrend = useMemo(() => pctChange(todayRev, yesterdayRev), [todayRev, yesterdayRev]);
  const revMoTrend = useMemo(() => pctChange(curMonthRev, prevMonthRev), [curMonthRev, prevMonthRev]);
  const tkDayTrend = useMemo(() => pctChange(todayTk, yesterdayTk), [todayTk, yesterdayTk]);
  const tkMoTrend = useMemo(() => pctChange(curMonthTk, prevMonthTk), [curMonthTk, prevMonthTk]);

  const revenueMomentumGlow =
    revDayTrend.pct !== null && revDayTrend.pct >= 5
      ? " reports-page__stat--glow-up"
      : revDayTrend.pct !== null && revDayTrend.pct <= -5
        ? " reports-page__stat--glow-down"
        : "";

  const hourlyRevSpark = d.hourlyToday.map((h) => h.revenue);
  const smartProj = useMemo(() => smartTomorrowProjection(d), [d]);
  const displayProj = smartProj > 0 ? smartProj : ex.tomorrowProjection ?? 0;
  const projVsToday = pctChange(smartProj > 0 ? smartProj : displayProj, todayRev);

  const avg7 = ex.avgDailyLast7Days ?? 0;
  const projLow = isLive && smartProj > 0 && avg7 > 0 && smartProj < avg7 * 0.35;

  const peakVol = isLive && isPeakHourVolume(d, now);
  const avgHrTk = avgTicketsPerHourLast7Days(d);
  const peakHr = lastCompletedHourIndex(now);
  const peakHrTickets = d.hourlyToday.find((x) => x.hour === peakHr)?.tickets ?? 0;

  const goalPct = ex.goalProgressPct ?? 0;
  const monthlyGoal = d.constants.monthlyProfitGoalPesos ?? 100_000;
  const monthlyRev = ex.monthlyRevenue ?? 0;
  const pace = useMemo(() => goalPaceAnalysis(monthlyGoal, monthlyRev, goalPct, now), [monthlyGoal, monthlyRev, goalPct, now]);

  const forecastLine = useMemo(() => buildExecutiveForecastLine(d), [d]);

  return (
    <div className="reports-exec-suite">
      <section className="reports-page__exec reports-page__exec--intel">
        <article className={`reports-page__stat reports-page__stat--hero reports-page__stat--revenue-momentum${revenueMomentumGlow}`}>
          <div className="reports-page__stat-label-row">
            <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
            Total revenue (actual)
          </div>
          <strong>₱{(ex.totalRevenue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
          <span className="reports-page__stat-note">Accumulated from all issued tickets</span>
          <div className="reports-exec-today-strip">
            <span className="reports-exec-today-strip__k">Today&apos;s intake</span>
            <span className="reports-exec-today-strip__v">₱{todayRev.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="reports-exec-trend-row">
            <TrendIndicator trend={revDayTrend} suffix="" />
            {cm > 1 ? <TrendIndicator trend={revMoTrend} suffix="" /> : <span className="reports-exec-trend--flat reports-exec-trend__suffix">MoM after January</span>}
          </div>
          <div className="reports-exec-spark">
            <span className="reports-exec-spark__label">Last 24h revenue flow</span>
            <Sparkline
              values={hourlyRevSpark.length ? hourlyRevSpark : [0]}
              width={200}
              height={32}
              stroke={SLIDE_OCEAN}
              fill="rgba(74, 107, 190, 0.18)"
            />
          </div>
        </article>

        <article className="reports-page__stat reports-page__stat--hero">
          <div className="reports-page__stat-label-row">
            <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
            Total tickets
            {peakVol ? (
              <span className="reports-exec-peak-badge" title={`Hour ${peakHr}:00 above 7-day average per hour`}>
                PEAK VOLUME
              </span>
            ) : null}
          </div>
          <strong>{(ex.totalTickets ?? 0).toLocaleString()}</strong>
          <div className="reports-exec-today-strip">
            <span className="reports-exec-today-strip__k">Today</span>
            <span className="reports-exec-today-strip__v">{todayTk.toLocaleString()} tickets</span>
          </div>
          <div className="reports-exec-trend-row">
            <TrendIndicator trend={tkDayTrend} suffix="" />
            {cm > 1 ? <TrendIndicator trend={tkMoTrend} suffix="" /> : <span className="reports-exec-trend--flat reports-exec-trend__suffix">MoM after January</span>}
          </div>
          {isLive && avgHrTk > 0 ? (
            <p className="reports-exec-micro">
              Last hour window ({peakHr}:00): {peakHrTickets} tk · 7d avg / hr ~{avgHrTk.toFixed(1)}
            </p>
          ) : null}
        </article>

        <article className={`reports-page__stat reports-page__stat--hero${projLow ? " reports-page__stat--proj-low" : ""}`}>
          <div className="reports-page__stat-label-row">
            <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
            Tomorrow projection
          </div>
          <strong>₱{displayProj.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
          {isLive && todayRev > 0 ? (
            <div className="reports-exec-trend-row">
              <TrendIndicator trend={projVsToday} suffix="vs today actual" />
            </div>
          ) : null}
        </article>

        <article
          className={`reports-page__stat reports-page__stat--hero reports-page__stat--goal-ring-card${
            goalAnomalyPulse || pace.behindSchedule ? " reports-page__stat--goal-warn" : ""
          }`}
        >
          <div className="reports-page__stat-label-row">
            {goalAnomalyPulse ? (
              <span className="reports-page__heartbeat reports-page__heartbeat--amber reports-hub__animate-heartbeat" aria-hidden />
            ) : (
              <span className="reports-page__heartbeat reports-hub__animate-heartbeat" aria-hidden />
            )}
            Monthly profit goal
          </div>
          <div className="reports-exec-goal-layout">
            <GoalRing pct={goalPct} warn={pace.behindSchedule} />
            <div className="reports-exec-goal-copy">
              <p className="reports-exec-goal-meta">
                MTD ₱{monthlyRev.toLocaleString(undefined, { maximumFractionDigits: 2 })} of ₱{monthlyGoal.toLocaleString()} target
              </p>
            </div>
          </div>
        </article>
      </section>

      <div className="reports-exec-forecast" role="status">
        <span className="reports-exec-forecast__dot reports-hub__animate-heartbeat" aria-hidden />
        <p className="reports-exec-forecast__text">{forecastLine}</p>
      </div>
    </div>
  );
}
