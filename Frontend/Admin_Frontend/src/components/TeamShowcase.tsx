import { Link } from "react-router-dom";
import "./TeamShowcase.css";

type Props = {
  /** "admin" (default) reads the --neo-* tokens scoped on .admin-shell. "landing" reads the
   * public landing page's --lp-* tokens instead — see the --neo-* remapping on the
   * *--landing modifier classes in TeamShowcase.css. */
  variant?: "admin" | "landing";
  /** The company name configured in Admin → Settings → Branding (falls back if not passed). */
  companyName?: string;
};

function IconUsers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Teaser card for the Admin dashboard / public landing page — the actual showcase now
 * lives on its own route (see TeamPage.tsx) rather than a modal. */
export function TeamShowcase({ variant = "admin", companyName = "Bukidnon Bus Company @BUKSU" }: Props) {
  const isLanding = variant === "landing";

  return (
    <section
      className={"team-teaser" + (isLanding ? " team-teaser--landing" : " neo-card")}
      aria-labelledby="team-teaser-title"
    >
      <div className="team-teaser__icon" aria-hidden>
        <IconUsers />
      </div>
      <div className="team-teaser__copy">
        <h3 id="team-teaser-title" className="team-teaser__title">
          People Behind the System
        </h3>
        <p className="team-teaser__desc">
          Meet the people behind the design, development, testing, and documentation of the {companyName} system.
        </p>
      </div>
      <Link to="/team" className="team-teaser__btn">
        <IconUsers />
        <span>Meet the Team</span>
      </Link>
    </section>
  );
}
