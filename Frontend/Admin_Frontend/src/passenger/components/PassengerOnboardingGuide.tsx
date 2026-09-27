import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./PassengerOnboardingGuide.css";

type GuideStep = {
  icon: string;
  title: string;
  description: string;
  howTo: string;
  preview: ReactNode;
};

/** Static, clearly-illustrative field mock — used for form-based features where there is no
 *  "live" value to show (the labels/order match the real component exactly; the values are
 *  example text, never presented as real trip data). */
function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div className="pog-mock-field">
      <span className="pog-mock-field__label">{label}</span>
      <span className="pog-mock-field__value">{value}</span>
    </div>
  );
}

function TapArrow({ label = "Tap here" }: { label?: string }) {
  return (
    <div className="pog-tap-arrow" aria-hidden>
      <span className="pog-tap-arrow__glyph">↓</span>
      <span className="pog-tap-arrow__label">{label}</span>
    </div>
  );
}

function RouteFarePreview() {
  return (
    <div className="pog-preview-card">
      <div className="pog-highlight-ring">
        <MockField label="Start location" value="Maramag Integrated Bus Terminal" />
        <MockField label="Destination location" value="Malaybalay Integrated Bus Terminal" />
        <MockField label="Passenger category" value="Regular" />
        <div className="pog-mock-fare">
          <span className="pog-mock-fare__label">Total fare</span>
          <span className="pog-mock-fare__value">₱169.00</span>
        </div>
      </div>
      <TapArrow label="Fill these in" />
    </div>
  );
}

function ArrivalAlarmPreview() {
  return (
    <div className="pog-preview-card">
      <div className="pog-highlight-ring">
        <MockField label="Notify me at" value="Valencia Integrated Bus Terminal" />
        <button type="button" className="pog-mock-btn" tabIndex={-1} aria-hidden>
          🔔 Set arrival alarm
        </button>
      </div>
      <TapArrow />
    </div>
  );
}

function StationFinderPreview() {
  return (
    <div className="pog-preview-card">
      <div className="pog-highlight-ring">
        <button type="button" className="pog-mock-btn pog-mock-btn--wide" tabIndex={-1} aria-hidden>
          Use Nearest Station — <strong>Maramag Integrated Bus Terminal</strong>
        </button>
        <div className="pog-mock-station">
          <div className="pog-mock-station__name">Valencia Integrated Bus Terminal</div>
          <div className="pog-mock-station__meta">1.2 km · ~15 min walk</div>
          <button type="button" className="pog-mock-btn pog-mock-btn--small" tabIndex={-1} aria-hidden>
            Navigate
          </button>
        </div>
      </div>
      <p className="pog-note">
        🟡 GPS accuracy is low? Move to an open area for a more accurate location — that&apos;s the same
        warning you&apos;ll see live if your signal is weak.
      </p>
      <TapArrow label="Tap Navigate" />
    </div>
  );
}

function FeedbackPreview() {
  return (
    <div className="pog-preview-card">
      <div className="pog-highlight-ring">
        <MockField label="Mainly about" value="Route, stop, or terminal" />
        <div className="pog-mock-stars" aria-hidden>
          {"★★★★★"}
        </div>
        <button type="button" className="pog-mock-btn" tabIndex={-1} aria-hidden>
          Send
        </button>
      </div>
      <p className="pog-note">Other categories: Bus or vehicle, Driver, Bus attendant.</p>
      <TapArrow />
    </div>
  );
}

function LostFoundPreview() {
  return (
    <div className="pog-preview-card">
      <div className="pog-highlight-ring">
        <MockField label="Date last seen (optional)" value="09/27/2026" />
        <MockField label="Bus you were on (optional)" value="Not sure / different bus" />
        <MockField label="Your email (optional)" value="—" />
        <MockField label="Details" value="Left a black backpack on the back row." />
        <button type="button" className="pog-mock-btn" tabIndex={-1} aria-hidden>
          Submit
        </button>
      </div>
      <TapArrow label="Tap Submit" />
    </div>
  );
}

/** Fallback shown for the Quick ETA step only when no live bus data is available yet — clearly
 *  labeled as an example, never presented as a real bus. */
function QuickEtaFallbackPreviewInline() {
  return (
    <>
      <div className="pog-mock-eta">
        <div className="pog-mock-eta__head">
          <span>EXAMPLE BUS</span>
          <span className="pog-mock-eta__status">ACTIVE</span>
        </div>
        <div className="pog-mock-eta__hero">
          <span className="pog-mock-eta__hero-cap">ETA</span>
          <span className="pog-mock-eta__hero-val">~4 min</span>
        </div>
        <p className="pog-mock-eta__foot">Maramag Terminal → Malaybalay Terminal</p>
      </div>
    </>
  );
}

