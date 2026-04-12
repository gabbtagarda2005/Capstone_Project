import { useMemo } from "react";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import type { GpsSignalTier } from "@/lib/locationsMapUtils";
import "./LiveFleetBusCard.css";

export type LiveFleetBusCardProps = {
  busId: string;
  route: string;
  /** e.g. Last sync 3:45:02 PM — updates on each live fleet ping */
  lastSyncLine?: string;
  /** Attendant name currently associated with this live GPS stream */
  attendantLine?: string;
  /** Connectivity from last telemetry (stationary → treat as offline for LED row) */
  signalTier?: GpsSignalTier | null;
  active?: boolean;
  onClick: () => void;
};

export function LiveFleetBusCard({
  busId,
  route,
  lastSyncLine,
  attendantLine,
  signalTier,
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
        {attendantLine ? <span className="live-fleet-card__attendant">{attendantLine}</span> : null}
        <span className="live-fleet-card__route">{route}</span>
        {lastSyncLine ? <span className="live-fleet-card__sync">{lastSyncLine}</span> : null}
      </span>
      <span className="live-fleet-card__bottom-text">LIVE FLEET</span>
    </button>
  );
}
