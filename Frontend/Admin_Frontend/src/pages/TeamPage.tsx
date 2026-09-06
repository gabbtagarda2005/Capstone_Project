import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPublicCompanyProfile } from "@/lib/api";
import { TEAM_ADVISER, TEAM_MEMBERS, type TeamMember } from "@/lib/teamData";
import "./TeamPage.css";

const ALL_PEOPLE: (TeamMember & { isAdviser?: boolean })[] = [
  { ...TEAM_ADVISER, isAdviser: true },
  ...TEAM_MEMBERS,
];

function IconArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TeamPage() {
  const [companyName, setCompanyName] = useState("Bukidnon Bus Company @BUKSU");
  const trackRef = useRef<HTMLDivElement>(null);
  const [barLeft, setBarLeft] = useState(0);
  const [barWidth, setBarWidth] = useState(30);

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

  const updateBar = () => {
    const track = trackRef.current;
    if (!track) return;
    const { scrollLeft, scrollWidth, clientWidth } = track;
    if (scrollWidth <= clientWidth) {
      setBarLeft(0);
      setBarWidth(100);
      return;
    }
    const widthPct = Math.max(12, (clientWidth / scrollWidth) * 100);
    const maxLeft = 100 - widthPct;
    const leftPct = (scrollLeft / (scrollWidth - clientWidth)) * maxLeft;
    setBarWidth(widthPct);
    setBarLeft(leftPct);
  };

  useEffect(() => {
    updateBar();
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(updateBar);
    ro.observe(track);
    window.addEventListener("resize", updateBar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateBar);
    };
  }, []);

  const scrollByCard = (dir: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.firstElementChild as HTMLElement | null;
    const step = card ? card.offsetWidth + 24 : 280;
    track.scrollBy({ left: dir * step, behavior: "smooth" });
  };

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

      <div className="team-page__carousel">
        <button
          type="button"
          className="team-page__arrow team-page__arrow--prev"
          onClick={() => scrollByCard(-1)}
          aria-label="Previous person"
        >
          <IconArrow direction="left" />
        </button>

        <div className="team-page__track" ref={trackRef} onScroll={updateBar}>
          {ALL_PEOPLE.map((person) =>
            person.isAdviser ? (
              <article key={person.id} className="team-page__card team-page__card--featured">
                <div className="team-page__card-grid" aria-hidden />
                <div className="team-page__avatar team-page__avatar--featured" style={{ background: person.accent }}>
                  {person.initials}
                </div>
                <span className="team-page__badge">Project Adviser</span>
                <h2 className="team-page__card-name">{person.name}</h2>
                <p className="team-page__card-role">{person.role}</p>
              </article>
            ) : (
              <article key={person.id} className="team-page__card">
                <div className="team-page__avatar" style={{ background: person.accent }}>
                  {person.initials}
                </div>
                <div className="team-page__card-footer">
                  <h2 className="team-page__card-name">{person.name}</h2>
                  <p className="team-page__card-role">{person.role}</p>
                </div>
              </article>
            )
          )}
        </div>

        <button
          type="button"
          className="team-page__arrow team-page__arrow--next"
          onClick={() => scrollByCard(1)}
          aria-label="Next person"
        >
          <IconArrow direction="right" />
        </button>
      </div>

      <div className="team-page__progress" aria-hidden>
        <div className="team-page__progress-bar" style={{ left: `${barLeft}%`, width: `${barWidth}%` }} />
      </div>
    </div>
  );
}
