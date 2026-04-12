import { useEffect } from "react";
import { useMap } from "react-leaflet";

/** Listens for `admin-tactical-map-flyto` and runs map.flyTo (Locations / GPS visualizer). */
export function TacticalMapFlyToBridge() {
  const map = useMap();
  useEffect(() => {
    const onFly = (e: Event) => {
      const ce = e as CustomEvent<{ latitude?: number; longitude?: number; zoom?: number }>;
      const la = Number(ce.detail?.latitude);
      const ln = Number(ce.detail?.longitude);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      const z = Number(ce.detail?.zoom);
      map.flyTo([la, ln], Number.isFinite(z) && z > 0 ? z : 14, { duration: 1.1 });
    };
    window.addEventListener("admin-tactical-map-flyto", onFly);
    return () => window.removeEventListener("admin-tactical-map-flyto", onFly);
  }, [map]);
  return null;
}
