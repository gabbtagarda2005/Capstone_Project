import { useState } from "react";

type Props = {
  /** Admin Settings → Brand identity (sidebar logo URL or data URL). */
  logoUrl?: string | null;
  /** Outer wrapper; default matches header nav tiles. */
  wrapClassName?: string;
  /** Added when `logoUrl` image is shown successfully. */
  hasImageClassName?: string;
  /** Class on the `<img>` when present. */
  imgClassName?: string;
};

export function PassengerLogo({
  logoUrl,
  wrapClassName = "ph-nav__logo",
  hasImageClassName = "ph-nav__logo--has-img",
  imgClassName = "ph-nav__logo-img",
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = logoUrl?.trim();

  if (url && !imgFailed) {
    return (
      <div className={`${wrapClassName} ${hasImageClassName}`.trim()} aria-hidden>
        <img src={url} alt="" className={imgClassName} onError={() => setImgFailed(true)} />
      </div>
    );
  }

  return (
    <div className={wrapClassName} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M4 8L12 4L20 8V16L12 20L4 16V8Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 4V20" stroke="white" strokeWidth="1.2" strokeOpacity="0.7" />
      </svg>
    </div>
  );
}
