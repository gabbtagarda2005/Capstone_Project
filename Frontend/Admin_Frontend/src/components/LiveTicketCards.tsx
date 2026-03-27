import type { TicketRow } from "@/lib/types";
import "./LiveTicketCards.css";

const DRIVER_ROSTER: { name: string; licenseRef: string }[] = [
  { name: "John Ramos", licenseRef: "DL-BUK-11001" },
  { name: "R. Dela Cruz", licenseRef: "DL-BUK-10442" },
  { name: "M. Sarmiento", licenseRef: "DL-BUK-10891" },
  { name: "J. Omblero", licenseRef: "DL-BUK-11203" },
  { name: "A. Bautista", licenseRef: "DL-BUK-10976" },
  { name: "Luis M. Catindig", licenseRef: "DL-BUK-11550" },
];

function pickDriver(t: TicketRow) {
  const i = Math.abs(t.id * 17 + t.issuedByOperatorId * 31) % DRIVER_ROSTER.length;
  return DRIVER_ROSTER[i]!;
}

function busBodyNumber(t: TicketRow) {
  const n = 700 + (Math.abs(t.id + t.issuedByOperatorId) % 60);
  return `BUK-${n}`;
}

function routeLabel(t: TicketRow) {
  return `${t.startLocation} ↔ ${t.destination}`;
}

function routeOneWay(t: TicketRow) {
  return `${t.startLocation} → ${t.destination}`;
}

/** Neon-style issuance / context tag */
function issuancePoint(t: TicketRow): string {
  const s = t.startLocation.toLowerCase();
  if (s.includes("valencia")) return "Valencia Terminal";
  if (s.includes("malaybalay")) return "Malaybalay Terminal";
  if (s.includes("maramag")) return "Maramag Terminal";
  if (s.includes("don carlos")) return "Don Carlos Terminal";
  if (s.includes("dulogon")) return "Dulogon · En route";
  return `${t.startLocation} · Issued`;
}

/** Demo GPS tag tied to ticket id (replace with live GPS when API provides it) */
function issuanceGps(t: TicketRow): string {
  const lat = (7.62 + ((t.id * 17) % 80) / 1000).toFixed(4);
  const lng = (124.88 + ((t.issuedByOperatorId * 13) % 60) / 1000).toFixed(4);
  return `${lat}° N · ${lng}° E`;
}

function minutesSince(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

/** Recent print = ISSUED + glow; older trips show BOARDED for live ops narrative */
function ticketStatus(t: TicketRow): "ISSUED" | "BOARDED" {
  return minutesSince(t.createdAt) <= 5 ? "ISSUED" : "BOARDED";
}

function isFreshGlow(t: TicketRow) {
  return minutesSince(t.createdAt) <= 5;
}

type Props = { tickets: TicketRow[] };

export function LiveTicketCards({ tickets }: Props) {
  const sorted = [...tickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (sorted.length === 0) {
    return (
      <p className="live-ticket-cards__empty">No records match the current filters.</p>
    );
  }

  return (
    <div className="live-ticket-cards">
      {sorted.map((t) => {
        const driver = pickDriver(t);
        const attendantName = t.busOperatorName?.trim() || "Luis Catindig";
        const status = ticketStatus(t);
        const fresh = isFreshGlow(t);
        return (
          <article
            key={t.id}
            className={"live-ticket-card" + (fresh ? " live-ticket-card--fresh" : "")}
          >
            <div className="live-ticket-card__body">
              <div className="live-ticket-card__col live-ticket-card__col--left">
                <span className="live-ticket-card__col-label">Passenger</span>
                <span className="live-ticket-card__pid">{t.passengerId}</span>
                <span className={"live-ticket-card__status live-ticket-card__status--" + status.toLowerCase()}>{status}</span>
              </div>
              <div className="live-ticket-card__col live-ticket-card__col--center" aria-label="Crew">
                <span className="live-ticket-card__col-label">Crew</span>
                <p className="live-ticket-card__crew-line">
                  <span className="live-ticket-card__crew-k">Driver:</span> {driver.name}
                </p>
                <p className="live-ticket-card__crew-line">
                  <span className="live-ticket-card__crew-k">Attendant:</span> {attendantName}
                </p>
              </div>
              <div className="live-ticket-card__col live-ticket-card__col--right" aria-label="Bus and route">
                <span className="live-ticket-card__col-label">Bus &amp; route</span>
                <p className="live-ticket-card__bus-line">Bus {busBodyNumber(t)}</p>
                <p className="live-ticket-card__route-line">{routeOneWay(t)}</p>
              </div>
            </div>

            <div className="live-ticket-card__meta">
              <span className="live-ticket-card__location-badge">{issuancePoint(t)}</span>
              <span className="live-ticket-card__coord" title="Issuance context (demo coordinates)">
                {issuanceGps(t)} · {routeLabel(t)} · printed {new Date(t.createdAt).toLocaleString()}
              </span>
            </div>

            <footer className="live-ticket-card__foot">
              <span>₱{t.fare.toFixed(2)}</span>
              <span className="live-ticket-card__foot-muted">Ticket #{t.id}</span>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
