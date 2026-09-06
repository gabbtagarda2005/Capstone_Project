export type TeamMember = {
  id: string;
  name: string;
  role: string;
  initials: string;
  accent: string;
};

/** Real names/roles as provided — do not invent bios, photos, or extra details. */
export const TEAM_ADVISER: TeamMember = {
  id: "adviser",
  name: "Raul Lecaros",
  role: "Adviser",
  initials: "RL",
  accent: "linear-gradient(135deg, #22d3ee, #a855f7)",
};

export const TEAM_MEMBERS: TeamMember[] = [
  {
    id: "m1",
    name: "Mhyles Gabb T. Aguilar",
    role: "Programmer and UI Designer",
    initials: "MA",
    accent: "linear-gradient(135deg, #22d3ee, #38bdf8)",
  },
  {
    id: "m2",
    name: "Christian Rey Adolfo",
    role: "Database, QA, and Programmer",
    initials: "CA",
    accent: "linear-gradient(135deg, #a855f7, #e879f9)",
  },
  {
    id: "m3",
    name: "Danica Pahanggin",
    role: "Documentation, QA, and UI",
    initials: "DP",
    accent: "linear-gradient(135deg, #fb923c, #fbbf24)",
  },
  {
    id: "m4",
    name: "De la Cerna, Erich Lorain T.",
    role: "Documentation, Presenter, QA and UI",
    initials: "EL",
    accent: "linear-gradient(135deg, #a3e635, #22d3ee)",
  },
];
