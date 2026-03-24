import { useTheme } from "@/context/ThemeContext";

type Props = { className?: string };

export function ThemeToggle({ className }: Props) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        padding: "0.45rem 0.85rem",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--text)",
        fontSize: "0.85rem",
        fontWeight: 500,
      }}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
