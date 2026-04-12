import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchDeployedPoints, type DeployedPointItem } from "@/lib/fetchPassengerMapData";
import { fetchPublicFleetBuses, type PublicFleetBus } from "@/lib/fetchPublicFleetBuses";
import {
  fetchPublicFareQuote,
  type FareCategoryUi,
  type PublicFareQuoteOk,
  type PublicFareQuoteResponse,
} from "@/lib/fetchPublicFareQuote";
import { bestEtaByBusId, fetchPublicLiveBoard } from "@/lib/fetchPublicLiveBoard";
import { routeEndpointsFromLabel } from "@/lib/routeEndpointsFromLabel";
import { getPassengerLocationSession } from "@/lib/passengerLocationGate";
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

export type PassengerRouteCalculatorProps = {
  onClose?: () => void;
};

export function PassengerRouteCalculator({ onClose }: PassengerRouteCalculatorProps) {
  const [locationOptions, setLocationOptions] = useState<string[]>([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [category, setCategory] = useState<FareCategoryUi>("regular");
  const [quote, setQuote] = useState<PublicFareQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [fareBump, setFareBump] = useState(false);
  const prevCategory = useRef(category);
  const debounceRef = useRef<number | null>(null);

  const [fleet, setFleet] = useState<PublicFleetBus[] | null>(null);
  const [fleetErr, setFleetErr] = useState<string | null>(null);
  const [liveBoard, setLiveBoard] = useState<Awaited<ReturnType<typeof fetchPublicLiveBoard>> | null>(null);
  const [liveBoardErr, setLiveBoardErr] = useState<string | null>(null);

  useEffect(() => {
    if (!onClose) return;
    const close = onClose;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const s = getPassengerLocationSession();
    if (s?.nearestLabel) {
      setOrigin((o) => (o.trim() ? o : s.nearestLabel));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchDeployedPoints()
      .then((rows) => {
        if (!cancelled) setLocationOptions(collectLocationLabels(rows));
      })
      .catch(() => {
        if (!cancelled) setLocationOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPublicFleetBuses()
      .then((items) => {
        if (!cancelled) {
          setFleet(items);
          setFleetErr(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setFleet([]);
          setFleetErr(e instanceof Error ? e.message : "Could not load fleet list.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPublicLiveBoard()
      .then((items) => {
        if (!cancelled) {
          setLiveBoard(items);
          setLiveBoardErr(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLiveBoard([]);
          setLiveBoardErr(e instanceof Error ? e.message : "Could not load ETAs.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const etaByBusId = useMemo(() => bestEtaByBusId(liveBoard ?? []), [liveBoard]);

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
    <div className="pd-fare-modal-root" role="presentation">
      <div className="pd-fare-modal__backdrop" aria-hidden />
      <div className="pd-fare-stack" role="group" aria-label="Fare engine and fleet">
        <div className="pd-fare-split">
        <div className="pd-fare-engine glass-panel" role="dialog" aria-modal="true" aria-labelledby="pd-fare-engine-title">
          <div className="pd-fare-engine__head">
            <div>
              <h1 id="pd-fare-engine-title" className="pd-fare-engine__title">
                Interactive fare engine
              </h1>
            </div>
            {onClose ? (
              <button type="button" className="pd-fare-engine__close" onClick={onClose} aria-label="Close">
                ×
              </button>
            ) : null}
          </div>

          <div className="pd-fare-engine__grid">
            <label className="pd-fare-engine__field">
              <span className="pd-fare-engine__label">Start location</span>
              {showSelects ? (
                <select
                  className="pd-fare-select"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
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
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="e.g. Valencia Terminal"
                  autoComplete="off"
                />
              )}
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
          </div>

          <div className="pd-fare-engine__chips" role="group" aria-label="Passenger category">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={"pd-fare-chip" + (category === c.id ? " pd-fare-chip--active" : "")}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className={"pd-fare-total" + (fareBump ? " pd-fare-total--bump" : "")} aria-live="polite">
            <span className="pd-fare-total__label">Total fare</span>
            <span className="pd-fare-total__amount">
              {quoteLoading ? (
                <span className="pd-fare-total__loading">Calculating…</span>
              ) : okQuote ? (
                `₱${okQuote.fare.toFixed(2)}`
              ) : (
                "—"
              )}
            </span>
          </div>

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
          {okQuote?.fareBreakdownDisplay ? (
            <p className="pd-fare-engine__hint pd-fare-engine__hint--mono">{okQuote.fareBreakdownDisplay}</p>
          ) : null}
        </div>

        <section className="pd-fare-fleet-section glass-panel" aria-labelledby="pd-fare-fleet-title">
          <h2 id="pd-fare-fleet-title" className="pd-fare-fleet-section__title">
            Fleet operations
          </h2>
          <p className="pd-fare-fleet-section__sub">Registry and live ETAs when dispatch data is available.</p>
          {liveBoardErr ? (
            <p className="pd-fare-fleet__err pd-fare-fleet__err--inline" role="status">
              {liveBoardErr}
            </p>
          ) : null}
          <div className="pd-fare-fleet__cards" role="list">
            {fleet === null ? (
              <p className="pd-fare-fleet__hint">Loading fleet…</p>
            ) : fleetErr ? (
              <p className="pd-fare-fleet__err" role="alert">
                {fleetErr}
              </p>
            ) : fleet.length === 0 ? (
              <p className="pd-fare-fleet__hint">No buses registered yet.</p>
            ) : (
              fleet.map((b) => (
                <FleetShowcaseCard
                  key={b.busId}
                  bus={b}
                  etaInfo={etaByBusId.get(String(b.busId).trim())}
                  liveBoardLoading={liveBoard === null}
                />
              ))
            )}
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}

function FleetShowcaseCard({
  bus,
  etaInfo,
  liveBoardLoading,
}: {
  bus: PublicFleetBus;
  etaInfo: { eta: number | null; nextTerminal: string | null } | undefined;
  liveBoardLoading: boolean;
}) {
  const inactive = isInactiveStatus(bus.status);
  const { start, end } = routeEndpointsFromLabel(bus.route);
  const plate = bus.plateNumber?.trim() && bus.plateNumber !== "—" ? bus.plateNumber.trim() : "—";
  const routeTitle = bus.route?.trim() ? bus.route.trim() : "Route not assigned";
  const etaMain = liveBoardLoading ? "…" : etaInfo?.eta != null ? `~${etaInfo.eta} min` : "—";
  const etaDetail =
    liveBoardLoading ? "Loading…" : etaInfo?.nextTerminal?.trim() || (inactive ? "Inactive for this route" : "No live ETA");

  return (
    <div className={"pax-fleet-card" + (inactive ? " pax-fleet-card--inactive" : "")} role="listitem">
      <div className="pax-fleet-card__shell">
        <div className="pax-fleet-card__top">
          <div className="pax-fleet-card__border" aria-hidden />
          <div className="pax-fleet-card__icons">
            <div className="pax-fleet-card__logo" aria-hidden>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="pax-fleet-card__bus-svg" fill="none">
                <path
                  fill="white"
                  d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-2.5-1.5-4.25-4-4.25S10 3.5 10 6H6c-1.1 0-2 .9-2 2v8zm2.5 1A1.5 1.5 0 016 15.5 1.5 1.5 0 017.5 17 1.5 1.5 0 016 18.5zm11 0a1.5 1.5 0 01-1.5-1.5 1.5 1.5 0 011.5-1.5 1.5 1.5 0 011.5 1.5 1.5 1.5 0 01-1.5 1.5zM18 11H6V8h12v3z"
                />
              </svg>
            </div>
            <div className="pax-fleet-card__status-icons" aria-hidden>
              <span className={"pax-fleet-card__dot" + (inactive ? " pax-fleet-card__dot--off" : " pax-fleet-card__dot--on")} />
            </div>
          </div>
        </div>
        <div className="pax-fleet-card__bottom">
          <span className="pax-fleet-card__title">{bus.busNumber}</span>
          <p className="pax-fleet-card__route-line" title={routeTitle}>
            {routeTitle}
          </p>
          <div className="pax-fleet-card__row">
            <div className="pax-fleet-card__item">
              <span className="pax-fleet-card__item-label">Start location</span>
              <span className="pax-fleet-card__big">{start}</span>
              <span className="pax-fleet-card__small">Origin stop</span>
            </div>
            <div className="pax-fleet-card__item">
              <span className="pax-fleet-card__item-label">Destination location</span>
              <span className="pax-fleet-card__big">{end}</span>
              <span className="pax-fleet-card__small">Corridor end</span>
            </div>
            <div className="pax-fleet-card__item">
              <span className="pax-fleet-card__item-label">ETA</span>
              <span className="pax-fleet-card__big">{etaMain}</span>
              <span className="pax-fleet-card__small">{etaDetail}</span>
            </div>
          </div>
          <div className="pax-fleet-card__foot">
            <span className="pax-fleet-card__meta">
              Plate: {plate} · {bus.seatCapacity} seats
            </span>
            <span className={"pd-fare-fleet__pill" + statusPillClass(bus.status)}>{formatStatus(bus.status)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function isInactiveStatus(status: string): boolean {
  return String(status || "")
    .toLowerCase()
    .includes("inactive");
}

function formatStatus(status: string): string {
  const s = String(status || "").trim();
  return s || "Unknown";
}

function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "active") return " pd-fare-fleet__pill--active";
  if (s === "maintenance") return " pd-fare-fleet__pill--maint";
  return " pd-fare-fleet__pill--inactive";
}

export function PassengerLostFound() {
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!when) return;
    setSent(true);
  }

  return (
    <div className="pd-tactical pd-lost pd-hub pd-tactical--centered" role="region" aria-label="Left something">
      <form className="pd-fb-card" onSubmit={submit}>
        <h1 className="pd-fb-card__title">Left something?</h1>
        <p className="pd-fb-card__hint">
          Note when you last had it and what it looks like — terminal staff will match against the registry.
        </p>

        <label className="pd-fb-card__field-label" htmlFor="pd-lost-when">
          Date &amp; time last seen
        </label>
        <input
          id="pd-lost-when"
          type="datetime-local"
          className="pd-fb-card__input pd-fb-card__input--datetime"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          required
        />

        <label className="pd-fb-card__field-label" htmlFor="pd-lost-note">
          Details
        </label>
        <textarea
          id="pd-lost-note"
          className="pd-fb-card__textarea"
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Route, seat, color, distinguishing marks…"
        />

        <div className="pd-fb-card__toolbar" role="group" aria-label="Submit report">
          <span className="pd-fb-card__spacer" aria-hidden />
          <span className="pd-fb-card__spacer" aria-hidden />
          <button type="submit" className="pd-fb-card__send" disabled={!when} aria-label="Submit lost item report">
            <svg
              className="pd-fb-card__send-icon"
              fill="none"
              viewBox="0 0 24 24"
              height="30"
              width="30"
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
          </button>
        </div>

        {sent ? (
          <p className="pd-fb-card__ack" role="status">
            Logged. Terminal staff will match against the registry.
          </p>
        ) : null}
      </form>
    </div>
  );
}
