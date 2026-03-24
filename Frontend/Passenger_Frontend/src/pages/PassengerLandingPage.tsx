import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PassengerLogo } from "@/components/PassengerLogo";
import "./PassengerLandingPage.css";

const LIVE_DEPARTURES = [
  { route: "Malaybalay → Valencia", detail: "Platform A · Bus B-12", time: "2 min ago" },
  { route: "Dologon → Terminal", detail: "Platform C · ETA 6 min", time: "5 min ago" },
  { route: "Manolo Fortich → Airport Rd", detail: "Platform B · Boarding", time: "8 min ago" },
  { route: "Valencia → Casisang", detail: "Platform A · Departed", time: "12 min ago" },
];

export function PassengerLandingPage() {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [date, setDate] = useState("");

  function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!origin.trim() || !destination.trim()) {
      alert("Please enter origin and destination.");
      return;
    }
    alert(
      `Searching trips: ${origin.trim()} → ${destination.trim()}${date ? ` on ${date}` : ""}\n\nWire this to your passenger API when ready.`
    );
  }

  return (
    <div className="ph">
      <div className="ph__ribbons" aria-hidden />

      <header className="ph-nav ph__inner">
        <Link to="/" className="ph-nav__brand">
          <PassengerLogo />
          Bukidnon Transit
        </Link>
        <nav className="ph-nav__links" aria-label="Primary">
          <a href="#top">Home</a>
          <a href="#about">About</a>
          <a href="#how">How It Works</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link to="/dashboard" className="ph-btn ph-btn--primary">
          Get Started
        </Link>
      </header>

      <main>
        <section className="ph-hero ph__inner" id="top">
          <h1 className="ph-hero__title">
            Know Your Ride Before <span className="ph-gradient">Your Bus Departs</span>
          </h1>
          <p className="ph-hero__sub">
            Real-time ETAs, live vehicle positions, and clear fares for routes across Bukidnon — so you spend
            less time waiting and more time moving.
          </p>
          <div className="ph-hero__cta">
            <Link to="/dashboard" className="ph-btn ph-btn--primary">
              Get Started
            </Link>
            <a href="#about" className="ph-btn ph-btn--ghost">
              Learn More
            </a>
          </div>

          <form id="search" className="ph-search" onSubmit={onSearch}>
            <div className="ph-search__grid">
              <div className="ph-search__field">
                <label htmlFor="ph-origin">Origin</label>
                <input
                  id="ph-origin"
                  placeholder="e.g. Malaybalay"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="ph-search__field">
                <label htmlFor="ph-destination">Destination</label>
                <input
                  id="ph-destination"
                  placeholder="e.g. Valencia"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="ph-search__field">
                <label htmlFor="ph-date">Date</label>
                <input id="ph-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <button type="submit" className="ph-search__submit">
                Search trips
              </button>
            </div>
          </form>

          <div className="ph-stats" role="group" aria-label="Highlights">
            <div className="ph-stat">
              <div className="ph-stat__num">50+</div>
              <div className="ph-stat__label">Active routes</div>
            </div>
            <div className="ph-stat">
              <div className="ph-stat__num">10k+</div>
              <div className="ph-stat__label">Monthly passengers</div>
            </div>
            <div className="ph-stat">
              <div className="ph-stat__num">99%</div>
              <div className="ph-stat__label">On-time target</div>
            </div>
          </div>
        </section>

        <section className="ph-section ph__inner" id="about">
          <h2 className="ph-section__title">What is Bukidnon Transit?</h2>
          <p className="ph-section__sub">
            A passenger-facing layer on top of live GPS and terminal ticketing — designed for clarity, speed,
            and trust on every trip.
          </p>

          <div className="ph-grid">
            <article className="ph-card ph-grid__wide">
              <div className="ph-card__icon" aria-hidden>
                🛰️
              </div>
              <h3>Live fleet on the map</h3>
              <p>
                See buses moving in real time, not static timetables. Our platform listens to on-board GPS and
                pushes updates the moment your vehicle moves.
              </p>
            </article>

            <article className="ph-card ph-grid__feed">
              <div className="ph-feed__head">
                <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Terminal activity</h3>
                <span className="ph-feed__live">Live</span>
              </div>
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--ph-muted)" }}>
                Recent departures &amp; boarding — demo data; connect to your admin API.
              </p>
              {LIVE_DEPARTURES.map((row, i) => (
                <div className="ph-feed__item" key={i}>
                  <div className="ph-feed__row">
                    <div>
                      <div className="ph-feed__route">{row.route}</div>
                      <div className="ph-feed__meta">{row.detail}</div>
                    </div>
                    <span className="ph-feed__time">{row.time}</span>
                  </div>
                </div>
              ))}
            </article>

            <article className="ph-card">
              <div className="ph-card__icon" aria-hidden>
                🎫
              </div>
              <h3>Fair, fixed fares</h3>
              <p>Transparent ₱ pricing at the terminal with digital records operators and admins can audit.</p>
            </article>
          </div>
        </section>

        <section className="ph-section ph__inner" id="how">
          <h2 className="ph-section__title">How it works</h2>
          <p className="ph-section__sub">From search to seat — six simple steps.</p>
          <div className="ph-how">
            {[
              { icon: "🔍", title: "Search route", body: "Pick origin, destination, and travel date." },
              { icon: "💺", title: "Select seat", body: "Choose an available seat when booking opens." },
              { icon: "💳", title: "Secure payment", body: "Pay at the counter or via supported channels." },
              { icon: "📱", title: "Get QR ticket", body: "Receive a scannable pass for boarding." },
              { icon: "📍", title: "Track bus", body: "Follow live location and ETA on the map." },
              { icon: "✨", title: "Enjoy the trip", body: "Ride knowing when you’ll arrive." },
            ].map((step) => (
              <div className="ph-how__card" key={step.title}>
                <div className="ph-how__icon">{step.icon}</div>
                <h4>{step.title}</h4>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="ph-split ph__inner" id="faq">
          <div>
            <h2 className="ph-section__title" style={{ marginBottom: "0.75rem" }}>
              The power of real-time data
            </h2>
            <p className="ph-section__sub" style={{ marginBottom: "0" }}>
              When buses talk to the cloud, passengers get accurate ETAs and terminals get calmer queues. That
              is the backbone of this capstone — hardware, APIs, and apps in one loop.
            </p>
            <div className="ph-split__stats">
              <div className="ph-split__stat">
                <strong>5–10s</strong>
                <span>GPS ping cadence</span>
              </div>
              <div className="ph-split__stat">
                <strong>24/7</strong>
                <span>Monitoring-ready stack</span>
              </div>
            </div>
            <Link to="/dashboard" className="ph-btn ph-btn--primary">
              Open dashboard
            </Link>
          </div>
          <div>
            {[
              {
                icon: "🔎",
                title: "See before you go",
                text: "Check crowding and delay risk from live feeds instead of guessing at the curb.",
              },
              {
                icon: "🛡️",
                title: "Safer terminals",
                text: "Operators issue tickets with identity on file; admins can trace every record.",
              },
              {
                icon: "⚡",
                title: "Built for scale",
                text: "WebSockets for movement, REST for schedules — ready to grow with more routes.",
              },
            ].map((b) => (
              <div className="ph-benefit" key={b.title}>
                <div className="ph-benefit__icon" aria-hidden>
                  {b.icon}
                </div>
                <div>
                  <h4>{b.title}</h4>
                  <p>{b.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="ph-footer ph__inner">
        <p>
          © {new Date().getFullYear()} Bukidnon Transit · Capstone demo ·{" "}
          <a href="mailto:bukidnonbuscompany2025@gmail.com">Contact</a>
        </p>
      </footer>
    </div>
  );
}
