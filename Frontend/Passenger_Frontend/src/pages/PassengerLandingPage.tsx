import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PassengerLogo } from "@/components/PassengerLogo";
import { fetchPublicCompanyProfile } from "@/lib/fetchPublicCompanyProfile";
import "./PassengerLandingPage.css";

export function PassengerLandingPage() {
  const [companyName, setCompanyName] = useState("Bukidnon Transit");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicCompanyProfile()
      .then((p) => {
        if (!cancelled) {
          setCompanyName(p.name);
          setLogoUrl(p.logoUrl);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ph">
      <div className="ph__ribbons" aria-hidden />

      <header className="ph-nav ph-nav--transparent">
        <div className="ph__inner ph-nav__inner">
          <Link to="/" className="ph-nav__brand">
            <PassengerLogo logoUrl={logoUrl} />
            {companyName}
          </Link>
        </div>
      </header>

      <main className="ph-main">
        <section className="ph-part ph-part--1" id="top" aria-label="Welcome">
          <div className="ph__inner ph-part--1__body">
            <div className="ph-hero">
              <h1 className="ph-hero__title">
                Know Your Ride Before <span className="ph-gradient">Your Bus Departs</span>
              </h1>
              <p className="ph-hero__sub">
                Real-time ETAs, live vehicle positions, and clear fares for routes across Bukidnon, so you spend less
                time waiting and more time moving.
              </p>
              <Link to="/enable-location" className="ph-btn ph-btn--primary ph-hero__cta">
                Get Started
              </Link>
              <div id="highlights" className="ph-stats" role="group" aria-label="Highlights">
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
            </div>
          </div>
          <footer className="ph-footer ph-footer--in-part" id="footer">
            <p>
              © {new Date().getFullYear()} {companyName} · Capstone Project.
            </p>
          </footer>
        </section>
      </main>
    </div>
  );
}
