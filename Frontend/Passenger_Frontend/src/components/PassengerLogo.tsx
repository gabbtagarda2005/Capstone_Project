import { useState } from "react";

type Props = {
  /** Admin Settings → Brand identity (sidebar logo URL or data URL). */
  logoUrl?: string | null;
};

export function PassengerLogo({ logoUrl }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = logoUrl?.trim();

  if (url && !imgFailed) {
    return (
      <div className="ph-nav__logo ph-nav__logo--has-img" aria-hidden>
        <img src={url} alt="" className="ph-nav__logo-img" onError={() => setImgFailed(true)} />
      </div>
    );
  }

  return (
    <div className="ph-nav__logo" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M4 8L12 4L20 8V16L12 20L4 16V8Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 4V20" stroke="white" strokeWidth="1.2" strokeOpacity="0.7" />
      </svg>
    </div>
  );
}
