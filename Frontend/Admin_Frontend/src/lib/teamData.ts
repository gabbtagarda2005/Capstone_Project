export type TeamMember = {
  id: string;
  name: string;
  role: string;
  initials: string;
  accent: string;
  /** Optional real photo — when set, the card shows this image instead of the initials
   * placeholder. Drop a photo URL/import in here per-person once portraits are available. */
  photoUrl?: string;
  /** Extra detail shown in the profile modal opened by clicking a card. */
  specialization: string;
  contribution: string;
  responsibilities: string[];
  /** Academic program — omitted for the adviser, who isn't a student. */
  program?: string;
};

/** Real names/roles as provided — do not invent bios, photos, or extra details. */
export const TEAM_ADVISER: TeamMember = {
  id: "adviser",
  name: "Raul Lecaros",
  role: "Adviser",
  initials: "RL",
  accent: "linear-gradient(135deg, #22d3ee, #a855f7)",
  specialization: "Information Technology / Systems Development",
  contribution: "Project guidance, consultation, and supervision",
  responsibilities: ["Project Guidance", "Consultation", "Supervision"],
};

export const TEAM_MEMBERS: TeamMember[] = [
  {
    id: "m1",
    name: "Aguilar, Mhylles Gabb T.",
    role: "Programmer and UI Designer",
    initials: "MA",
    accent: "linear-gradient(135deg, #22d3ee, #38bdf8)",
    program: "BS Information Technology",
    specialization: "Web Development & UI/UX",
    contribution: "Programming, system interface, and user experience",
    responsibilities: ["System Programming", "UI/UX Design", "Frontend Development"],
  },
  {
    id: "m2",
    name: "Adolfo, Christian Rey L.",
    role: "Database, QA, and Programmer",
    initials: "CA",
    accent: "linear-gradient(135deg, #a855f7, #e879f9)",
    program: "BS Information Technology",
    specialization: "Database & Software Testing",
    contribution: "Database development, programming, and quality assurance",
    responsibilities: ["Database Development", "Programming", "Quality Assurance"],
  },
  {
    id: "m3",
    name: "Pahanggin, Danica M.",
    role: "Documentation, QA, and UI",
    initials: "DP",
    accent: "linear-gradient(135deg, #fb923c, #fbbf24)",
    program: "BS Information Technology",
    specialization: "Documentation, UI/UX & Testing",
    contribution: "Documentation, interface design, and quality assurance",
    responsibilities: ["Documentation", "Interface Design", "Quality Assurance"],
  },
  {
    id: "m4",
    name: "De la Cerna, Erich Lorain T.",
    role: "Documentation, Presenter, QA and UI",
    initials: "EL",
    accent: "linear-gradient(135deg, #a3e635, #22d3ee)",
    program: "BS Information Technology",
    specialization: "Presentation, UI/UX & Testing",
    contribution: "Documentation, presentations, interface design, and quality assurance",
    responsibilities: ["Documentation", "Presentations", "Interface Design", "Quality Assurance"],
  },
];
