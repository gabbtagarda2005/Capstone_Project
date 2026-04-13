import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicCompanyProfile } from "@/lib/api";
import img1 from "@/Image/1.jpg";
import img2 from "@/Image/2.jpg";
import img3 from "@/Image/3.jpg";
import "./LandingPage.css";

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"
      stroke="url(#lp-shield-g)"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill="rgba(34,211,238,0.12)"
    />
    <path d="M12 8v4l2 2" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" />
    <defs>
      <linearGradient id="lp-shield-g" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#67e8f9" />
        <stop offset="1" stopColor="#2563eb" />
      </linearGradient>
    </defs>
  </svg>
);

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

const passengerTrackBase =
  (import.meta.env.VITE_PASSENGER_APP_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:5174";

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
  const [companyName, setCompanyName] = useState("Transit operations");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

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
        <Link to="/login" className="landing-nav__cta">
          Sign in
        </Link>
      </header>

      <section className="landing-part landing-part--1" style={part1Bg} aria-label="Welcome">
        <div className="landing-part--1__inner">
          <div className="landing-hero__grid">
            <div className="landing-hero__copy">
              <p className="landing-hero__eyebrow">Real-time · IoT · Operations</p>
              <h1 className="landing-hero__title">
                Welcome to <span>{companyName}</span>
              </h1>
              <p className="landing-hero__desc">
                A distributed transport operations platform: LilyGo GPS ingestion, live fleet maps, Bus Attendant
                ticketing, and admin oversight — keeping passengers, drivers, and control room in sync.
              </p>
              <div className="landing-hero__actions">
                <Link to="/login" className="landing-hero__go">
                  Get Started ↗
                </Link>
                <span className="landing-hero__actions-or">or</span>
                <a href={`${passengerTrackBase}/`} className="landing-hero__go">
                  Track Bus ↗
                </a>
              </div>
            </div>
            <div className="landing-hero__visual" aria-hidden>
              <div className="landing-hero__ring" />
              <div className="landing-hero__ring2" />
              <div className="landing-hero__core">
                <ShieldIcon />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-part landing-part--2" style={part2Bg} aria-label="Overview and roadmap">
        <div className="landing-part--2__shell">
          <section className="landing-section landing-section--operational">
            <div className="landing-section__head">
              <h2>Operational mix</h2>
              <p>How effort typically splits across the ecosystem (illustrative for planning).</p>
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
              <ul className="landing-bullets">
                <li>
                  <strong>35%: Tracking &amp; maps</strong>
                  <br />
                  Ingest, validate, and visualize bus positions for admins and passengers.
                </li>
                <li>
                  <strong>25%: Terminal ticketing</strong>
                  <br />
                  Issue tickets, enforce fixed fares, and keep Bus Attendant attribution on every row.
                </li>
                <li>
                  <strong>15%: Geofences &amp; alerts</strong>
                  <br />
                  Stops, proximity, and optional push when a bus nears a passenger.
                </li>
                <li>
                  <strong>15%: Hardware &amp; OTA</strong>
                  <br />
                  LilyGo firmware paths and safe rollout to field devices.
                </li>
                <li>
                  <strong>10%: Reporting &amp; audits</strong>
                  <br />
                  Filters by day, month, and range for cash-drawer alignment.
                </li>
              </ul>
            </div>
          </section>

          <section className="landing-section landing-roadmap" aria-labelledby="landing-roadmap-title">
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
