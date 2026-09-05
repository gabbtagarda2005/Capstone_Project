import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AdminTheme = "dark" | "light";

const THEME_KEY = "admin_theme_v1";

type Ctx = {
  theme: AdminTheme;
  setTheme: (t: AdminTheme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

function readStoredTheme(): AdminTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AdminTheme>(() => readStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t: AdminTheme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);

  const value = useMemo<Ctx>(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAdminTheme(): Ctx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error("useAdminTheme must be used under ThemeProvider");
  return c;
}
