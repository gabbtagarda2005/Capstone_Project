import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchDeployedPoints, type DeployedPointItem } from "@/lib/fetchPassengerMapData";
import { fetchPublicFleetBuses, type PublicFleetBus } from "@/lib/fetchPublicFleetBuses";
import {
  fetchPublicFareQuote,
  type FareCategoryUi,
  type PublicFareQuoteOk,
  type PublicFareQuoteResponse,
} from "@/lib/fetchPublicFareQuote";
import { fetchPublicPostJson } from "@/lib/fetchWithPublicApiBases";
import { routeEndpointsFromLabel } from "@/lib/routeEndpointsFromLabel";
import { usePassengerLiveLocation } from "@/lib/usePassengerLiveLocation";
import { rankDeployedTerminalsByDistance } from "@/lib/passengerNearestTerminal";
import { PassengerArrivalAlarm } from "@/components/PassengerArrivalAlarm";
import "./PassengerTacticalPanels.css";
import "./PassengerTacticalHub.css";

const CATEGORIES: { id: FareCategoryUi; label: string }[] = [
  { id: "regular", label: "Regular" },
  { id: "student", label: "Student" },
  { id: "senior", label: "Senior" },
  { id: "pwd", label: "PWD" },
];

function collectLocationLabels(rows: DeployedPointItem[]): string[] {
  const labels = new Set<string>();
  for (const r of rows) {
    if (r.locationName?.trim()) labels.add(r.locationName.trim());
    if (r.terminal?.name?.trim()) labels.add(r.terminal.name.trim());
    for (const s of r.stops || []) {
      if (s.name?.trim()) labels.add(s.name.trim());
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/* Arrival notification feature removed per user request. */

export type PassengerRouteCalculatorProps = {
  onClose?: () => void;
};

export function PassengerRouteCalculator({ onClose }: PassengerRouteCalculatorProps) {
  const [deployedRows, setDeployedRows] = useState<DeployedPointItem[]>([]);
  const [locationOptions, setLocationOptions] = useState<string[]>([]);
  const [origin, setOrigin] = useState("");
  const [originAutoFilled, setOriginAutoFilled] = useState(false);
  const originEditedRef = useRef(false);
  const [destination, setDestination] = useState("");
  const [category, setCategory] = useState<FareCategoryUi>("regular");
  const [quote, setQuote] = useState<PublicFareQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [fareBump, setFareBump] = useState(false);
  const prevCategory = useRef(category);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!onClose) return;
    const close = onClose;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const liveLocation = usePassengerLiveLocation(true);

  useEffect(() => {
    let cancelled = false;
    fetchDeployedPoints()
      .then((rows) => {
        if (cancelled) return;
        setDeployedRows(rows);
        setLocationOptions(collectLocationLabels(rows));
      })
      .catch(() => {
        if (!cancelled) {
          setDeployedRows([]);
          setLocationOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-detect the passenger's current location to suggest a starting terminal — never
  // overwrites an origin the passenger has typed/selected themselves.
  useEffect(() => {
    if (originEditedRef.current) return;
    if (!liveLocation.position || deployedRows.length === 0 || locationOptions.length === 0) return;
    const ranked = rankDeployedTerminalsByDistance(liveLocation.position.lat, liveLocation.position.lng, deployedRows);
    const nearest = ranked[0];
    if (!nearest) return;
    const label = locationOptions.includes(nearest.name)
      ? nearest.name
      : locationOptions.includes(nearest.locationName)
        ? nearest.locationName
        : null;
    if (!label) return;
    setOrigin(label);
    setOriginAutoFilled(true);
  }, [liveLocation.position, deployedRows, locationOptions]);

  function handleOriginChange(next: string) {
    originEditedRef.current = true;
    setOriginAutoFilled(false);
    setOrigin(next);
  }

  useEffect(() => {
    if (prevCategory.current !== category) {
      prevCategory.current = category;
      setFareBump(true);
      const t = window.setTimeout(() => setFareBump(false), 520);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [category]);

  const runQuote = useCallback(async () => {
    const o = origin.trim();
    const d = destination.trim();
    if (!o || !d) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const r = await fetchPublicFareQuote({
        startLocation: o,
        destination: d,
        passengerCategory: category,
      });
      setQuote(r);
    } catch (e) {
      setQuote(null);
      setQuoteError(e instanceof Error ? e.message : "Could not get fare.");
    } finally {
      setQuoteLoading(false);
    }
  }, [origin, destination, category]);

  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    const o = origin.trim();
    const d = destination.trim();
    if (!o || !d) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void runQuote();
    }, 420);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [origin, destination, category, runQuote]);

  const okQuote = quote && quote.matched ? (quote as PublicFareQuoteOk) : null;

  const fareExplain = (() => {
    if (!okQuote) return "";
    return String(okQuote.fareBreakdownDisplay || okQuote.pricingSummary || "").trim();
  })();

  const needsBothLocations = Boolean(origin.trim() && destination.trim());

  const breakdown = useMemo(() => {
    if (!okQuote) return null;
    const base = Number(okQuote.baseFarePesos);
    const dist = Number(okQuote.distanceChargePesos) || 0;
    const sub = Number(okQuote.subtotalRoundedHalfPeso);
    const disc = Number(okQuote.discountAmount) || 0;
    const pct = Number(okQuote.discountPct) || 0;
    return {
      base: Number.isFinite(base) ? base : null,
      dist,
      sub: Number.isFinite(sub) ? sub : null,
      disc,
      pct,
      total: okQuote.fare,
    };
  }, [okQuote]);

  const showSelects = locationOptions.length >= 2;

  return (
    <div className="pd-tactical pd-check-buses pd-check-buses--feed pd-check-buses--planner-split" role="region" aria-label="Trip planner">
      <div className="pd-check-buses__planner-inner">
        <div className="pd-check-buses__planner-col pd-check-buses__planner-col--fare">
      <div className="pd-board__wrap pd-check-buses__fare-glass">
        <div className="pd-check-buses__pad">
          <h2 className="pd-check-buses__block-title">Fare estimate</h2>
          <div className="pd-fare-engine__grid pd-fare-engine__grid--trips">
            <label className="pd-fare-engine__field">
              <span className="pd-fare-engine__label">Start location</span>
              {showSelects ? (
                <select
                  className="pd-fare-select"
                  value={origin}
                  onChange={(e) => handleOriginChange(e.target.value)}
                >
                  <option value="">Select origin…</option>
                  {locationOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="pd-fare-select pd-fare-select--text"
                  value={origin}
                  onChange={(e) => handleOriginChange(e.target.value)}
                  placeholder="e.g. Valencia Terminal"
                  autoComplete="off"
                />
              )}
              {originAutoFilled ? (
                <p className="pd-fare-engine__hint" role="status">
                  📍 Using your current location
                </p>
              ) : null}
            </label>
            <label className="pd-fare-engine__field">
              <span className="pd-fare-engine__label">Destination location</span>
              {showSelects ? (
                <select
                  className="pd-fare-select"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Select destination…</option>
                  {locationOptions.map((opt) => (
                    <option key={`d-${opt}`} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="pd-fare-select pd-fare-select--text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Malaybalay South"
                  autoComplete="off"
                />
              )}
            </label>
            <label className="pd-fare-engine__field pd-fare-engine__field--category">
              <span className="pd-fare-engine__label">Passenger category</span>
              <select
                className="pd-fare-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as FareCategoryUi)}
                aria-label="Passenger category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <div
              className={
                "pd-fare-total pd-fare-total--compact pd-fare-total--price-tag" +
                (fareBump ? " pd-fare-total--bump" : "")
              }
              aria-live="polite"
            >
              <span className="pd-fare-total__label">Total fare</span>
              <span className="pd-fare-total__amount">
                {!needsBothLocations ? (
                  <span className="pd-fare-total__placeholder">Choose start and destination</span>
                ) : quoteLoading ? (
                  <span className="pd-fare-total__loading">Calculating…</span>
                ) : okQuote ? (
                  `₱${okQuote.fare.toFixed(2)}`
                ) : quote && !quote.matched ? (
                  <span className="pd-fare-total__placeholder">Not priced for this pair</span>
                ) : quoteError ? (
                  <span className="pd-fare-total__placeholder">Could not load fare</span>
                ) : (
                  <span className="pd-fare-total__placeholder">Getting fare…</span>
                )}
              </span>
            </div>
          </div>

          <PassengerArrivalAlarm />

          {fareExplain ? (
            <p className="pd-fare-engine__breakdown-explain" role="status">
              {fareExplain}
            </p>
          ) : null}

          {breakdown && okQuote ? (
            <div className="pd-fare-breakdown">
              <div className="pd-fare-breakdown__row">
                <span>Base fare</span>
                <span className="pd-fare-breakdown__num">
                  {breakdown.base != null ? `₱${breakdown.base.toFixed(2)}` : "—"}
                </span>
              </div>
              <div className="pd-fare-breakdown__row">
                <span>Distance fare</span>
                <span className="pd-fare-breakdown__num">₱{breakdown.dist.toFixed(2)}</span>
              </div>
              {breakdown.sub != null ? (
                <div className="pd-fare-breakdown__row pd-fare-breakdown__row--sub">
                  <span>Subtotal</span>
                  <span className="pd-fare-breakdown__num">₱{breakdown.sub.toFixed(2)}</span>
                </div>
              ) : null}
              {breakdown.pct > 0 ? (
                <div className="pd-fare-breakdown__row pd-fare-breakdown__row--disc">
                  <span>Discount ({breakdown.pct}%)</span>
                  <span className="pd-fare-breakdown__num">−₱{breakdown.disc.toFixed(2)}</span>
                </div>
              ) : null}
              <div className="pd-fare-breakdown__row pd-fare-breakdown__row--total">
                <span>Total</span>
                <span className="pd-fare-breakdown__num">₱{breakdown.total.toFixed(2)}</span>
              </div>
            </div>
          ) : null}

          {!okQuote && quote && !quote.matched ? (
            <p className="pd-fare-engine__hint pd-fare-engine__hint--warn" role="status">
              {quote.message}
            </p>
          ) : null}
          {quoteError ? (
            <p className="pd-fare-engine__hint pd-fare-engine__hint--err" role="alert">
              {quoteError}
            </p>
          ) : null}
        </div>
      </div>
        </div>

      </div>
    </div>
  );
}

function shortTerminalLabel(full: string): string {
  const t = full.trim();
  if (!t) return "—";
  const first = t.split(",")[0]?.trim();
  return first || t;
}

/** Start → end terminals (or corridor) for the bus assignment — not the raw "ROUTE 1" code. */
function fleetRouteLocationLabel(bus: PublicFleetBus): string {
  const a = bus.routeStart?.trim();
  const b = bus.routeEnd?.trim();
  if (a && b) {
    return `${shortTerminalLabel(a)} → ${shortTerminalLabel(b)}`;
  }
  if (a) return shortTerminalLabel(a);
  if (b) return shortTerminalLabel(b);
  const parsed = routeEndpointsFromLabel(bus.route);
  if (parsed.start !== "—" && parsed.end !== "—") {
    return `${shortTerminalLabel(parsed.start)} → ${shortTerminalLabel(parsed.end)}`;
  }
  if (parsed.start !== "—") return shortTerminalLabel(parsed.start);
  if (parsed.end !== "—") return shortTerminalLabel(parsed.end);
  const raw = bus.route?.trim();
  return raw || "Route not assigned";
}

const LOST_BUS_UNSURE = "__unsure";

function lostBusLabel(b: PublicFleetBus): string {
  const num = b.busNumber?.trim() || b.busId;
  const route = fleetRouteLocationLabel(b);
  return route && route !== "Route not assigned" ? `${num} — ${route}` : num;
}

export function PassengerLostFound() {
  const [when, setWhen] = useState("");
  const [busChoice, setBusChoice] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fleetOptions, setFleetOptions] = useState<PublicFleetBus[]>([]);
  const [fleetLoading, setFleetLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchPublicFleetBuses()
      .then((rows) => {
        if (!cancelled) setFleetOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setFleetOptions([]);
      })
      .finally(() => {
        if (!cancelled) setFleetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const emailOk = useMemo(() => {
    const t = email.trim();
    if (!t) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  }, [email]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFormError(null);
    if (email.trim() && !emailOk) {
      setFormError("That email doesn't look right — fix it or leave the field blank.");
      return;
    }
    setPending(true);
    try {
      const sel = fleetOptions.find((b) => b.busId === busChoice);
      const busLabel =
        busChoice === LOST_BUS_UNSURE ? "Not sure / different bus" : sel ? lostBusLabel(sel) : busChoice;
      const lastSeenAt = when ? new Date(when).toISOString() : "";
      await fetchPublicPostJson<Record<string, unknown>>("/api/public/passenger-lost-item", {
        lastSeenAt,
        busId: busChoice,
        busLabel,
        email: email.trim(),
        details: note.trim(),
      });
      setSent(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not send report. Try again.");
    } finally {
      setPending(false);
    }
  }

  /** Every field is optional — an incomplete report is still better than none. Only a malformed (non-empty) email blocks sending. */
  const canSubmit = !email.trim() || emailOk;

  return (
    <div className="pd-tactical pd-lost pd-hub pd-tactical--centered" role="region" aria-label="Left something">
      <form className="pd-fb-card pd-fb-card--lg pd-fb-card--glass-passenger" onSubmit={(ev) => void submit(ev)} noValidate>
        <h1 className="pd-fb-card__title">Left something?</h1>
        <p className="pd-fb-card__hint">
          Note when you last had it and what it looks like — terminal staff will match against the registry.
        </p>

        <label className="pd-fb-card__field-label" htmlFor="pd-lost-when">
          Date &amp; time last seen <span className="pd-fb-card__optional">(optional)</span>
        </label>
        <input
          id="pd-lost-when"
          type="datetime-local"
          className="pd-fb-card__input pd-fb-card__input--datetime"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />

        <label className="pd-fb-card__field-label" htmlFor="pd-lost-bus">
          Bus you were on <span className="pd-fb-card__optional">(optional)</span>
        </label>
        <select
          id="pd-lost-bus"
          className="pd-fb-card__select"
          value={busChoice}
          onChange={(e) => setBusChoice(e.target.value)}
          disabled={fleetLoading}
          aria-busy={fleetLoading}
        >
          <option value="">{fleetLoading ? "Loading buses…" : "Choose a bus"}</option>
          {fleetOptions.map((b) => (
            <option key={b.busId} value={b.busId}>
              {lostBusLabel(b)}
            </option>
          ))}
          <option value={LOST_BUS_UNSURE}>Not sure / different bus</option>
        </select>
        {!fleetLoading && fleetOptions.length === 0 ? (
          <p className="pd-lost__fleet-hint" role="note">
            Bus list is unavailable — pick &quot;Not sure&quot; and name the route or bus number in Details.
          </p>
        ) : null}

        <label className="pd-fb-card__field-label" htmlFor="pd-lost-email">
          Your email <span className="pd-fb-card__optional">(optional)</span>
        </label>
        <input
          id="pd-lost-email"
          type="email"
          className="pd-fb-card__input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          aria-invalid={email.length > 0 && !emailOk}
        />
        {email.length > 0 && !emailOk ? (
          <p className="pd-lost__field-err" role="alert">
            Enter a valid email so staff can reach you.
          </p>
        ) : null}

        <label className="pd-fb-card__field-label" htmlFor="pd-lost-note">
          Details
        </label>
        <textarea
          id="pd-lost-note"
          className="pd-fb-card__textarea pd-fb-card__textarea--lg"
          rows={6}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='e.g. "I left my phone on the seat" — add color, case, seat row, and anything else that helps staff match you to the registry.'
        />

        <div className="pd-fb-card__toolbar" role="group" aria-label="Submit report">
          <button
            type="submit"
            className="pd-fb-card__send pd-fb-card__send--conversation"
            disabled={!canSubmit || pending}
            aria-busy={pending}
            aria-label="Submit lost item report"
          >
            {pending ? (
              <span className="pd-fb-card__send-label" aria-live="polite">
                Sending…
              </span>
            ) : (
              <>
                <svg
                  className="pd-fb-card__send-icon"
                  fill="none"
                  viewBox="0 0 24 24"
                  height="26"
                  width="26"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <path
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeWidth="1.5"
                    d="M7.39999 6.32003L15.89 3.49003C19.7 2.22003 21.77 4.30003 20.51 8.11003L17.68 16.6C15.78 22.31 12.66 22.31 10.76 16.6L9.91999 14.08L7.39999 13.24C1.68999 11.34 1.68999 8.23003 7.39999 6.32003Z"
                  />
                  <path strokeLinejoin="round" strokeLinecap="round" strokeWidth="1.5" d="M10.11 13.6501L13.69 10.0601" />
                </svg>
                <span className="pd-fb-card__send-text">Submit</span>
              </>
            )}
          </button>
        </div>

        {formError ? (
          <p className="pd-lost__field-err" role="alert">
            {formError}
          </p>
        ) : null}

        {sent ? (
          <p className="pd-fb-card__ack" role="status">
            Logged. Terminal staff will match against the registry
            {email.trim() ? ` and may contact you at ${email.trim()}` : ""}. Admins are notified in the command feed
            (bell) and by email when SOS/company mail is configured.
          </p>
        ) : null}
      </form>
    </div>
  );
}
