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

/** Full profile detail shown when a card is clicked/tapped. */
function ProfileModal({ person, onClose }: { person: TeamMember; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="team-modal__overlay" onClick={onClose}>
      <div
        className="team-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="team-modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="team-modal__avatar" style={{ background: person.accent }}>
          {person.photoUrl ? (
            <img src={person.photoUrl} alt={person.name} />
          ) : (
            <span>{person.initials}</span>
          )}
        </div>

        <h2 className="team-modal__name">{person.name}</h2>
        <p className="team-modal__role">{person.role}</p>

        {person.program && (
          <div className="team-modal__section">
            <p className="team-modal__section-title">🎓 Program</p>
            <p className="team-modal__section-body">{person.program}</p>
          </div>
        )}

        <div className="team-modal__section">
          <p className="team-modal__section-title">💻 Specialization</p>
          <p className="team-modal__section-body">{person.specialization}</p>
        </div>

        <div className="team-modal__section">
          <p className="team-modal__section-title">🛠️ Responsibilities</p>
          <ul className="team-modal__list">
            {person.responsibilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <button className="team-modal__close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** A member card that flips to its info side while the mouse is over it (desktop preview),
 * and opens the full profile modal on click/tap — the primary way to see the details on
 * touch devices, which have no hover. */
function MemberCard({ person, onOpen }: { person: TeamMember; onOpen: (person: TeamMember) => void }) {
  const [hovering, setHovering] = useState(false);

  return (
    <article
      className="team-page__card"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => onOpen(person)}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`${person.name}, ${person.role}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(person);
        }
      }}
    >
      <div className={"team-page__flip" + (hovering ? " team-page__flip--active" : "")}>
        <div className="team-page__face team-page__face--front">
          <div className="team-page__photo">
            <PersonPhoto person={person} />
          </div>
          <div className="team-page__card-footer">
            <h2 className="team-page__card-name">{person.name}</h2>
            <p className="team-page__card-role">{person.role}</p>
          </div>
        </div>
        <div className="team-page__face team-page__face--back">
          <div className="team-page__card-grid" aria-hidden />
          <div className="team-page__card-footer team-page__card-footer--back">
            <h2 className="team-page__card-name">{person.name}</h2>
            <p className="team-page__card-role">{person.role}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

export function TeamPage() {
  const [companyName, setCompanyName] = useState("Bukidnon Bus Company @BUKSU");
  const [activePerson, setActivePerson] = useState<TeamMember | null>(null);

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
        <article
          className="team-page__card team-page__card--featured"
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-label={`${TEAM_ADVISER.name}, ${TEAM_ADVISER.role}`}
          onClick={() => setActivePerson(TEAM_ADVISER)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActivePerson(TEAM_ADVISER);
            }
          }}
        >
          <div className="team-page__photo">
            <PersonPhoto person={TEAM_ADVISER} />
          </div>
          <div className="team-page__card-grid" aria-hidden />
          <div className="team-page__card-footer">
            <span className="team-page__badge">Project Adviser</span>
            <h2 className="team-page__card-name">{TEAM_ADVISER.name}</h2>
            <p className="team-page__card-role">{TEAM_ADVISER.role}</p>
          </div>
        </article>
      </div>

      <div className="team-page__grid">
        {TEAM_MEMBERS.map((person) => (
          <MemberCard key={person.id} person={person} onOpen={setActivePerson} />
        ))}
      </div>

      {activePerson && <ProfileModal person={activePerson} onClose={() => setActivePerson(null)} />}
    </div>
  );
}
