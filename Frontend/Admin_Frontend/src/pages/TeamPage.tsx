import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicCompanyProfile } from "@/lib/api";
import { TEAM_ADVISER, TEAM_MEMBERS } from "@/lib/teamData";
import "./TeamPage.css";

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
        <Link to="/" className="team-page__back">
          ← Back home
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
          <div className="team-page__card-grid" aria-hidden />
          <div className="team-page__avatar team-page__avatar--featured" style={{ background: TEAM_ADVISER.accent }}>
            {TEAM_ADVISER.initials}
          </div>
          <span className="team-page__badge">Project Adviser</span>
          <h2 className="team-page__card-name">{TEAM_ADVISER.name}</h2>
          <p className="team-page__card-role">{TEAM_ADVISER.role}</p>
        </article>
      </div>

      <div className="team-page__grid">
        {TEAM_MEMBERS.map((person) => (
          <article key={person.id} className="team-page__card">
            <div className="team-page__card-grid" aria-hidden />
            <div className="team-page__avatar" style={{ background: person.accent }}>
              {person.initials}
            </div>
            <h2 className="team-page__card-name">{person.name}</h2>
            <p className="team-page__card-role">{person.role}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
