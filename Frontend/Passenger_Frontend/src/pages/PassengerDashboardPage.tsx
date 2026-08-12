import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DashboardMap } from "@/components/DashboardMap";
import { PassengerDepartureBoard, PassengerFeedbackConsole } from "@/components/PassengerTacticalPanels";
import { PassengerTopBar } from "@/components/PassengerTopBar";
import { PassengerLostFound, PassengerRouteCalculator } from "@/components/PassengerTacticalHub";
import {
  PassengerDashboardSpaStateProvider,
  usePassengerDashboardSpaState,
  type PassengerSpaSection,
} from "@/components/PassengerDashboardSpaState";
import { fetchPublicCompanyProfile } from "@/lib/fetchPublicCompanyProfile";
import { fetchPublicFleetBuses, type PublicFleetBus } from "@/lib/fetchPublicFleetBuses";
import { bestEtaByBusId, fetchPublicLiveBoard, type PublicLiveBoardItem } from "@/lib/fetchPublicLiveBoard";
import { clearPassengerLocationGate, getPassengerLocationSession } from "@/lib/passengerLocationGate";
import { fetchPassengerNotificationFeed, type PassengerNotificationItem } from "@/lib/passengerNotifications";
import "./PassengerLandingPage.css";
import "./PassengerDashboardPage.css";

const API_BASE = (import.meta.env.VITE_PASSENGER_API_URL || "http://localhost:4000").replace(/\/+$/, "");

export function PassengerDashboardPage() {
  const location = useLocation();
  const startCollapsed = useMemo(
    () => new URLSearchParams(location.search).get("focus") === "map",
    [location.search]
  );
  return (
    <PassengerDashboardSpaStateProvider initialSection="eta" initialCollapsed={startCollapsed}>
      <PassengerDashboardPageInner />
    </PassengerDashboardSpaStateProvider>
  );
}

