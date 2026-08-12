/**
 * Onboarding card for Android Bus Attendant app distribution.
 * Download URL can be overridden with VITE_ATTENDANT_PLAY_STORE_URL.
 */
export function AppDownloadCard() {
  const playUrl =
    (import.meta.env.VITE_ATTENDANT_PLAY_STORE_URL as string | undefined)?.trim() ||
    "https://showing-clarify-difficult.ngrok-free.dev/api/download/attendant-app";
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=0&data=${encodeURIComponent(playUrl)}`;

  return (
    <section className="landing-app-card" aria-labelledby="landing-app-card-title">
      <div className="landing-app-card__inner">
        <div className="landing-app-card__left">
          <span className="landing-app-card__small">For Staff &amp; Attendants</span>
          <h2 className="landing-app-card__title" id="landing-app-card-title">
            Download the Attendant App
          </h2>
          <p className="landing-app-card__desc">
            Manage ticketing, issue receipts via SMS, and trigger SOS alerts directly from your Android device.
          </p>
          <a
            href={playUrl}
            className="landing-app-card__btn landing-app-card__btn--play"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download Bus Attendant&apos;s App
          </a>
          <p className="landing-app-card__about-title">About the App</p>
          <p className="landing-app-card__about-copy">
            The Bukidnon Bus Attendant App is the central tool for on-road operations. It synchronizes live
            passenger activity with the admin dashboard, keeps every receipt digital and traceable, and provides a
            direct safety line to control room responders through integrated SOS workflows.
          </p>
        </div>

        <div className="landing-app-card__right" aria-label="Scan to download">
          <h3 className="landing-app-card__qr-title">Scan to Install</h3>
          <p className="landing-app-card__qr-copy">Attendants can scan this during briefing to open the Android download.</p>
          <a href={playUrl} target="_blank" rel="noopener noreferrer" className="landing-app-card__qr-link">
            <img className="landing-app-card__qr" src={qrSrc} alt="QR code for Bus Attendant app download" loading="lazy" />
          </a>
          <p className="landing-app-card__qr-endpoint">Source: /api/download/attendant-app</p>
        </div>
      </div>
    </section>
  );
}
