import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchDeployedPoints, type DeployedPointItem } from "@/lib/fetchPassengerMapData";
import { fetchPublicFleetBuses, type FleetIntelQuery, type PublicFleetBus } from "@/lib/fetchPublicFleetBuses";
import { fetchPublicOperationsDeck } from "@/lib/fetchPublicOperationsDeck";
import {
  fetchPublicFareQuote,
  type FareCategoryUi,
  type PublicFareQuoteOk,
  type PublicFareQuoteResponse,
} from "@/lib/fetchPublicFareQuote";
import { bestEtaByBusId, fetchPublicLiveBoard } from "@/lib/fetchPublicLiveBoard";
import { fetchPublicPostJson } from "@/lib/fetchWithPublicApiBases";
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
  const [operationsDeckLive, setOperationsDeckLive] = useState<boolean | null>(null);

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
    async function tick() {
      let deckOk = true;
      try {
        const od = await fetchPublicOperationsDeck();
        deckOk = od.operationsDeckLive !== false;
        if (cancelled) return;
        setOperationsDeckLive(deckOk);
      } catch {
        if (cancelled) return;
        setOperationsDeckLive(true);
        deckOk = true;
      }
      if (!deckOk) {
        if (cancelled) return;
        setFleet([]);
        setLiveBoard([]);
        setFleetErr(null);
        setLiveBoardErr(null);
        return;
      }
      const sess = getPassengerLocationSession();
      const q: FleetIntelQuery = {};
      if (sess?.nearestLabel?.trim()) q.viewerHub = sess.nearestLabel.trim();
      if (sess && Number.isFinite(sess.lat) && Number.isFinite(sess.lng)) {
        q.userLat = sess.lat;
        q.userLng = sess.lng;
      }
      const [fr, lr] = await Promise.allSettled([fetchPublicFleetBuses(q), fetchPublicLiveBoard()]);
      if (cancelled) return;
      if (fr.status === "fulfilled") {
        setFleet(fr.value);
        setFleetErr(null);
      } else {
        setFleet((p) => p ?? []);
        setFleetErr(fr.reason instanceof Error ? fr.reason.message : "Could not load fleet list.");
      }
      if (lr.status === "fulfilled") {
        setLiveBoard(lr.value);
        setLiveBoardErr(null);
      } else {
        setLiveBoard((p) => p ?? []);
        setLiveBoardErr(lr.reason instanceof Error ? lr.reason.message : "Could not load ETAs.");
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
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
    <div className="pd-tactical pd-check-buses" role="region" aria-label="Check buses">
      <header className="pd-tactical__head pd-board__mast">
        <div>
          <h1 className="pd-tactical__title">Check buses</h1>
          <p className="pd-tactical__sub">Fare quotes from Admin · Fleet registry from operations</p>
        </div>
      </header>

      <div className="pd-board__wrap">
        <div className="pd-check-buses__pad">
          <h2 className="pd-check-buses__block-title">Fare estimate</h2>
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
            <label className="pd-fare-engine__field pd-fare-engine__field--span2">
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
          </div>

          <div className={"pd-fare-total" + (fareBump ? " pd-fare-total--bump" : "")} aria-live="polite">
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

      <h2 className="pd-check-buses__block-title pd-check-buses__block-title--fleet">Fleet registry</h2>
      {liveBoardErr ? (
        <p className="pd-check-buses__live-err" role="status">
          {liveBoardErr}
        </p>
      ) : null}
      <div className="pd-board__wrap pd-check-buses__fleet-card-panel">
        {fleet === null || operationsDeckLive === null ? (
          <p className="pd-board__empty pd-check-buses__fleet-empty">Loading fleet…</p>
        ) : operationsDeckLive === false ? (
          <p className="pd-board__empty pd-check-buses__fleet-empty pd-check-buses__fleet-empty--offline" role="status">
            Fleet registry is paused — the operations center has set the deck to <strong>OFFLINE</strong>. Live buses
            and fleet cards will return when operations goes LIVE again.
          </p>
        ) : fleetErr ? (
          <p className="pd-board__empty pd-check-buses__fleet-empty">{fleetErr}</p>
        ) : fleet.length === 0 ? (
          <p className="pd-board__empty pd-check-buses__fleet-empty">No buses registered yet.</p>
        ) : (
          <div className="pax-fleet-bus-card-grid" role="list" aria-label="Fleet registry">
            {fleet.map((b) => (
              <FleetBusCard
                key={b.busId}
                bus={b}
                etaInfo={etaByBusId.get(String(b.busId).trim())}
                liveBoardLoading={liveBoard === null}
              />
            ))}
          </div>
        )}
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

function fleetStatusPresentation(status: string): { text: string; emoji: string; mod: string } {
  const s = String(status || "").toLowerCase();
  if (s.includes("active")) return { text: "ACTIVE", emoji: "🟢", mod: "pd-board__status--ontime" };
  if (s.includes("maintenance")) return { text: "MAINTENANCE", emoji: "🟠", mod: "pd-board__status--delayed" };
  return { text: "INACTIVE", emoji: "⚫", mod: "pd-board__status--cancelled" };
}

function resolvePassengerEta(
  bus: PublicFleetBus,
  boardEta: { eta: number | null; nextTerminal: string | null } | undefined,
  liveBoardLoading: boolean,
  inactive: boolean,
): { minutes: string; sub: string; title: string } {
  if (liveBoardLoading) {
    return { minutes: "…", sub: "Loading…", title: "Loading ETA" };
  }
  if (inactive) {
    return { minutes: "—", sub: "Bus inactive", title: "No ETA for inactive buses" };
  }
  const userEtaRaw = bus.etaMinutesFromUser;
  const userEta =
    userEtaRaw != null && Number.isFinite(Number(userEtaRaw)) ? Math.max(1, Math.round(Number(userEtaRaw))) : null;
  if (userEta != null) {
    const km = bus.distanceToUserKm;
    const sub =
      km != null && Number.isFinite(Number(km)) ? `~${Number(km).toFixed(1)} km · 40 km/h` : "Live bus GPS";
    return {
      minutes: `~${userEta} min`,
      sub,
      title: `About ${userEta} minutes based on your location and the bus GPS (assumes ~40 km/h).`,
    };
  }
  const bEta = boardEta?.eta;
  if (bEta != null && Number.isFinite(Number(bEta))) {
    const n = Math.max(0, Math.round(Number(bEta)));
    const nt = boardEta?.nextTerminal?.trim() || "";
    return {
      minutes: `~${n} min`,
      sub: nt || "Operations ETA",
      title: `ETA ~${n} min${nt ? ` — ${nt}` : ""} from the live board.`,
    };
  }
  return {
    minutes: "—",
    sub: "Open the map tab & share location for GPS ETA",
    title: "Enable location to see time to reach you",
  };
}

function FleetBusCard({
  bus,
  etaInfo,
  liveBoardLoading,
}: {
  bus: PublicFleetBus;
  etaInfo: { eta: number | null; nextTerminal: string | null } | undefined;
  liveBoardLoading: boolean;
}) {
  const inactive = isInactiveStatus(bus.status);
  const routeLocations = fleetRouteLocationLabel(bus);
  const plate = bus.plateNumber?.trim() && bus.plateNumber !== "—" ? bus.plateNumber.trim() : "—";
  const eta = resolvePassengerEta(bus, etaInfo, liveBoardLoading, inactive);
  const st = fleetStatusPresentation(bus.status);
  const seatLine = bus.seatLine?.trim() || `0/${bus.seatCapacity}`;
  const cap = bus.seatCapacity;

  return (
    <article className={"pax-fleet-bus-card" + (inactive ? " pax-fleet-bus-card--inactive" : "")} role="listitem">
      <div className="pax-fleet-bus-card__shell">
        <div className="pax-fleet-bus-card__top pax-fleet-bus-card__top--smart">
          <div className="pax-fleet-bus-card__smart-row">
            <div className="pax-fleet-bus-card__smart-col pax-fleet-bus-card__smart-col--eta">
              <span className="pax-fleet-bus-card__smart-eta-time" title={eta.title}>
                {eta.minutes}
              </span>
              <span className="pax-fleet-bus-card__smart-eta-label">ETA</span>
              <span className="pax-fleet-bus-card__smart-eta-sub">{eta.sub}</span>
            </div>
            <div className="pax-fleet-bus-card__smart-col pax-fleet-bus-card__smart-col--center">
              <div className="pax-fleet-bus-card__smart-bus-icon" aria-hidden>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="pax-fleet-bus-card__bus-svg" fill="none">
                  <path
                    fill="white"
                    d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-2.5-1.5-4.25-4-4.25S10 3.5 10 6H6c-1.1 0-2 .9-2 2v8zm2.5 1A1.5 1.5 0 016 15.5 1.5 1.5 0 017.5 17 1.5 1.5 0 016 18.5zm11 0A1.5 1.5 0 0117.5 15.5 1.5 1.5 0 0119 17a1.5 1.5 0 01-1.5 1.5zM18 11H6V8h12v3z"
                  />
                </svg>
              </div>
              <span className="pax-fleet-bus-card__smart-bus-number">{bus.busNumber}</span>
              <span className="pax-fleet-bus-card__smart-plate">{plate}</span>
              <span className="pax-fleet-bus-card__smart-cap">{cap} seats max</span>
            </div>
            <div className="pax-fleet-bus-card__smart-col pax-fleet-bus-card__smart-col--status">
              <span className="pax-fleet-bus-card__smart-seat-line">
                {seatLine} <span className="pax-fleet-bus-card__smart-seat-muted">boarded</span>
              </span>
              <span className={"pax-fleet-bus-card__smart-status pd-board__status " + st.mod}>
                {st.emoji} {st.text}
              </span>
            </div>
          </div>
        </div>
        <div className="pax-fleet-bus-card__bottom">
          <div className="pax-fleet-bus-card__row pax-fleet-bus-card__row--route-only">
            <div className="pax-fleet-bus-card__item pax-fleet-bus-card__item--full">
              <span className="pax-fleet-bus-card__big pax-fleet-bus-card__big--route">{routeLocations}</span>
              <span className="pax-fleet-bus-card__small">Route</span>
            </div>
          </div>
          {bus.seatNotice ? (
            <p className="pax-fleet-bus-card__intel-notice" role="status">
              {bus.seatNotice}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function isInactiveStatus(status: string): boolean {
  return String(status || "")
    .toLowerCase()
    .includes("inactive");
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
    if (!when || !emailOk || !busChoice || pending) return;
    setFormError(null);
    setPending(true);
    try {
      const sel = fleetOptions.find((b) => b.busId === busChoice);
      const busLabel =
        busChoice === LOST_BUS_UNSURE ? "Not sure / different bus" : sel ? lostBusLabel(sel) : busChoice;
      const lastSeenAt = new Date(when).toISOString();
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

  const canSubmit = Boolean(when && emailOk && busChoice);

  return (
    <div className="pd-tactical pd-lost pd-hub pd-tactical--centered" role="region" aria-label="Left something">
      <form className="pd-fb-card pd-fb-card--lg" onSubmit={(ev) => void submit(ev)} noValidate>
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

        <label className="pd-fb-card__field-label" htmlFor="pd-lost-bus">
          Bus you were on
        </label>
        <select
          id="pd-lost-bus"
          className="pd-fb-card__select"
          value={busChoice}
          onChange={(e) => setBusChoice(e.target.value)}
          required
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
          Your email
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
          required
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
          <span className="pd-fb-card__spacer" aria-hidden />
          <span className="pd-fb-card__spacer" aria-hidden />
          <button
            type="submit"
            className="pd-fb-card__send"
            disabled={!canSubmit || pending}
            aria-busy={pending}
            aria-label="Submit lost item report"
          >
            {pending ? (
              <span className="pd-fb-card__send-label" aria-live="polite">
                Sending…
              </span>
            ) : (
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
