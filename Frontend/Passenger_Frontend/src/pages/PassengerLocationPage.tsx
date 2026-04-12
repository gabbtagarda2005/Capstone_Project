import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PassengerLogo } from "@/components/PassengerLogo";
import { fetchDeployedPoints, type DeployedPointItem } from "@/lib/fetchPassengerMapData";
import { logPassengerTerminalAffinity } from "@/lib/logPassengerTerminalAffinity";
import { findNearestDeployedTerminal } from "@/lib/passengerNearestTerminal";
import {
  isPassengerLocationGateCleared,
  setPassengerLocationGateCleared,
  setPassengerLocationSession,
} from "@/lib/passengerLocationGate";
import "./PassengerLandingPage.css";
import "./PassengerLocationPage.css";

export function PassengerLocationPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "requesting" | "denied" | "unsupported">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<DeployedPointItem[]>([]);
  const deployedRef = useRef<DeployedPointItem[]>([]);

  useEffect(() => {
    deployedRef.current = deployed;
  }, [deployed]);

  useEffect(() => {
    void fetchDeployedPoints()
      .then((rows) => setDeployed(rows))
      .catch(() => setDeployed([]));
  }, []);

  useEffect(() => {
    if (isPassengerLocationGateCleared()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  function goDashboard() {
    setPassengerLocationGateCleared();
    navigate("/dashboard", { replace: true });
  }

  async function requestLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      setHint("This browser does not support location. You can still open the dashboard.");
      return;
    }
    setHint(null);
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let items = deployedRef.current;
        if (items.length === 0) {
          try {
            items = await fetchDeployedPoints();
            setDeployed(items);
            deployedRef.current = items;
          } catch {
            items = [];
          }
        }
        const nearest = findNearestDeployedTerminal(lat, lng, items);
        setPassengerLocationSession({
          lat,
          lng,
          nearestCoverageId: nearest?.coverageId ?? null,
          nearestLabel: nearest?.label ?? "Nearest terminal",
          distanceKm: nearest?.distanceKm ?? 0,
        });
        void logPassengerTerminalAffinity(nearest?.coverageId ?? null);
        setPassengerLocationGateCleared();
        setStatus("idle");
        navigate("/dashboard", { replace: true });
      },
      (err) => {
        setStatus("denied");
        if (err.code === 1) {
          setHint(
            "Permission was blocked. Allow location in your browser settings (lock icon in the address bar), then tap Enable again."
          );
        } else {
          setHint(
            "We could not read your position. Check that location services are on for this device, then try again."
          );
        }
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 }
    );
  }

  return (
    <div className="ploc">
      <div className="ploc__gradient" aria-hidden />

      <header className="ph-nav ph-nav--transparent ploc__nav">
        <div className="ph__inner ph-nav__inner">
          <Link to="/" className="ph-nav__brand">
            <PassengerLogo />
            Bukidnon Transit
          </Link>
        </div>
      </header>

      <main className="ploc__main">
        <div className="ploc__card">
          <div className="ploc__hero">
            <div className="ploc__pin-outer" aria-hidden>
              <div className="ploc__pin-glow" />
              <div className="ploc__pin-ring" />
              <div className="ploc__pin-core">
                <svg className="ploc__pin-icon" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="11" r="2.25" fill="currentColor" />
                </svg>
              </div>
            </div>
            <h1 className="ploc__title">Find your nearest bus</h1>
            <p className="ploc__lead">
              Turn on location to continue. We use your approximate position to center the live map on your area, show
              nearby buses and ETAs, and match stops to where you actually wait — not a generic city view.
            </p>
          </div>

          <div className="ploc__grid">
            <section className="ploc__panel" aria-labelledby="ploc-why">
              <h2 id="ploc-why" className="ploc__panel-title">
                Why we ask
              </h2>
              <ul className="ploc__panel-list">
                <li className="ploc__panel-item">
                  <span className="ploc__mini-ico ploc__mini-ico--map" aria-hidden />
                  <div>
                    <strong>Accuracy</strong>
                    <p>Center the map on your area so terminals and buses line up with where you are.</p>
                  </div>
                </li>
                <li className="ploc__panel-item">
                  <span className="ploc__mini-ico ploc__mini-ico--bell" aria-hidden />
                  <div>
                    <strong>Relevant alerts</strong>
                    <p>Future updates can prioritize corridor notices for your side of the network.</p>
                  </div>
                </li>
                <li className="ploc__panel-item">
                  <span className="ploc__mini-ico ploc__mini-ico--shield" aria-hidden />
                  <div>
                    <strong>Safety &amp; planning</strong>
                    <p>See how far the next bus is from you — not from a fixed city center.</p>
                  </div>
                </li>
              </ul>
            </section>

            <section className="ploc__panel" aria-labelledby="ploc-benefits">
              <h2 id="ploc-benefits" className="ploc__panel-title">
                Benefits for you
              </h2>
              <ul className="ploc__benefits">
                <li>Faster orientation on the live map</li>
                <li>Less scrolling to find your corridor</li>
                <li>Better match to real-world waiting points</li>
              </ul>
            </section>
          </div>

          {hint ? (
            <p className="ploc__hint" role="status">
              {hint}
            </p>
          ) : null}

          <div className="ploc__actions">
            <button
              type="button"
              className="ploc__btn ploc__btn--primary"
              onClick={() => void requestLocation()}
              disabled={status === "requesting"}
            >
              {status === "requesting" ? "Getting your location…" : "Enable my location"}
            </button>
            {(status === "denied" || status === "unsupported") && (
              <button type="button" className="ploc__btn ploc__btn--ghost" onClick={goDashboard}>
                Continue without location
              </button>
            )}
          </div>

          <p className="ploc__privacy">
            Location stays in your browser session for map features. We do not upload your GPS coordinates — only an
            anonymous nearest-terminal tally may be recorded to improve service planning.
          </p>

          <div className="ploc__back">
            <Link to="/" className="ploc__btn ploc__btn--ghost">
              ← Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
