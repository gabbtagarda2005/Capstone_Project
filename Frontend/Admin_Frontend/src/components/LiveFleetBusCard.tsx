import { useMemo } from "react";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import type { GpsSignalTier } from "@/lib/locationsMapUtils";
import "./LiveFleetBusCard.css";

export type LiveFleetBusCardProps = {
  busId: string;
  route: string;
  /** e.g. Last sync 3:45:02 PM — updates on each live fleet ping. "Never synced" for a registered
   *  bus that has never produced a GPS reading, rather than an invented timestamp. */
  lastSyncLine?: string | null;
  /** Attendant name currently associated with this live GPS stream */
  attendantLine?: string | null;
  /** Connectivity from last telemetry (stationary → treat as offline for LED row); null renders the
   *  existing dim "n/a" LED styling, used when this bus has never had a GPS reading at all. */
  signalTier?: GpsSignalTier | null;
  /** Explicit text under the signal LEDs — "GPS SIGNAL LOST" (synced before, not now) or "UNKNOWN"
   *  (never synced). Omitted/null while the LEDs' own strong/weak color already says enough. */
  signalStatusText?: string | null;
  /** The LILYGO hardware device's own backup status, independent of whichever source (staff phone
   *  vs hardware) is currently active — always shown, since this is a separate fact from it. */
  hardwareStatus?: "active" | "signal_lost" | "unknown";
  active?: boolean;
  onClick: () => void;
};

const HARDWARE_STATUS_LABEL: Record<"active" | "signal_lost" | "unknown", string> = {
  active: "ACTIVE",
  signal_lost: "GPS SIGNAL LOST",
  unknown: "UNKNOWN",
};

export function LiveFleetBusCard({
  busId,
  route,
  lastSyncLine,
  attendantLine,
  signalTier,
  signalStatusText,
  hardwareStatus,
  active,
  onClick,
}: LiveFleetBusCardProps) {
  const { branding } = useAdminBranding();
  const { firstWord, restWords } = useMemo(() => {
    const name = branding.companyName.trim();
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return { firstWord: "Bukidnon Bus Company", restWords: "" as string };
    }
    return {
      firstWord: words[0]!,
      restWords: words.slice(1).join(" "),
    };
  }, [branding.companyName]);

  const signalMod =
    signalTier === "offline"
      ? "live-fleet-card__signal--offline"
      : signalTier === "weak"
        ? "live-fleet-card__signal--weak"
        : signalTier === "strong"
          ? "live-fleet-card__signal--strong"
          : "live-fleet-card__signal--na";

  return (
    <button
      type="button"
      className={"live-fleet-card" + (active ? " live-fleet-card--active" : "")}
      onClick={onClick}
    >
      <span className="live-fleet-card__border" aria-hidden />
      <span className="live-fleet-card__content">
        <span className="live-fleet-card__brand">
          <span className="live-fleet-card__brand-clip">
            <span className="live-fleet-card__brand-inner" title={branding.companyName.trim()}>
              <span className="live-fleet-card__brand-solid">{firstWord}</span>
              {restWords ? (
                <>
                  {" "}
                  <span className="live-fleet-card__brand-outline">{restWords}</span>
                </>
              ) : null}
            </span>
            <span className="live-fleet-card__trail" aria-hidden />
          </span>
        </span>
        <span className="live-fleet-card__logo-bottom-text">{busId}</span>
        <span
          className={"live-fleet-card__signal " + signalMod}
          title="Last uplink tier from attendant telemetry (strong / weak / offline)"
        >
          <span className="live-fleet-card__signal-label">
            <span aria-hidden>📶</span> Signal
          </span>
          <span className="live-fleet-card__signal-leds" aria-hidden>
            <span className="live-fleet-card__signal-bar" />
            <span className="live-fleet-card__signal-bar" />
            <span className="live-fleet-card__signal-bar" />
            <span className="live-fleet-card__signal-bar" />
          </span>
        </span>
        {signalStatusText ? <span className="live-fleet-card__signal-text">{signalStatusText}</span> : null}
        {hardwareStatus ? (
          <span
            className="live-fleet-card__attendant"
            title="The LILYGO hardware tracker's own status — separate from whichever source is currently active."
          >
            🛰️ Hardware backup: {HARDWARE_STATUS_LABEL[hardwareStatus]}
          </span>
        ) : null}
        {attendantLine ? <span className="live-fleet-card__attendant">{attendantLine}</span> : null}
        <span className="live-fleet-card__route">{route}</span>
        {lastSyncLine ? <span className="live-fleet-card__sync">{lastSyncLine}</span> : null}
      </span>
      <span className="live-fleet-card__bottom-text">LIVE FLEET</span>
    </button>
  );
}
