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

export function makeBusDivIcon(full: boolean, fastPulse: boolean): L.DivIcon {
  const pulse = fastPulse ? "locations-bus-marker--fast" : "locations-bus-marker--slow";
  const fullC = full ? " locations-bus-marker--full" : "";
  return L.divIcon({
    className: "locations-bus-marker-wrap",
    html: `<div class="locations-bus-marker ${pulse}${fullC}"><span class="locations-bus-marker__ring"></span><span class="locations-bus-marker__core"></span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}
