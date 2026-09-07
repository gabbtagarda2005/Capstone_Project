import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicCompanyProfile } from "@/lib/api";
import { TEAM_ADVISER, TEAM_MEMBERS, type TeamMember } from "@/lib/teamData";
import "./TeamPage.css";

/** The photo area: shows a real portrait once `photoUrl` is set on the person's record in
 * teamData.ts, and falls back to a gradient + initials placeholder until then — same slot,
 * same sizing, so swapping in a photo later needs no layout changes. */
function PersonPhoto({ person }: { person: TeamMember }) {
  if (person.photoUrl) {
    return <img className="team-page__photo-img" src={person.photoUrl} alt={person.name} />;
  }
  return (
    <div className="team-page__photo-fallback" style={{ background: person.accent }}>
      <span className="team-page__initials">{person.initials}</span>
    </div>
  );
}

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h4v-5.5h2V20h4a1 1 0 0 0 1-1v-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The card back's content: name/role plus the full profile detail. Shared by the adviser's
 * featured card and the regular member cards so both flip to the same layout. */
function CardBackDetails({ person }: { person: TeamMember }) {
  return (
    <>
      <h2 className="team-page__card-name">{person.name}</h2>
      <p className="team-page__card-role">{person.role}</p>
      <div className="team-page__detail-rule" />
      {person.program && (
        <div className="team-page__detail-section">
          <p className="team-page__detail-title">🎓 Program</p>
          <p className="team-page__detail-body">{person.program}</p>
        </div>
      )}
      <div className="team-page__detail-section">
        <p className="team-page__detail-title">💻 Specialization</p>
        <p className="team-page__detail-body">{person.specialization}</p>
      </div>
      <div className="team-page__detail-section">
        <p className="team-page__detail-title">🛠️ Responsibilities</p>
        <ul className="team-page__detail-list">
          {person.responsibilities.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** A card that flips to its detail side while the mouse is over it, and toggles on click/tap
 * (for touch devices, which have no hover) — no click-triggered popup, the flip itself is the
 * reveal. Hovering and clicking are tracked as two separate flags rather than one shared
 * toggle: a real click always fires a synthetic mouse-enter first, so a plain toggle would
 * flip the card on, then immediately flip it right back off on the same click. Showing the
 * detail side whenever *either* flag is set means a click during a hover only reinforces it. */
function FlipCard({ person, featured }: { person: TeamMember; featured?: boolean }) {
  const [hovering, setHovering] = useState(false);
  const [clicked, setClicked] = useState(false);
  const flipped = hovering || clicked;

  return (
    <article
      className={"team-page__card" + (featured ? " team-page__card--featured" : "")}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false);
        setClicked(false);
      }}
      onClick={() => setClicked((c) => !c)}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={`${person.name}, ${person.role}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setClicked((c) => !c);
        }
      }}
    >
      <div className={"team-page__flip" + (flipped ? " team-page__flip--active" : "")}>
        <div className="team-page__face team-page__face--front">
          <div className="team-page__photo">
            <PersonPhoto person={person} />
          </div>
          {featured && <div className="team-page__card-grid" aria-hidden />}
          <div className="team-page__card-footer">
            {featured && <span className="team-page__badge">Project Adviser</span>}
            <h2 className="team-page__card-name">{person.name}</h2>
            <p className="team-page__card-role">{person.role}</p>
          </div>
        </div>
        <div className="team-page__face team-page__face--back">
          <div className="team-page__card-grid" aria-hidden />
          <div className="team-page__detail-content">
            <CardBackDetails person={person} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function TeamPage() {
  const [companyName, setCompanyName] = useState("Bukidnon Bus Company @BUKSU");

  useEffect(() => {
    document.title = "People Behind the System";
    let cancelled = false;
    void fetchPublicCompanyProfile()
      .then((p) => {
        if (cancelled) return;
        const n = String(p.name || "").trim();
        if (n) setCompanyName(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="team-page">
      <header className="team-page__nav">
        <Link to="/" className="team-page__brand">
          {companyName}
        </Link>
        <Link to="/" className="team-page__back" aria-label="Back home" title="Back home">
          <IconHome />
        </Link>
      </header>

      <div className="team-page__glow" aria-hidden />

      <div className="team-page__head">
        <p className="team-page__eyebrow">{companyName}</p>
        <h1 className="team-page__title">
          People Behind the
          <br />
          <span className="team-page__title-accent">System</span>
        </h1>
        <p className="team-page__sub">
          Meet the people behind the design, development, testing, and documentation of the {companyName} system.
        </p>
      </div>

      <div className="team-page__adviser-row">
        <FlipCard person={TEAM_ADVISER} featured />
      </div>

      <div className="team-page__grid">
        {TEAM_MEMBERS.map((person) => (
          <FlipCard key={person.id} person={person} />
        ))}
      </div>
    </div>
  );
}
