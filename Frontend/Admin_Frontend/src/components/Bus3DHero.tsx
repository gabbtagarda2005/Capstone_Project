import { useEffect, useState } from "react";
import busHeroImage from "@/Image/bukidnon-coach-hero.png";
import { fetchPublicFleetBuses, type PublicFleetBus } from "@/passenger/lib/fetchPublicFleetBuses";
import { shortPickupLocationLabel } from "@/lib/humanizeAdminAudit";
import "./Bus3DHero.css";

type LiveCardData = {
  location: string;
  locationSub: string;
  gpsStatus: string;
  gpsSub: string;
  gpsOk: boolean;
  passengers: string;
  passengersSub: string;
};

const FALLBACK_CARD: LiveCardData = {
  location: "Waiting for GPS…",
  locationSub: "No recent fix",
  gpsStatus: "Searching…",
  gpsSub: "No signal yet",
  gpsOk: false,
  passengers: "—",
  passengersSub: "No data",
};

/** Picks the top-performing bus from the public fleet feed. Revenue/trip-count data lives only
 * in authenticated admin reports, so the public-safe proxy for "performing" here is current
 * ridership (occupied seats) — the highest-occupancy bus, falling back to the first bus if none
 * report occupancy. */
function pickTopPerformingBus(items: PublicFleetBus[]): PublicFleetBus | null {
  const [first, ...rest] = items;
  if (!first) return null;
  return rest.reduce((best, b) => ((b.occupiedSeats ?? 0) > (best.occupiedSeats ?? 0) ? b : best), first);
}

export function Bus3DHero() {
  const [card, setCard] = useState<LiveCardData>(FALLBACK_CARD);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicFleetBuses()
      .then((items: PublicFleetBus[]) => {
        if (cancelled) return;
        const top = pickTopPerformingBus(items);
        if (!top) return;
        const gpsAgeMs = top.gpsRecordedAt ? Date.now() - new Date(top.gpsRecordedAt).getTime() : Infinity;
        const gpsFresh = gpsAgeMs < 5 * 60 * 1000;
        const routeLabel = top.routeStart && top.routeEnd
          ? `${shortPickupLocationLabel(top.routeStart)} → ${shortPickupLocationLabel(top.routeEnd)}`
          : top.route || null;
        setCard({
          location: top.lastLatitude != null ? routeLabel || "En route, Bukidnon" : "Waiting for GPS…",
          locationSub: top.busNumber ? `Bus ${top.busNumber}` : "No recent fix",
          gpsStatus: gpsFresh ? "Connected" : top.lastLatitude != null ? "Signal lost" : "Searching…",
          gpsSub: gpsFresh ? "Strong signal" : "No recent ping",
          gpsOk: gpsFresh,
          passengers: top.seatLine || (top.seatCapacity ? `${top.occupiedSeats ?? 0}/${top.seatCapacity}` : "—"),
          passengersSub: top.seatCapacity ? "On board" : "No data",
        });
      })
      .catch(() => {
        /* keep fallback card */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bus3d" aria-label="Bukidnon Bus Company coach">
      <div className="bus3d__image-mount">
        <img src={busHeroImage} alt="Bukidnon Bus Company coach" className="bus3d__image" />
      </div>

      <div className="bus3d__cards">
        <div className="bus3d__card bus3d__card--location">
          <span className="bus3d__card-icon" aria-hidden>
            📍
          </span>
          <div>
            <p className="bus3d__card-label">Live location</p>
            <p className="bus3d__card-value">{card.location}</p>
            <p className="bus3d__card-sub">{card.locationSub}</p>
          </div>
        </div>

        <div className="bus3d__card bus3d__card--gps">
          <span className="bus3d__card-icon" aria-hidden>
            📡
          </span>
          <div>
            <p className="bus3d__card-label">GPS status</p>
            <p className={"bus3d__card-value" + (card.gpsOk ? " bus3d__card-value--ok" : " bus3d__card-value--warn")}>
              {card.gpsStatus}
            </p>
            <p className="bus3d__card-sub">{card.gpsSub}</p>
          </div>
        </div>

        <div className="bus3d__card bus3d__card--passengers">
          <span className="bus3d__card-icon" aria-hidden>
            🚍
          </span>
          <div>
            <p className="bus3d__card-label">Passengers</p>
            <p className="bus3d__card-value">{card.passengers}</p>
            <p className="bus3d__card-sub">{card.passengersSub}</p>
          </div>
        </div>

        <div className="bus3d__card bus3d__card--speed">
          <span className="bus3d__card-icon" aria-hidden>
            ⚡
          </span>
          <div>
            <p className="bus3d__card-label">Speed</p>
            <p className="bus3d__card-value">Not reported</p>
            <p className="bus3d__card-sub">Not in public feed</p>
          </div>
        </div>
      </div>
    </div>
  );
}
