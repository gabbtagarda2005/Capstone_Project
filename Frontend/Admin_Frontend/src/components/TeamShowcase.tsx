import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./TeamShowcase.css";

type TeamMember = {
  id: string;
  name: string;
  role: string;
  initials: string;
  accent: string;
};

/** Real names/roles as provided — do not invent bios, photos, or extra details. */
const ADVISER: TeamMember = {
  id: "adviser",
  name: "Raul Lecaros",
  role: "Adviser",
  initials: "RL",
  accent: "linear-gradient(135deg, var(--neo-cyan), var(--neo-purple))",
};

const MEMBERS: TeamMember[] = [
  {
    id: "m1",
    name: "Mhyles Gabb T. Aguilar",
    role: "Programmer and UI Designer",
    initials: "MA",
    accent: "linear-gradient(135deg, var(--neo-cyan), #38bdf8)",
  },
  {
    id: "m2",
    name: "Christian Rey Adolfo",
    role: "Database, QA, and Programmer",
    initials: "CA",
    accent: "linear-gradient(135deg, var(--neo-purple), var(--neo-magenta))",
  },
  {
    id: "m3",
    name: "Danica Pahanggin",
    role: "Documentation, QA, and UI",
    initials: "DP",
    accent: "linear-gradient(135deg, var(--neo-orange), #fbbf24)",
  },
  {
    id: "m4",
    name: "De la Cerna, Erich Lorain T.",
    role: "Documentation, Presenter, QA and UI",
    initials: "EL",
    accent: "linear-gradient(135deg, var(--neo-lime), #22d3ee)",
  },
];

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

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function IconChevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
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

type Props = {
  /** "admin" (default) reads the --neo-* tokens scoped on .admin-shell. "landing" reads the
   * public landing page's --lp-* tokens instead — see the --neo-* remapping on the
   * *--landing modifier classes in TeamShowcase.css. */
  variant?: "admin" | "landing";
  /** The company name configured in Admin → Settings → Branding (falls back if not passed). */
  companyName?: string;
};

export function TeamShowcase({ variant = "admin", companyName = "Bukidnon Bus Company @BUKSU" }: Props) {
  const isLanding = variant === "landing";
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollable, setScrollable] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const track = trackRef.current;
    if (!track) return;
    const update = () => setScrollable(track.scrollWidth > track.clientWidth + 4);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(track);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.firstElementChild as HTMLElement | null;
    if (!first) return;
    const style = getComputedStyle(track);
    const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
    const step = first.offsetWidth + gap;
    if (step > 0) setActiveIndex(Math.round(track.scrollLeft / step));
  };

  const scrollToIndex = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(MEMBERS.length - 1, index));
    const card = track.children[clamped] as HTMLElement | undefined;
    if (card) track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
  };

  return (
    <>
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
        <button type="button" className="team-teaser__btn" onClick={() => setOpen(true)}>
          <IconUsers />
          <span>Meet the Team</span>
        </button>
      </section>

      {open
        ? createPortal(
            <div
              className={"team-modal-backdrop" + (isLanding ? " team-modal-backdrop--landing" : "")}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              <div className="team-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title">
            <div className="team-modal__head">
              <div>
                <p className="team-modal__eyebrow">{companyName}</p>
                <h2 id="team-modal-title" className="team-modal__title">
                  People Behind the System
                </h2>
              </div>
              <button
                type="button"
                ref={closeBtnRef}
                className="team-modal__close"
                onClick={() => setOpen(false)}
                aria-label="Close team showcase"
              >
                <IconClose />
              </button>
            </div>

            <div className="team-modal__body">
              <article className="team-adviser-card">
                <div className="team-avatar team-avatar--adviser" style={{ background: ADVISER.accent }} aria-hidden>
                  {ADVISER.initials}
                </div>
                <div className="team-adviser-card__info">
                  <span className="team-adviser-card__badge">Project Adviser</span>
                  <h3 className="team-adviser-card__name">{ADVISER.name}</h3>
                  <p className="team-adviser-card__role">{ADVISER.role}</p>
                </div>
              </article>

              <div className="team-carousel">
                {scrollable ? (
                  <button
                    type="button"
                    className="team-carousel__arrow team-carousel__arrow--prev"
                    onClick={() => scrollToIndex(activeIndex - 1)}
                    disabled={activeIndex <= 0}
                    aria-label="Previous team member"
                  >
                    <IconChevron direction="left" />
                  </button>
                ) : null}

                <div className="team-carousel__track" ref={trackRef} onScroll={handleScroll}>
                  {MEMBERS.map((m) => (
                    <article key={m.id} className="team-member-card">
                      <div className="team-avatar" style={{ background: m.accent }} aria-hidden>
                        {m.initials}
                      </div>
                      <h4 className="team-member-card__name">{m.name}</h4>
                      <p className="team-member-card__role">{m.role}</p>
                    </article>
                  ))}
                </div>

                {scrollable ? (
                  <button
                    type="button"
                    className="team-carousel__arrow team-carousel__arrow--next"
                    onClick={() => scrollToIndex(activeIndex + 1)}
                    disabled={activeIndex >= MEMBERS.length - 1}
                    aria-label="Next team member"
                  >
                    <IconChevron direction="right" />
                  </button>
                ) : null}
              </div>

              {scrollable ? (
                <div className="team-carousel__dots" role="tablist" aria-label="Team member pagination">
                  {MEMBERS.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      role="tab"
                      className={"team-carousel__dot" + (i === activeIndex ? " team-carousel__dot--active" : "")}
                      onClick={() => scrollToIndex(i)}
                      aria-selected={i === activeIndex}
                      aria-label={`Show ${m.name}`}
                    />
                  ))}
                </div>
              ) : null}
              </div>
            </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
