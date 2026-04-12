/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_API_URL?: string;
  /** Bus attendant Node API — optional health probe from maintenance center */
  readonly VITE_BUS_ATTENDANT_API_URL?: string;
  /** WeatherAPI.com key — https://www.weatherapi.com/ (optional; Open-Meteo fallback if unset) */
  readonly VITE_WEATHERAPI_KEY?: string;
  /** Optional HTTPS URL for terminal CCTV iframe on location dossier */
  readonly VITE_TERMINAL_CCTV_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
