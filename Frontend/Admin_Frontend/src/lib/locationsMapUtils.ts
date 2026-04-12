import L from "leaflet";

export function isFastPulse(busId: string): boolean {
  let s = 0;
  for (let i = 0; i < busId.length; i++) s += busId.charCodeAt(i);
  return s % 2 === 0;
}

/** Faint path behind bus (~15 min trail simulation). */
export function buildHeatTrail(pos: [number, number], seed: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const jitter = Math.sin(seed * 11 + i * 0.7) * 0.0002;
    pts.push([pos[0] - t * 0.012 + jitter, pos[1] - t * 0.008 - jitter * 0.4]);
  }
  return pts;
}

/** Front-facing bus glyph (compact, readable at ~20px). */
const BUS_SVG = `<svg class="locations-bus-marker__svg" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M16 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h12zm-1 2H4v8h11V5zm2 4h1V7h-1v2zm-7 7c.5 0 1-.2 1-.4V16H7v.6c0 .2.5.4 1 .4zm2-1H5v1h6v-1zm3-11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>`;

export type GpsSignalTier = "strong" | "weak" | "offline";

export type BusMarkerOpts = {
  /** Speed &gt; 80 km/h — solid red pulse */
  speedCritical?: boolean;
  /** Entered terminal geofence — emerald ring */
  terminalArrival?: boolean;
  /** Attendant force_sync / high-accuracy handshake — extra cyan pulse */
  precisionSync?: boolean;
  /** Live network tier from attendant (weak = amber, offline while moving = gray pulse) */
  signalTier?: GpsSignalTier | null;
};

export function makeBusDivIcon(
  full: boolean,
  fastPulse: boolean,
  stationary?: boolean,
  opts?: BusMarkerOpts
): L.DivIcon {
  let pulse: string;
  const sig = !stationary ? opts?.signalTier : null;
  if (stationary) {
    pulse = "locations-bus-marker--stationary";
  } else if (opts?.speedCritical) {
    pulse = "locations-bus-marker--speed";
  } else if (opts?.terminalArrival) {
    pulse = "locations-bus-marker--arrival";
  } else if (sig === "offline") {
    pulse = "locations-bus-marker--signal-offline-active";
  } else if (sig === "weak") {
    pulse = "locations-bus-marker--signal-weak-pulse";
  } else if (sig === "strong") {
    pulse = "locations-bus-marker--signal-strong-solid";
  } else if (fastPulse) {
    pulse = "locations-bus-marker--fast";
  } else {
    pulse = "locations-bus-marker--slow";
  }
  const fullC = full && !stationary && !opts?.speedCritical ? " locations-bus-marker--full" : "";
  const precisionC =
    opts?.precisionSync && !stationary && !opts?.speedCritical ? " locations-bus-marker--precision-sync" : "";
  return L.divIcon({
    className: "locations-bus-marker-wrap",
    html: `<div class="locations-bus-marker ${pulse}${fullC}${precisionC}"><span class="locations-bus-marker__ring"></span><span class="locations-bus-marker__body">${BUS_SVG}</span></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  });
}
