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

export function TeamPage() {
  const [companyName, setCompanyName] = useState("Bukidnon Bus Company @BUKSU");
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());

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

  const toggleActive = (id: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        <article className="team-page__card team-page__card--featured">
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
        {TEAM_MEMBERS.map((person) => {
          const isActive = activeIds.has(person.id);
          return (
            <article
              key={person.id}
              className={"team-page__card" + (isActive ? " team-page__card--active" : "")}
              onClick={() => toggleActive(person.id)}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleActive(person.id);
                }
              }}
            >
              <div className="team-page__photo">
                <PersonPhoto person={person} />
              </div>
              <div className="team-page__card-panel" aria-hidden />
              <div className="team-page__card-grid" aria-hidden />
              <div className="team-page__card-footer">
                <h2 className="team-page__card-name">{person.name}</h2>
                <p className="team-page__card-role">{person.role}</p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
