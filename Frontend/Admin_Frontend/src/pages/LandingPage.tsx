import { Link } from "react-router-dom";
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

export function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <span className="landing-logo">Bukidnon Transport</span>
        <Link to="/login" className="landing-nav__cta">
          Sign in
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-hero__grid">
          <div>
            <p className="landing-hero__eyebrow">Real-time · IoT · Operations</p>
            <h1 className="landing-hero__title">
              Welcome to <span>Bukidnon Bus Command</span>
            </h1>
            <p className="landing-hero__desc">
              A distributed transport platform for Bukidnon: LilyGo GPS ingestion, live fleet maps, operator
              ticketing, and admin oversight — built so passengers, drivers, and control room stay in sync.
            </p>
            <Link to="/login" className="landing-hero__go">
              Let&apos;s GO ↗
            </Link>
          </div>
          <div className="landing-hero__visual" aria-hidden>
            <div className="landing-hero__ring" />
            <div className="landing-hero__ring2" />
            <div className="landing-hero__core">
              <ShieldIcon />
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section__head">
          <h2>Why operators choose this stack</h2>
          <p>Secure workflows, transparent fares, and hardware you can trust on the road.</p>
        </div>
        <div className="landing-cards">
          <article className="landing-card">
            <div className="landing-card__icon" aria-hidden>
              📡
            </div>
            <h3>Live fleet intelligence</h3>
            <p>
              GPS pings land in the cloud, broadcast over WebSockets, and render as moving markers — no manual
              refresh on the admin map.
            </p>
          </article>
          <article className="landing-card">
            <div className="landing-card__icon" aria-hidden>
              🎫
            </div>
            <h3>Ticketing with accountability</h3>
            <p>
              Every passenger record stores route, fare, and the operator name at issue time — so audits and
              revenue totals stay defensible.
            </p>
          </article>
          <article className="landing-card">
            <div className="landing-card__icon" aria-hidden>
              🛡️
            </div>
            <h3>Controlled admin access</h3>
            <p>
              Role-based admin sign-in, session tokens, and recovery flows — built for terminal operations, not
              anonymous dashboards.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-section">
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
              <strong>35% — Tracking &amp; maps</strong>
              <br />
              Ingest, validate, and visualize bus positions for admins and passengers.
            </li>
            <li>
              <strong>25% — Terminal ticketing</strong>
              <br />
              Issue tickets, enforce fixed fares, and keep operator attribution on every row.
            </li>
            <li>
              <strong>15% — Geofences &amp; alerts</strong>
              <br />
              Stops, proximity, and optional push when a bus nears a passenger.
            </li>
            <li>
              <strong>15% — Hardware &amp; OTA</strong>
              <br />
              LilyGo firmware paths and safe rollout to field devices.
            </li>
            <li>
              <strong>10% — Reporting &amp; audits</strong>
              <br />
              Filters by day, month, and range for cash-drawer alignment.
            </li>
          </ul>
        </div>
      </section>

      <section className="landing-section landing-roadmap">
        <div className="landing-roadmap__bg" aria-hidden>
          2025
        </div>
        <div className="landing-section__head">
          <h2>Roadmap</h2>
          <p>From first ping to province-wide reliability.</p>
        </div>
        <div className="landing-timeline">
          <div className="landing-timeline__item">
            <h4>Q1 — Foundation</h4>
            <ul>
              <li>Admin API + Mongo ingest</li>
              <li>Live map prototype</li>
              <li>Operator auth baseline</li>
            </ul>
          </div>
          <div className="landing-timeline__item">
            <h4>Q2 — Terminal scale</h4>
            <ul>
              <li>Ticketing SQL + revenue cards</li>
              <li>Passenger web ETA</li>
              <li>Geofence events</li>
            </ul>
          </div>
          <div className="landing-timeline__item">
            <h4>Q3 — Field apps</h4>
            <ul>
              <li>Operator mobile hardening</li>
              <li>OTA firmware pipeline</li>
              <li>Push notifications</li>
            </ul>
          </div>
          <div className="landing-timeline__item">
            <h4>Q4 — Hardening</h4>
            <ul>
              <li>Audit exports</li>
              <li>Performance &amp; SLAs</li>
              <li>Disaster backups</li>
            </ul>
          </div>
          <div className="landing-timeline__item">
            <h4>Beyond</h4>
            <ul>
              <li>Inter-city routes</li>
              <li>Analytics &amp; ML assist</li>
              <li>Continuous growth</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="landing-paper">
        <div className="landing-paper__inner">
          <div>
            <h3>Bukidnon Transport — Architecture brief</h3>
            <p>System diagram, data flows, and collection map for your capstone defense.</p>
          </div>
          <a
            className="landing-paper__btn"
            href="mailto:bukidnonbuscompany2025@gmail.com?subject=Architecture%20brief%20request"
          >
            <span aria-hidden>⬇</span>
            Request document
          </a>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer__row">
          <h3>Join the project</h3>
          <div className="landing-footer__actions">
            <a className="landing-footer__pill" href="mailto:bukidnonbuscompany2025@gmail.com">
              <span aria-hidden>✈</span> Company inbox
            </a>
            <a className="landing-footer__pill" href="mailto:2301108330@student.buksu.edu.ph">
              <span aria-hidden>🎓</span> Student dev
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