function buildSteps(etaPreview: ReactNode | null): GuideStep[] {
  return [
    {
      icon: "🚌",
      title: "Quick ETA — Find Your Bus",
      description: "See the next buses available from live dispatch.",
      howTo: "Tap a bus card to view its route, destination, estimated arrival time, and capacity information.",
      preview: (
        <div className="pog-preview-card">
          <div className="pog-highlight-ring pog-highlight-ring--live">
            {etaPreview ?? <QuickEtaFallbackPreviewInline />}
          </div>
          <TapArrow />
        </div>
      ),
    },
    {
      icon: "🗺️",
      title: "Route & Fare — Plan Your Trip",
      description: "Check the available route and estimate your fare before traveling.",
      howTo:
        "Select your starting location, destination, and passenger category. The system will calculate the estimated fare.",
      preview: <RouteFarePreview />,
    },
    {
      icon: "🔔",
      title: "Arrival Alarm — Don't Miss Your Stop",
      description: "Set a notification for your selected stop or terminal.",
      howTo:
        "Select your stop or terminal, then tap Set arrival alarm. Once armed, the app rings and vibrates your phone when you're there.",
      preview: <ArrivalAlarmPreview />,
    },
    {
      icon: "📍",
      title: "Find a Bus Station — Find Nearby Terminals",
      description: "Find registered bus terminals near your current location.",
      howTo: "Allow location access, choose a nearby registered terminal, then tap Navigate for walking directions.",
      preview: <StationFinderPreview />,
    },
    {
      icon: "💬",
      title: "Send Feedback — Share Your Experience",
      description: "Help improve the passenger experience by sending feedback about your trip.",
      howTo: "Choose what your feedback is about, provide a rating and details, then tap Send.",
      preview: <FeedbackPreview />,
    },
    {
      icon: "🔎",
      title: "Left Something? — Report a Lost Item",
      description: "Report an item you may have left on a bus.",
      howTo: "Provide when you last saw the item, select the bus if known, describe the item, and submit the report.",
      preview: <LostFoundPreview />,
    },
  ];
}

type Phase = "welcome" | number | "done";

export function PassengerOnboardingGuide({
  open,
  onClose,
  onStartTracking,
  etaPreview,
}: {
  open: boolean;
  /** Called whenever the guide is dismissed (Skip, Finish, backdrop, Escape, close button). */
  onClose: () => void;
  /** Called when the user taps "Start Tracking" on the completion screen. */
  onStartTracking: () => void;
  /** The real, currently-live top Quick ETA tile, if any (rendered read-only inside the guide). */
  etaPreview?: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("welcome");
  const panelRef = useRef<HTMLDivElement>(null);
  const steps = useMemo(() => buildSteps(etaPreview ?? null), [etaPreview]);
  const totalSteps = steps.length;

  useEffect(() => {
    if (open) setPhase("welcome");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open, phase]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const stepIndex = typeof phase === "number" ? phase : null;
  const headingId = "pog-heading";

  function goNext() {
    if (phase === "welcome") {
      setPhase(0);
      return;
    }
    if (typeof phase === "number") {
      if (phase + 1 >= totalSteps) {
        setPhase("done");
      } else {
        setPhase(phase + 1);
      }
    }
  }

  function goBack() {
    if (typeof phase === "number") {
      if (phase === 0) setPhase("welcome");
      else setPhase(phase - 1);
    } else if (phase === "done") {
      setPhase(totalSteps - 1);
    }
  }

  return (
    <div className="pog-overlay" role="presentation">
      <button type="button" className="pog-overlay__backdrop" aria-label="Close quick guide" onClick={onClose} />
      <div
        className="pog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panelRef}
        tabIndex={-1}
      >
        {phase === "welcome" ? (
          <div className="pog-welcome">
            <p className="pog-eyebrow">Passenger Quick Guide</p>
            <h1 id={headingId} className="pog-welcome__title">
              Welcome to Bukidnon Bus Company
            </h1>
            <p className="pog-welcome__body">
              Your quick guide to using the passenger app. Learn how to track buses, check routes and fares, set
              arrival alarms, find terminals, and use passenger services.
            </p>
            <div className="pog-actions">
              <button type="button" className="pog-btn pog-btn--ghost" onClick={onClose}>
                Skip for now
              </button>
              <button type="button" className="pog-btn pog-btn--primary" onClick={goNext}>
                Start Quick Guide
              </button>
            </div>
          </div>
        ) : null}

        {stepIndex != null ? (
          <div className="pog-step">
            <div className="pog-progress" aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
              <span className="pog-progress__label">
                Step {stepIndex + 1} of {totalSteps}
              </span>
              <div className="pog-progress__dots" aria-hidden>
                {steps.map((_, i) => (
                  <span key={i} className={"pog-progress__dot" + (i === stepIndex ? " pog-progress__dot--active" : i < stepIndex ? " pog-progress__dot--done" : "")} />
                ))}
              </div>
            </div>

            <h2 id={headingId} className="pog-step__title">
              <span aria-hidden>{steps[stepIndex]!.icon}</span> {steps[stepIndex]!.title}
            </h2>
            <p className="pog-step__desc">{steps[stepIndex]!.description}</p>

            {steps[stepIndex]!.preview}

            <div className="pog-step__howto">
              <span className="pog-step__howto-label">How to use it</span>
              <p>{steps[stepIndex]!.howTo}</p>
            </div>

            <div className="pog-actions">
              <button type="button" className="pog-btn pog-btn--ghost" onClick={goBack}>
                ← Back
              </button>
              <button type="button" className="pog-btn pog-btn--text" onClick={onClose}>
                Skip for now
              </button>
              <button type="button" className="pog-btn pog-btn--primary" onClick={goNext}>
                {stepIndex + 1 >= totalSteps ? "Finish" : "Next →"}
              </button>
            </div>
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="pog-done">
            <p className="pog-eyebrow">🎉 You&apos;re ready to go!</p>
            <h1 id={headingId} className="pog-done__title">
              You can now:
            </h1>
            <ul className="pog-done__list">
              <li>✓ Track buses</li>
              <li>✓ View routes and fares</li>
              <li>✓ Set arrival alarms</li>
              <li>✓ Find nearby terminals</li>
              <li>✓ Send feedback</li>
              <li>✓ Report lost items</li>
            </ul>
            <div className="pog-actions pog-actions--center">
              <button type="button" className="pog-btn pog-btn--ghost" onClick={goBack}>
                ← Back
              </button>
              <button type="button" className="pog-btn pog-btn--primary" onClick={onStartTracking}>
                Start Tracking
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
