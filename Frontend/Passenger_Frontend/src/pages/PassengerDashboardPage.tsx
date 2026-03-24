import { Link } from "react-router-dom";
import { PassengerLogo } from "@/components/PassengerLogo";
import "./PassengerLandingPage.css";
import "./PassengerDashboardPage.css";

const UPDATES = [
  { title: "Bus B-07 approaching Valencia", meta: "ETA 4 min · Route MLY-VLC", time: "Just now" },
  { title: "Schedule change: Dologon line", meta: "Extra trip 5:10 PM today", time: "12 min ago" },
  { title: "Terminal A — shorter queue", meta: "Suggested gate: B for southbound", time: "28 min ago" },
];

const QUICK = [
  { icon: "🔔", title: "Alerts", body: "Delay and gate push notices." },
  { icon: "⭐", title: "Saved routes", body: "Jump back to frequent trips." },
  { icon: "🧾", title: "E-tickets", body: "QR codes in one place." },
  { icon: "💬", title: "Support", body: "Chat or call the terminal." },
  { icon: "🎁", title: "Rewards", body: "Travel points & promos." },
  { icon: "⚙️", title: "Settings", body: "Language & notifications." },
];

export function PassengerDashboardPage() {
  return (
    <div className="pd">
      <div className="pd__glow" aria-hidden />

      <header className="ph-nav pd__inner">
        <Link to="/" className="ph-nav__brand">
          <PassengerLogo />
          Bukidnon Transit
        </Link>
        <nav className="ph-nav__links" aria-label="Dashboard">
          <Link to="/">Home</Link>
          <a href="#modules">Modules</a>
          <a href="#quick">Quick actions</a>
          <a href="#more">Insights</a>
        </nav>
        <Link to="/" className="ph-btn ph-btn--ghost">
          Log out
        </Link>
      </header>

      <main className="pd__inner">
        <section className="pd-hero">
          <h1 className="pd-hero__title">
            Your trip hub — <span>live &amp; on time</span>
          </h1>
          <p className="pd-hero__sub">
            Track buses, manage tickets, and catch updates the moment the fleet moves.
          </p>
        </section>

        <section className="pd-metrics" aria-label="Key metrics">
          <div className="pd-metric">
            <div className="pd-metric__val">24</div>
            <div className="pd-metric__label">Available buses today</div>
          </div>
          <div className="pd-metric">
            <div className="pd-metric__val">3</div>
            <div className="pd-metric__label">Active tickets</div>
          </div>
          <div className="pd-metric">
            <div className="pd-metric__val">1.2k</div>
            <div className="pd-metric__label">Travel points</div>
          </div>
        </section>

        <section id="modules" className="pd-modules">
          <Link to="/" className="pd-card pd-card--cta pd-mod--wide">
            <div>
              <div className="pd-card__icon" aria-hidden>
                🚌
              </div>
              <h3>Book a trip</h3>
              <p>Search origin, destination, and date — same flow as the landing page.</p>
            </div>
            <span className="pd-card__arrow">Start search →</span>
          </Link>

          <Link to="/" className="pd-card pd-card--cta pd-mod--wide">
            <div>
              <div className="pd-card__icon" aria-hidden>
                🗺️
              </div>
              <h3>Live bus map</h3>
              <p>See vehicles moving in real time when connected to your tracking API.</p>
            </div>
            <span className="pd-card__arrow">Open map →</span>
          </Link>

          <div className="pd-card pd-card--sm">
            <div className="pd-card__icon" aria-hidden>
              📜
            </div>
            <h3>Transaction history</h3>
            <p>Past fares and refunds in one ledger.</p>
          </div>

          <div className="pd-card pd-card--sm">
            <div className="pd-card__icon" aria-hidden>
              👤
            </div>
            <h3>Profile &amp; ID</h3>
            <p>Verify phone and student ID for discounts.</p>
          </div>

          <div className="pd-card pd-card--sm">
            <div className="pd-card__icon" aria-hidden>
              ❓
            </div>
            <h3>Help &amp; support</h3>
            <p>FAQs, lost items, and terminal contacts.</p>
          </div>

          <aside className="pd-card pd-mod--feed">
            <div className="pd-feed__head">
              <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Real-time trip updates</h3>
              <span className="pd-feed__badge">Live</span>
            </div>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--pd-muted)" }}>
              Demo notifications — wire to WebSockets or push.
            </p>
            {UPDATES.map((u, i) => (
              <div className="pd-feed__item" key={i}>
                <div className="pd-feed__row">
                  <div>
                    <div className="pd-feed__title">{u.title}</div>
                    <div className="pd-feed__meta">{u.meta}</div>
                  </div>
                  <span className="pd-feed__time">{u.time}</span>
                </div>
              </div>
            ))}
          </aside>
        </section>

        <section id="quick">
          <h2 className="pd-section-title">Quick actions</h2>
          <p className="pd-section-sub">Shortcuts for everyday passenger tasks.</p>
          <div className="pd-quick">
            {QUICK.map((q) => (
              <div className="pd-quick__card" key={q.title}>
                <div className="pd-quick__icon" aria-hidden>
                  {q.icon}
                </div>
                <h4>{q.title}</h4>
                <p>{q.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="more" className="pd-split">
          <div>
            <h2 className="pd-section-title">Why real-time matters</h2>
            <p className="pd-section-sub" style={{ marginBottom: "0.5rem" }}>
              GPS pings and geofences power ETAs passengers can trust — fewer missed buses and calmer
              terminals.
            </p>
            <div className="pd-split__stats">
              <div className="pd-split__stat">
                <strong>&lt; 10s</strong>
                <span>Typical GPS refresh</span>
              </div>
              <div className="pd-split__stat">
                <strong>99%</strong>
                <span>Target on-time display</span>
              </div>
            </div>
            <Link to="/" className="ph-btn ph-btn--primary">
              Learn more
            </Link>
          </div>
          <div>
            {[
              { icon: "✨", t: "Priority boarding", d: "Members get early gate alerts." },
              { icon: "🛡️", t: "Secure ticketing", d: "QR tied to your account and trip." },
              { icon: "📣", t: "Promos & news", d: "Route expansions and fare updates." },
            ].map((x) => (
              <div className="pd-benefit" key={x.t}>
                <div className="pd-benefit__icon" aria-hidden>
                  {x.icon}
                </div>
                <div>
                  <h4>{x.t}</h4>
                  <p>{x.d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="pd-footer">
          <p>
            Bukidnon Transit passenger dashboard ·{" "}
            <Link to="/" style={{ color: "#7dd3fc" }}>
              Back to landing
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
