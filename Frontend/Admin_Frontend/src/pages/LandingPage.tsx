import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicCompanyProfile, fetchPublicLiveBuses } from "@/lib/api";
import type { BusLiveLogRow } from "@/lib/types";
import img1 from "@/Image/1.jpg";
import img2 from "@/Image/2.jpg";
import img3 from "@/Image/3.jpg";
import { AppDownloadCard } from "@/components/AppDownloadCard";
import { TeamShowcase } from "@/components/TeamShowcase";
import { Bus3DHero } from "@/components/Bus3DHero";
import "./LandingPage.css";

const HERO_POLL_MS = 20_000;

const NAV_LINKS = [
  { id: "home", label: "Home" },
  { id: "download-app", label: "Download App" },
  { id: "operational-mix", label: "Operational Mix" },
  { id: "roadmap", label: "Roadmap" },
  { id: "people-behind", label: "People Behind" },
] as const;
type NavSectionId = (typeof NAV_LINKS)[number]["id"];

function IconPin() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 4v14M15 6v14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconGps() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8 6h6a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconScroll() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="24" fill="none" aria-hidden>
      <rect x="7" y="2" width="10" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}

function delayBadge(tier: string | undefined): { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  switch (tier) {
    case "EARLY":
      return { label: "EARLY", tone: "ok" };
    case "ON_TIME":
      return { label: "ON TIME", tone: "ok" };
    case "MINOR_DELAY":
      return { label: "MINOR DELAY", tone: "warn" };
    case "MODERATE_DELAY":
      return { label: "DELAYED", tone: "warn" };
    case "SEVERE_DELAY":
      return { label: "SEVERE DELAY", tone: "bad" };
    case "STOPPED":
      return { label: "STOPPED", tone: "warn" };
    default:
      return { label: "—", tone: "muted" };
  }
}

const part1Bg: CSSProperties = {
  backgroundColor: "#020617",
  backgroundImage: `linear-gradient(
      90deg,
      rgba(2, 6, 23, 0.82) 0%,
      rgba(2, 6, 23, 0.42) 45%,
      rgba(2, 6, 23, 0.42) 55%,
      rgba(2, 6, 23, 0.82) 100%
    ),
    url(${img2}),
    url(${img1})`,
  backgroundSize: "100% 100%, 50% 100%, 50% 100%",
  backgroundPosition: "center, left center, right center",
  backgroundRepeat: "no-repeat, no-repeat, no-repeat",
};

const part2Bg: CSSProperties = {
  backgroundColor: "#020617",
  backgroundImage: `linear-gradient(
      180deg,
      rgba(2, 6, 23, 0.97) 0%,
      rgba(2, 6, 23, 0.78) 18%,
      rgba(2, 6, 23, 0.72) 45%,
      rgba(2, 6, 23, 0.88) 100%
    ),
    url(${img3})`,
  backgroundSize: "cover, cover",
  backgroundPosition: "center, center",
  backgroundRepeat: "no-repeat, no-repeat",
};

const ROADMAP_STEPS = [
  {
    title: "Q1: Foundation",
    items: ["Admin API + Mongo ingest", "Live map prototype", "Bus Attendant auth baseline"],
    side: "above" as const,
    xPct: 17.3,
    yPct: 72.4,
  },
  {
    title: "Q2: Terminal scale",
    items: ["Ticketing SQL + revenue cards", "Passenger web ETA", "Geofence events"],
    side: "below" as const,
    xPct: 42.3,
    yPct: 72.4,
  },
  {
    title: "Q3: Field apps",
    items: ["Bus Attendant mobile hardening", "OTA firmware pipeline", "Push notifications"],
    side: "above" as const,
    xPct: 42.3,
    yPct: 51.7,
  },
  {
    title: "Q4: Hardening",
    items: ["Audit exports", "Performance & SLAs", "Disaster backups"],
    side: "below" as const,
    xPct: 67.3,
    yPct: 51.7,
  },
  {
    title: "Beyond",
    items: ["Inter-city routes", "Analytics & ML assist", "Continuous growth"],
    side: "above" as const,
    xPct: 67.3,
    yPct: 31,
  },
];

