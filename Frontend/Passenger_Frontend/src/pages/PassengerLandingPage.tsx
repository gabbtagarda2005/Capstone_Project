import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicCompanyProfile } from "@/lib/fetchPublicCompanyProfile";
import { fetchPublicPassengerHighlights } from "@/lib/fetchPublicPassengerHighlights";
import { splitPassengerCompanyWordmark } from "@/lib/splitPassengerCompanyWordmark";
import "./PassengerLandingPage.css";

export function PassengerLandingPage() {
  const [companyName, setCompanyName] = useState("");
  const [activeRoutes, setActiveRoutes] = useState<number | null>(null);
  const [monthlyPassengers, setMonthlyPassengers] = useState<number | null>(null);
  const [onTimeTargetPct, setOnTimeTargetPct] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([fetchPublicCompanyProfile(), fetchPublicPassengerHighlights()]).then(([profile, highlights]) => {
      if (cancelled) return;

      if (profile.status === "fulfilled") {
        setCompanyName(profile.value.name);
      }

      if (highlights.status === "fulfilled") {
        setActiveRoutes(highlights.value.activeRoutes);
        setMonthlyPassengers(highlights.value.monthlyPassengers);
        setOnTimeTargetPct(highlights.value.onTimeTargetPct);
      } else {
        void fetch("http://localhost:4001/api/public/passenger-highlights")
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("highlights fallback failed"))))
          .then((d: { activeRoutes?: number; monthlyPassengers?: number; onTimeTargetPct?: number | null }) => {
            if (cancelled) return;
            if (Number.isFinite(Number(d.activeRoutes))) setActiveRoutes(Math.max(0, Math.round(Number(d.activeRoutes))));
            if (Number.isFinite(Number(d.monthlyPassengers))) {
              setMonthlyPassengers(Math.max(0, Math.round(Number(d.monthlyPassengers))));
            }
            if (d.onTimeTargetPct == null) {
              setOnTimeTargetPct(null);
            } else if (Number.isFinite(Number(d.onTimeTargetPct))) {
              setOnTimeTargetPct(Math.max(0, Math.min(100, Math.round(Number(d.onTimeTargetPct)))));
            }
          })
          .catch(() => {
            /* keep placeholders */
          });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const { lead, rest } = splitPassengerCompanyWordmark(companyName);
  const monthlyPassengersLabel =
    monthlyPassengers == null ? "--" : new Intl.NumberFormat("en-PH").format(monthlyPassengers);
  const activeRoutesLabel = activeRoutes == null ? "--" : new Intl.NumberFormat("en-PH").format(activeRoutes);
  const onTimeLabel = onTimeTargetPct == null ? "--" : `${onTimeTargetPct}%`;

  return (
    <div className="ph">
      <div className="ph__ribbons" aria-hidden />

      <header className="ph-nav ph-nav--transparent">
        <div className="ph__inner ph-nav__inner">
          <Link to="/" className="ph-nav__brand ph-brand-wordmark" aria-label="Home">
            <span className="ph-brand-wordmark__lead">{lead}</span>
            {rest ? <span className="ph-brand-wordmark__rest">{rest}</span> : null}
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
              <div className="ph-hero__actions">
                <Link to="/dashboard" className="ph-btn ph-btn--primary ph-hero__cta">
                  Get Started
                </Link>
              </div>
              <div id="highlights" className="ph-stats" role="group" aria-label="Highlights">
                <div className="ph-stat">
                  <div className="ph-stat__num">{activeRoutesLabel}</div>
                  <div className="ph-stat__label">Active routes</div>
                </div>
                <div className="ph-stat">
                  <div className="ph-stat__num">{monthlyPassengersLabel}</div>
                  <div className="ph-stat__label">Monthly passengers</div>
                </div>
                <div className="ph-stat">
                  <div className="ph-stat__num">{onTimeLabel}</div>
                  <div className="ph-stat__label">On-time target</div>
                </div>
              </div>
            </div>
          </div>
          <footer className="ph-footer ph-footer--in-part" id="footer">
            <p>
              © {new Date().getFullYear()} · Capstone Project.
            </p>
          </footer>
        </section>
      </main>
    </div>
  );
}
