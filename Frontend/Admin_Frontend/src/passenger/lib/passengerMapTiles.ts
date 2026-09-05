export type PassengerBasemapMode = "satellite" | "roadmap" | "terrain" | "dark";

const TILE_OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
/**
 * CARTO's free anonymous dark-tile CDN (basemaps.cartocdn.com) now requires an API key for
 * real traffic — without one it serves a watermarked "API KEY REQUIRED" tile instead of the
 * map. Rather than depend on a key/account, "dark" reuses the same OSM source as "roadmap"
 * and gets darkened via a CSS filter on .leaflet-tile (see DashboardMap.css's
 * .dashboard-map--dark-chrome rule) — no external dependency, no rate limit.
 */
const TILE_DARK = TILE_OSM;
/** Esri World Imagery — same family many Leaflet apps use for “Satellite”. */
const TILE_SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_TERRAIN = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";

export function passengerTileLayer(mode: PassengerBasemapMode): { url: string; attribution: string } {
  switch (mode) {
    case "satellite":
      return {
        url: TILE_SAT,
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      };
    case "terrain":
      return {
        url: TILE_TERRAIN,
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      };
    case "dark":
      return {
        url: TILE_DARK,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      };
    case "roadmap":
    default:
      return {
        url: TILE_OSM,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      };
  }
}