function PassengerDashboardPageInner() {
  // Reduced animation durations for better UX and accessibility
  const SECTION_FADE_OUT_MS = 100;
  const SECTION_FADE_IN_MS = 150;
  const navigate = useNavigate();
  const [liveBoard, setLiveBoard] = useState<PublicLiveBoardItem[]>([]);
  const [fleetBuses, setFleetBuses] = useState<PublicFleetBus[]>([]);
  const [liveBoardError, setLiveBoardError] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<PassengerNotificationItem[]>([]);
  const [dismissedNotifIds, setDismissedNotifIds] = useState<Set<string>>(new Set());
  const [seenNotifIds, setSeenNotifIds] = useState<Set<string>>(new Set());
  const [companyName, setCompanyName] = useState("Bukidnon Transit");
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const [mapTickerRegion, setMapTickerRegion] = useState("Malaybalay · Bukidnon");
  const [renderedSection, setRenderedSection] = useState<PassengerSpaSection>("eta");
  const [switchPhase, setSwitchPhase] = useState<"idle" | "out" | "in">("idle");
  const { activeSection, setActiveSection, sheetCollapsed, expandSheet, toggleSheet } =
    usePassengerDashboardSpaState();

  function goToSection(section: PassengerSpaSection) {
    setActiveSection(section);
    expandSheet();
  }

  useEffect(() => {
    if (activeSection === renderedSection) return;
    let settleTimeoutId: number | undefined;
    setSwitchPhase("out");
    const fadeOutTimeoutId = window.setTimeout(() => {
      setRenderedSection(activeSection);
      setSwitchPhase("in");
      settleTimeoutId = window.setTimeout(() => {
        setSwitchPhase("idle");
      }, SECTION_FADE_IN_MS);
    }, SECTION_FADE_OUT_MS);
    return () => {
      window.clearTimeout(fadeOutTimeoutId);
      if (settleTimeoutId != null) window.clearTimeout(settleTimeoutId);
    };
  }, [activeSection, renderedSection, SECTION_FADE_IN_MS, SECTION_FADE_OUT_MS]);

  function handleLogout() {
    clearPassengerLocationGate();
    setNotifOpen(false);
    navigate("/", { replace: true });
  }

  function handleTrackBus() {
    setActiveSection("track");
    setNotifOpen(false);
    expandSheet();
    window.requestAnimationFrame(() => {
      document.querySelector(".pd-spa")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const items = await fetchPassengerNotificationFeed();
        if (!cancelled) setNotifications(items);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 28_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const rows = await fetchPublicLiveBoard();
        if (!cancelled) {
          setLiveBoard(rows);
          setLiveBoardError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLiveBoard((prev) => prev);
          setLiveBoardError(err instanceof Error ? err.message : "Could not load departures");
        }
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const sess = getPassengerLocationSession();
        const q: { viewerHub?: string; userLat?: number; userLng?: number } = {};
        if (sess?.nearestLabel?.trim()) q.viewerHub = sess.nearestLabel.trim();
        if (sess && Number.isFinite(sess.lat) && Number.isFinite(sess.lng)) {
          q.userLat = sess.lat;
          q.userLng = sess.lng;
        }
        const items = await fetchPublicFleetBuses(q);
        if (!cancelled) setFleetBuses(items);
      } catch {
        if (!cancelled) setFleetBuses([]);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicCompanyProfile()
      .then((p) => {
        if (!cancelled) {
          setCompanyName(p.name);
          setCompanyLogoUrl(p.logoUrl);
          setLogoBroken(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const quickEtaRows = useMemo(() => buildQuickEtaRows(fleetBuses, liveBoard), [fleetBuses, liveBoard]);
  const peekRow = quickEtaRows[0];

  const visibleNotifications = useMemo(
    () => notifications.filter((n) => !dismissedNotifIds.has(n.id)),
    [notifications, dismissedNotifIds]
  );
  const unseenNotifCount = useMemo(
    () => visibleNotifications.filter((n) => !seenNotifIds.has(n.id)).length,
    [visibleNotifications, seenNotifIds]
  );

  function openNotifications() {
    setNotifOpen(true);
    setSeenNotifIds((prev) => {
      const next = new Set(prev);
      for (const n of visibleNotifications) next.add(n.id);
      return next;
    });
  }

  function dismissNotification(id: string) {
    setDismissedNotifIds((prev) => new Set(prev).add(id));
  }

  function clearAllNotifications() {
    setDismissedNotifIds((prev) => {
      const next = new Set(prev);
      for (const n of visibleNotifications) next.add(n.id);
      return next;
    });
  }

  function renderActiveSection(section: PassengerSpaSection) {
    switch (section) {
      case "eta":
        return <QuickEtaSection rows={quickEtaRows} loadError={liveBoardError} />;
      case "planner":
        return (
          <div className="pd-spa-card pd-spa-card--stack-shell pd-spa-card--planner-tool">
            <PassengerRouteCalculator onTrackBus={handleTrackBus} />
          </div>
        );
      case "support":
        return (
          <div className="pd-spa-card pd-spa-card--stack-shell pd-spa-card--support-split-wrap">
            <div className="pd-spa-support-split" aria-label="Support">
              <div className="pd-spa-support-split__col">
                <PassengerFeedbackConsole />
              </div>
              <div className="pd-spa-support-split__col">
                <PassengerLostFound />
              </div>
            </div>
          </div>
        );
      case "track":
        return (
          <div className="pd-spa-card pd-spa-card--stack-shell" aria-label="Live fleet departures">
            <PassengerDepartureBoard subheading="Same live board as operations · Manila (PHT)" />
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="pd pd-spa">
      <div className="pd-spa__layout">
        <div className="pd__glow" aria-hidden />
        <div className="pd-spa__map-layer">
          <div className="pd-spa__map-fill">
            <DashboardMap apiBase={API_BASE} suppressBrandChrome onMapRegionLabel={setMapTickerRegion} />
          </div>
          <PassengerTopBar
            companyName={companyName}
            companyLogoUrl={companyLogoUrl}
            logoBroken={logoBroken}
            onLogoError={() => setLogoBroken(true)}
            onExit={handleLogout}
            onNotificationsClick={openNotifications}
            notificationCount={unseenNotifCount}
            subtitle={
              <>
                <span className="passenger-top-bar__subtitle-primary">Live network map</span>
                <span className="passenger-top-bar__subtitle-sep" aria-hidden>
                  ·
                </span>
                <span>{mapTickerRegion}</span>
              </>
            }
          />
          <nav className="pd-spa-float-nav" aria-label="Passenger sections">
            <SectionChip icon="🕒" label="Quick ETA" active={activeSection === "eta"} onClick={() => goToSection("eta")} />
            <SectionChip icon="🚌" label="Trip Planner" active={activeSection === "planner"} onClick={() => goToSection("planner")} />
            <SectionChip icon="🎒" label="Support" active={activeSection === "support"} onClick={() => goToSection("support")} />
            <button
              type="button"
              className={"pd-spa-nav__map-btn" + (activeSection === "track" ? " pd-spa-nav__map-btn--active" : "")}
              onClick={handleTrackBus}
              aria-pressed={activeSection === "track"}
            >
              <span className="pd-spa-nav__chip-icon" aria-hidden>
                📍
              </span>
              <span className="pd-spa-nav__chip-label">Track Bus</span>
            </button>
          </nav>
        </div>
        <main className="pd-spa__main-below">
          <section
            className={"pd-spa-sheet" + (sheetCollapsed ? " pd-spa-sheet--collapsed" : "")}
            aria-label="Passenger dashboard sheet"
          >
          <header className="pd-spa-sheet__head pd-spa-sheet__head--minimal">
            <button type="button" className="pd-spa-sheet__handle" onClick={toggleSheet} aria-label="Toggle dashboard sheet">
              <span />
            </button>
          </header>

          {activeSection === "eta" ? (
            <div
              className={
                "pd-spa-sheet__peek" + (peekRow ? " pd-spa-sheet__peek--detail" : " pd-spa-sheet__peek--empty")
              }
              aria-live="polite"
            >
              {peekRow ? (
                <PassengerQuickEtaTile row={peekRow} layout="peek" />
              ) : (
                <span className="pd-spa-sheet__peek-muted">Waiting for live departures…</span>
              )}
            </div>
          ) : null}

          <div className="pd-spa-sheet__active-content" aria-label="Active dashboard section">
            <div className={"pd-spa-sheet__switcher pd-spa-sheet__switcher--" + switchPhase}>
              {renderActiveSection(renderedSection)}
            </div>
          </div>
        </section>
        </main>
      </div>

      {notifOpen ? (
        <div className="pd-notif-overlay" role="dialog" aria-modal="true" aria-label="Notifications">
          <button type="button" className="pd-notif-overlay__backdrop" onClick={() => setNotifOpen(false)} />
          <aside className="pd-notif-drawer">
            <header className="pd-notif-drawer__head">
              <h3>Notifications</h3>
              <div className="pd-notif-drawer__head-actions">
                {visibleNotifications.length > 0 ? (
                  <button type="button" className="pd-notif-drawer__clear-all" onClick={clearAllNotifications}>
                    Clear all
                  </button>
                ) : null}
                <button type="button" onClick={() => setNotifOpen(false)} aria-label="Close notifications">
                  ×
                </button>
              </div>
            </header>
            <div className="pd-notif-drawer__body">
              {visibleNotifications.length === 0 ? (
                <p className="pd-notif-drawer__empty">No notifications yet. We&apos;ll alert you to bus arrivals and schedule changes here.</p>
              ) : (
                visibleNotifications.map((n) => (
                  <article
                    key={n.id}
                    className={`pd-notif-drawer__item pd-notif-drawer__item--${n.kind}`}
                  >
                    <div className="pd-notif-drawer__item-head">
                      <span className="pd-notif-drawer__item-titlewrap">
                        <strong>{n.title}</strong>
                        <span className="pd-notif-drawer__time">{n.timeLabel}</span>
                      </span>
                      <button
                        type="button"
                        className="pd-notif-drawer__item-delete"
                        onClick={() => dismissNotification(n.id)}
                        aria-label={`Dismiss notification: ${n.title}`}
                      >
                        ×
                      </button>
                    </div>
                    <p>{n.body}</p>
                  </article>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}

    </div>
  );
}

function SectionChip({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"pd-spa-nav__chip" + (active ? " pd-spa-nav__chip--active" : "")}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="pd-spa-nav__chip-icon" aria-hidden>
        {icon}
      </span>
      <span className="pd-spa-nav__chip-label">{label}</span>
    </button>
  );
}

type PassengerQuickEtaRow = {
  key: string;
  etaMinutes: number;
  /** Live-board next terminal (operations). */
  nextTerminal: string | null;
  /** Next stop / corridor segment the bus is heading toward (passenger-facing). */
  headingTerminal: string;
  busLabel: string;
  busId: string;
  plate: string;
  seatsMax: string;
  boardedLine: string;
  boardedCount: number;
  seatCap: number;
  statusActive: boolean;
  statusLabel: string;
  routePath: string;
};

function formatFleetRouteLine(bus: PublicFleetBus): string {
  const start = bus.routeStart?.trim();
  const end = bus.routeEnd?.trim();
  if (start && end) return `${start} → ${end}`;
  const r = bus.route?.trim();
  return r || "Route updating";
}

function fleetStatusParts(bus: PublicFleetBus): { active: boolean; label: string } {
  const raw = String(bus.status ?? "").trim();
  const s = raw.toLowerCase();
  if (s === "active") return { active: true, label: "ACTIVE" };
  if (s === "offduty" || s === "off_duty" || s === "off duty") return { active: false, label: "OFF DUTY" };
  if (!raw) return { active: true, label: "LIVE" };
  return { active: false, label: raw.toUpperCase() };
}

function liveBoardStatusParts(status?: string): { active: boolean; label: string } {
  const raw = String(status ?? "").trim();
  const s = raw.toLowerCase();
  if (s === "active") return { active: true, label: "ACTIVE" };
  if (!raw) return { active: true, label: "LIVE" };
  return { active: false, label: raw.toUpperCase() };
}

function seatBoardedLine(bus: PublicFleetBus): string {
  const cap = bus.seatCapacity ?? 0;
  const line = bus.seatLine?.trim();
  if (line) return `${line} boarded`;
  const occ = bus.occupiedSeats;
  if (occ != null && Number.isFinite(occ)) return `${occ}/${cap} boarded`;
  return `0/${cap} boarded`;
}

function fleetBoardingCounts(bus: PublicFleetBus): { boardedCount: number; seatCap: number } {
  const cap = Math.max(0, Math.round(Number(bus.seatCapacity) || 0));
  const line = bus.seatLine?.trim();
  if (line) {
    const m = line.match(/^(\d+)\s*\/\s*(\d+)/);
    if (m) {
      return { boardedCount: Math.max(0, Number(m[1])), seatCap: Math.max(0, Number(m[2])) };
    }
  }
  const occ = bus.occupiedSeats;
  if (occ != null && Number.isFinite(occ) && cap > 0) {
    return { boardedCount: Math.max(0, Math.round(occ)), seatCap: cap };
  }
  return { boardedCount: 0, seatCap: cap };
}

function parseBoardedFraction(line: string): { boardedCount: number; seatCap: number } {
  const m = line.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { boardedCount: 0, seatCap: 0 };
  return { boardedCount: Number(m[1]), seatCap: Number(m[2]) };
}

function splitRouteEnds(path: string): { origin: string; dest: string | null } {
  const t = path.trim();
  const parts = t.split(/\s*(?:→|->)\s*/);
  if (parts.length >= 2) {
    return { origin: (parts[0] ?? t).trim(), dest: parts.slice(1).join(" → ").trim() };
  }
  return { origin: t, dest: null };
}

function shortenStationLabel(label: string, max = 22): string {
  const t = label.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/** Typical mid-corridor stop for Maramag → Malaybalay (Bukidnon); shown when the bus is still early on the leg. */
const VALENCIA_CORRIDOR_HEADING = "Valencia Integrated Bus Terminal, Bukidnon";

/**
 * Passenger-facing “heading to” stop: for the Maramag–Valencia–Malaybalay corridor, prefer Valencia
 * while the trip is still early if the live board names the final hub; switch to Malaybalay once
 * the run is on the last segment (heuristic from `nextTerminal` + ETA).
 */
function resolveHeadingTerminal(
  routePath: string,
  nextTerminal: string | null,
  etaMinutes: number
): string {
  const { origin, dest } = splitRouteEnds(routePath);
  const ntRaw = nextTerminal?.trim() || "";
  const nt = ntRaw.toLowerCase();
  const destTrim = dest?.trim() || "";
  if (!destTrim) return ntRaw || origin.trim() || "Terminal updating";

  if (/maramag/i.test(origin) && /malaybalay/i.test(destTrim)) {
    if (etaMinutes <= 0) return destTrim;
    if (nt.includes("valencia")) return destTrim;
    if (nt.includes("maramag")) return VALENCIA_CORRIDOR_HEADING;
    if (nt.includes("malaybalay")) {
      if (etaMinutes >= 20) return VALENCIA_CORRIDOR_HEADING;
      return destTrim;
    }
    if (etaMinutes >= 22) return VALENCIA_CORRIDOR_HEADING;
    return destTrim;
  }

  if (ntRaw) return ntRaw;
  return destTrim;
}

function buildQuickEtaRows(fleet: PublicFleetBus[], live: PublicLiveBoardItem[]): PassengerQuickEtaRow[] {
  const etaByBus = bestEtaByBusId(live);
  if (fleet.length > 0) {
    const merged: PassengerQuickEtaRow[] = [];
    for (const bus of fleet) {
      const bid = String(bus.busId ?? "").trim();
      if (!bid) continue;
      const rec = etaByBus.get(bid);
      const arriving = String(rec?.status ?? "").trim().toLowerCase() === "arriving";
      const userEta =
        bus.etaMinutesFromUser != null && Number.isFinite(Number(bus.etaMinutesFromUser))
          ? Math.max(0, Math.round(Number(bus.etaMinutesFromUser)))
          : null;
      const boardEta = rec && rec.eta != null ? Math.max(0, Math.round(Number(rec.eta))) : null;
      // Prefer boardEta (from dispatch with all 5 strategies) over userEta (simple distance calc)
      const effectiveEtaRaw = boardEta != null ? boardEta : userEta;
      const effectiveEta = effectiveEtaRaw != null ? (arriving ? Math.max(0, effectiveEtaRaw) : Math.max(1, effectiveEtaRaw)) : null;
      if (effectiveEta == null) continue;
      const st = fleetStatusParts(bus);
      const bc = fleetBoardingCounts(bus);
      const routePath = formatFleetRouteLine(bus);
      merged.push({
        key: bid,
        etaMinutes: effectiveEta,
        nextTerminal: rec?.nextTerminal ?? null,
        headingTerminal: resolveHeadingTerminal(routePath, rec?.nextTerminal ?? null, effectiveEta),
        busLabel: bus.busNumber?.trim() || bid,
        busId: bid,
        plate: bus.plateNumber?.trim() || "—",
        seatsMax: `${bus.seatCapacity ?? 0} seats max`,
        boardedLine: seatBoardedLine(bus),
        boardedCount: bc.boardedCount,
        seatCap: bc.seatCap,
        statusActive: st.active,
        statusLabel: st.label,
        routePath,
      });
    }
    merged.sort((a, b) => a.etaMinutes - b.etaMinutes);
    if (merged.length > 0) return merged.slice(0, 3);
  }

  return [...live]
    .filter((row) => row.etaMinutes != null && Number.isFinite(Number(row.etaMinutes)))
    .sort((a, b) => Number(a.etaMinutes) - Number(b.etaMinutes))
    .slice(0, 3)
    .map((row) => {
      const st = liveBoardStatusParts(row.status);
      const bl = "— boarded";
      const bf = parseBoardedFraction(bl);
      const etaRaw = Math.max(0, Math.round(Number(row.etaMinutes)));
      const arriving = String(row.status ?? "").trim().toLowerCase() === "arriving";
      const etaN = arriving ? etaRaw : Math.max(1, etaRaw);
      const routePath = row.route?.trim() || "Route updating";
      return {
        key: row.id,
        etaMinutes: etaN,
        nextTerminal: row.nextTerminal?.trim() || null,
        headingTerminal: resolveHeadingTerminal(routePath, row.nextTerminal?.trim() || null, etaN),
        busLabel: row.busId?.trim() || "BUS",
        busId: row.busId?.trim() || row.id,
        plate: "—",
        seatsMax: "— seats max",
        boardedLine: bl,
        boardedCount: bf.boardedCount,
        seatCap: bf.seatCap,
        statusActive: st.active,
        statusLabel: st.label,
        routePath,
      };
    });
}

function QuickEtaBusGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="28" height="28" aria-hidden>
      <path
        fill="currentColor"
        d="M4 16c0 .88.39 1.67 1 2.2V20a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-1.8c.61-.53 1-1.32 1-2.2V6c0-2.21-1.79-4-4-4H8C5.79 2 4 3.79 4 6v10zm2 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm10 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zM7 8h10v3H7V8z"
      />
    </svg>
  );
}

function PassengerQuickEtaTile({ row, layout }: { row: PassengerQuickEtaRow; layout: "card" | "peek" }) {
  const rootClass = "pd-spa-eta-tile" + (layout === "peek" ? " pd-spa-eta-tile--peek" : "");
  const { origin, dest } = splitRouteEnds(row.routePath);
  const heroMain = `~${Math.max(0, row.etaMinutes)} min`;
  const heroLive = row.statusActive;
  const cap = Math.max(0, row.seatCap);
  const boardedClamped = cap > 0 ? Math.min(cap, Math.max(0, row.boardedCount)) : 0;
  const fillPct = cap > 0 ? Math.min(100, (boardedClamped / cap) * 100) : 0;

  const inner = (
    <div className="pd-spa-eta-tile__surface">
      <header className="pd-spa-eta-tile__header">
        <div className="pd-spa-eta-tile__brand">
          <div className="pd-spa-eta-tile__brand-line">
            <span
              className={"pd-spa-eta-tile__live-dot" + (heroLive ? " pd-spa-eta-tile__live-dot--on" : "")}
              aria-hidden
            />
            <span className="pd-spa-eta-tile__bus-title">{row.busLabel}</span>
          </div>
          <div
            className={
              "pd-spa-eta-tile__status-pill" + (row.statusActive ? " pd-spa-eta-tile__status-pill--on" : "")
            }
          >
            <span className="pd-spa-eta-tile__status-pill-dot" aria-hidden />
            <span>{row.statusLabel}</span>
          </div>
        </div>
        <div
          className={
            "pd-spa-eta-tile__hero pd-spa-eta-tile__hero--stack" +
            (heroLive ? " pd-spa-eta-tile__hero--pulse" : "")
          }
        >
          <div className="pd-spa-eta-tile__hero-cap">ETA</div>
          <div className="pd-spa-eta-tile__hero-val">{heroMain}</div>
        </div>
      </header>

      {dest ? (
        <div className="pd-spa-eta-tile__journey" aria-label="Route overview">
          <span className="pd-spa-eta-tile__journey-end" title={origin}>
            {shortenStationLabel(origin)}
          </span>
          <span className="pd-spa-eta-tile__journey-track" aria-hidden />
          <QuickEtaBusGlyph className="pd-spa-eta-tile__journey-bus" />
          <span className="pd-spa-eta-tile__journey-arrow" aria-hidden>
            ▶
          </span>
          <span className="pd-spa-eta-tile__journey-track" aria-hidden />
          <span className="pd-spa-eta-tile__journey-end" title={dest}>
            {shortenStationLabel(dest)}
          </span>
        </div>
      ) : (
        <p className="pd-spa-eta-tile__journey pd-spa-eta-tile__journey--single">{row.routePath}</p>
      )}

      <div
        className="pd-spa-eta-tile__terminal-block"
        aria-label={`Heading toward ${row.headingTerminal}`}
      >
        <span className="pd-spa-eta-tile__gicon" aria-hidden>
          📍
        </span>
        <p className="pd-spa-eta-tile__terminal">{row.headingTerminal}</p>
      </div>

      <div className="pd-spa-eta-tile__meta">
        <div className="pd-spa-eta-tile__meta-item">
          <span className="pd-spa-eta-tile__gicon" aria-hidden>
            🏷️
          </span>
          <span className="pd-spa-eta-tile__meta-text">{row.plate}</span>
        </div>
        <div className="pd-spa-eta-tile__meta-item">
          <span className="pd-spa-eta-tile__gicon" aria-hidden>
            💺
          </span>
          <span className="pd-spa-eta-tile__meta-text">{row.seatsMax}</span>
        </div>
      </div>

      <div className="pd-spa-eta-tile__board">
        <div className="pd-spa-eta-tile__board-head">
          <span className="pd-spa-eta-tile__board-label">Boarded</span>
          <span className="pd-spa-eta-tile__board-count">
            {cap > 0 ? `${boardedClamped} / ${cap}` : "—"}
          </span>
        </div>
        <div
          className="pd-spa-eta-tile__bar-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={cap > 0 ? cap : 1}
          aria-valuenow={cap > 0 ? boardedClamped : 0}
          aria-label={`Boarded ${row.boardedLine}`}
        >
          <div className="pd-spa-eta-tile__bar-fill" style={{ width: `${fillPct}%` }} />
        </div>
      </div>

      <div className="pd-spa-eta-tile__route-zone" aria-label="Full route">
        <p className="pd-spa-eta-tile__route-path">{row.routePath}</p>
        <span className="pd-spa-eta-tile__route-cap">ROUTE</span>
      </div>
    </div>
  );

  if (layout === "peek") {
    return <div className={rootClass}>{inner}</div>;
  }

  return (
    <article className={"pd-spa-eta-item " + rootClass} role="listitem">
      {inner}
    </article>
  );
}

function QuickEtaSection({
  rows,
  loadError,
}: {
  rows: PassengerQuickEtaRow[];
  loadError: string | null;
}) {
  return (
    <section className="pd-spa-card pd-spa-card--eta" aria-label="Quick ETA">
      <header className="pd-spa-card__head">
        <h2>Quick ETA</h2>
        <p>Next 3 buses from live dispatch</p>
      </header>
      {rows.length === 0 ? (
        <p className="pd-spa-card__empty">{loadError || "Waiting for live departures..."}</p>
      ) : (
        <div className="pd-spa-eta-row" role="list">
          {rows.map((row) => (
            <PassengerQuickEtaTile key={row.key} row={row} layout="card" />
          ))}
        </div>
      )}
    </section>
  );
}