export function LandingPage() {
  const [companyName, setCompanyName] = useState("Bukidnon Bus Company");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [featuredBus, setFeaturedBus] = useState<BusLiveLogRow | null>(null);
  const [activeSection, setActiveSection] = useState<NavSectionId>("home");

  useEffect(() => {
    let cancelled = false;
    void fetchPublicCompanyProfile()
      .then((p) => {
        if (cancelled) return;
        const n = String(p.name || "").trim();
        if (n) setCompanyName(n);
        setLogoUrl(p.logoUrl && String(p.logoUrl).trim() ? String(p.logoUrl).trim() : null);
        setLogoFailed(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A real live bus for the hero's floating cards — never a made-up bus reading (see
  // routes/buses.js "/live" on the backend, the same real data the fleet map itself uses).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const buses = await fetchPublicLiveBuses();
        if (cancelled) return;
        const live = (buses.items || []).find(
          (b) =>
            (b.gpsFreshness === "live" || b.gpsFreshness === "recent") &&
            Number.isFinite(b.latitude) &&
            Number.isFinite(b.longitude)
        );
        setFeaturedBus(live || null);
      } catch {
        if (!cancelled) setFeaturedBus(null);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), HERO_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Moves the nav's active-link underline to whichever section is actually in view, instead of
  // leaving it stuck on "Home" — the click handlers on each link also set this immediately so the
  // underline doesn't wait for the scroll to catch up.
  useEffect(() => {
    const els = NAV_LINKS.map((link) => document.getElementById(link.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id as NavSectionId);
          }
        }
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const etaBadge = delayBadge(featuredBus?.delay?.tier);

  const year = new Date().getFullYear();

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-nav__brand">
          {logoUrl && !logoFailed ? (
            <img
              className="landing-nav__logo"
              src={logoUrl}
              alt=""
              onError={() => setLogoFailed(true)}
            />
          ) : null}
          <span className="landing-logo">{companyName}</span>
        </div>
        <nav className="landing-nav__links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={`landing-nav__link ${activeSection === link.id ? "landing-nav__link--active" : ""}`}
              onClick={() => setActiveSection(link.id)}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="landing-nav__right">
          <Link to="/login" className="landing-nav__cta">
            <IconUser /> Sign in
          </Link>
        </div>
      </header>

      <section className="landing-part landing-part--1" id="home" style={part1Bg} aria-label="Welcome">
        <div className="landing-part--1__inner">
          <div className="landing-hero__grid">
            <div className="landing-hero__copy">
              <p className="landing-hero__eyebrow">Bukidnon Mobility Network</p>
              <h1 className="landing-hero__title">
                <span className="landing-hero__title-line">Know Where</span>
                <span className="landing-hero__title-line landing-hero__title-line--accent">Your Bus Is.</span>
              </h1>
              <p className="landing-hero__desc">
                Real-time bus tracking, route information, estimated arrival times, and transport
                updates, built for smarter mobility across Bukidnon.
              </p>
              <div className="landing-hero__actions">
                <Link to="/passenger" className="landing-hero__go landing-hero__go--primary">
                  <IconPin /> Track a Bus
                </Link>
                <Link to="/passenger" className="landing-hero__go landing-hero__go--secondary">
                  <IconMap /> Explore Routes
                </Link>
              </div>
              <ul className="landing-hero__features">
                <li>
                  <span className="landing-hero__feature-icon">
                    <IconGps />
                  </span>
                  <span>
                    <strong>Real-Time GPS</strong>
                    <span>Live bus locations</span>
                  </span>
                </li>
                <li>
                  <span className="landing-hero__feature-icon">
                    <IconRoute />
                  </span>
                  <span>
                    <strong>Smart Routes</strong>
                    <span>Optimized schedules</span>
                  </span>
                </li>
                <li>
                  <span className="landing-hero__feature-icon">
                    <IconShield />
                  </span>
                  <span>
                    <strong>Safe &amp; Reliable</strong>
                    <span>For every commuter</span>
                  </span>
                </li>
              </ul>
            </div>
            <div className="landing-hero__visual">
              <Bus3DHero />

              {featuredBus ? (
                <div className="landing-hero__card landing-hero__card--gps">
                  <div className="landing-hero__card-head">
                    <IconPin />
                    LIVE GPS
                    <span className="landing-hero__card-live-dot" aria-hidden />
                  </div>
                  <strong className="landing-hero__card-title">{featuredBus.busId}</strong>
                  <span className="landing-hero__card-line">
                    {featuredBus.latitude.toFixed(4)}° N, {featuredBus.longitude.toFixed(4)}° E
                  </span>
                  {featuredBus.speedKph != null ? (
                    <span className="landing-hero__card-line">{Math.round(featuredBus.speedKph)} km/h</span>
                  ) : null}
                </div>
              ) : null}

              {featuredBus && featuredBus.etaMinutes != null ? (
                <div className="landing-hero__card landing-hero__card--eta">
                  <div className="landing-hero__card-head">
                    <IconClock />
                    ETA
                  </div>
                  <strong className="landing-hero__card-title">{Math.round(featuredBus.etaMinutes)} min</strong>
                  {featuredBus.nextTerminal ? (
                    <span className="landing-hero__card-line">to {featuredBus.nextTerminal}</span>
                  ) : null}
                  <span className={`landing-hero__card-badge landing-hero__card-badge--${etaBadge.tone}`}>
                    {etaBadge.label}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="landing-hero__scroll">
            <IconScroll />
            Scroll to explore
          </div>
        </div>
      </section>

      <section className="landing-part landing-part--2" style={part2Bg} aria-label="Overview and roadmap">
        <div className="landing-part--2__shell">
          <div className="landing-app-download-wrap" id="download-app">
            <AppDownloadCard />
          </div>
          <section className="landing-section landing-section--operational" id="operational-mix">
            <div className="landing-section__head">
              <h2>Operational mix</h2>
              <p>How effort typically splits across the ecosystem.</p>
            </div>
            <div className="landing-split">
              <div className="landing-donut-wrap">
                <div className="landing-donut" />
                <div className="landing-donut__hole">
                  Fleet &amp;
                  <br />
                  passenger
                </div>
              </div>
              <ul className="landing-stats">
                <li className="landing-stats__item">
                  <span className="landing-stats__pct">35%</span>
                  <div className="landing-stats__body">
                    <strong>Tracking &amp; maps</strong>
                    <p>Ingest, validate, and visualize bus positions for admins and passengers.</p>
                  </div>
                </li>
                <li className="landing-stats__item">
                  <span className="landing-stats__pct">25%</span>
                  <div className="landing-stats__body">
                    <strong>Terminal ticketing</strong>
                    <p>Issue tickets, enforce fixed fares, and keep Bus Attendant attribution on every row.</p>
                  </div>
                </li>
                <li className="landing-stats__item">
                  <span className="landing-stats__pct">15%</span>
                  <div className="landing-stats__body">
                    <strong>Geofences &amp; alerts</strong>
                    <p>Stops, proximity, and optional push when a bus nears a passenger.</p>
                  </div>
                </li>
                <li className="landing-stats__item">
                  <span className="landing-stats__pct">15%</span>
                  <div className="landing-stats__body">
                    <strong>Hardware &amp; OTA</strong>
                    <p>LilyGo firmware paths and safe rollout to field devices.</p>
                  </div>
                </li>
                <li className="landing-stats__item">
                  <span className="landing-stats__pct">10%</span>
                  <div className="landing-stats__body">
                    <strong>Reporting &amp; audits</strong>
                    <p>Filters by day, month, and range for cash-drawer alignment.</p>
                  </div>
                </li>
              </ul>
            </div>
          </section>

          <section className="landing-section landing-roadmap" id="roadmap" aria-labelledby="landing-roadmap-title">
            <div className="landing-section__head">
              <h2 id="landing-roadmap-title">Roadmap</h2>
              <p>From first ping to province-wide reliability.</p>
            </div>

            <div className="landing-roadmap__canvas">
              <div className="landing-roadmap__stage">
              <svg
                className="landing-roadmap__svg"
                viewBox="0 0 520 580"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden
              >
                <defs>
                  <linearGradient id="lp-roadmap-glow" x1="0%" y1="0%" x2="100%" y2="0%" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#e879f9" />
                    <stop offset="45%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#38bdf8" />
                  </linearGradient>
                </defs>
                <path
                  className="landing-roadmap__path-glow"
                  d="M 90 520 L 90 420 L 220 420 L 220 300 L 350 300 L 350 180 L 500 180"
                  fill="none"
                  stroke="url(#lp-roadmap-glow)"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.35"
                />
                <path
                  className="landing-roadmap__path"
                  d="M 90 520 L 90 420 L 220 420 L 220 300 L 350 300 L 350 180 L 500 180"
                  fill="none"
                  stroke="url(#lp-roadmap-glow)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle className="landing-roadmap__dot" cx="90" cy="520" r="7" fill="#f0f9ff" />
                <circle className="landing-roadmap__dot" cx="90" cy="420" r="7" fill="#f0f9ff" />
                <circle className="landing-roadmap__dot" cx="220" cy="420" r="7" fill="#f0f9ff" />
                <circle className="landing-roadmap__dot" cx="220" cy="300" r="7" fill="#f0f9ff" />
                <circle className="landing-roadmap__dot" cx="350" cy="300" r="7" fill="#f0f9ff" />
                <circle className="landing-roadmap__dot" cx="350" cy="180" r="7" fill="#f0f9ff" />
                <circle className="landing-roadmap__dot" cx="500" cy="180" r="7" fill="#f0f9ff" />
              </svg>

              <span className="landing-roadmap__pill landing-roadmap__pill--start">2025</span>
              <span className="landing-roadmap__pill landing-roadmap__pill--end">2026</span>

              {ROADMAP_STEPS.map((step) => (
                <div
                  key={step.title}
                  className={`landing-roadmap__anchor landing-roadmap__anchor--${step.side}`}
                  style={{ left: `${step.xPct}%`, top: `${step.yPct}%` }}
                >
                  <article className={`landing-roadmap__card landing-roadmap__card--${step.side}`}>
                    <h3 className="landing-roadmap__card-title">{step.title}</h3>
                    <ul className="landing-roadmap__card-list">
                      {step.items.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </article>
                </div>
              ))}
              </div>
            </div>
          </section>

          <section className="landing-section landing-team" id="people-behind" aria-label="People behind the system">
            <TeamShowcase variant="landing" companyName={companyName} />
          </section>

          <footer className="landing-footer">
            <p className="landing-footer__copy">
              © {year} {companyName}
            </p>
          </footer>
        </div>
      </section>
    </div>
  );
}
