/** Fly the admin GPS map (Locations) to coordinates. No-op if map is not mounted. */
export function tacticalMapFlyTo(latitude: number, longitude: number, zoom = 14): void {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  window.dispatchEvent(
    new CustomEvent("admin-tactical-map-flyto", {
      detail: { latitude, longitude, zoom },
    })
  );
}
