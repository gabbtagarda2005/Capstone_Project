import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";

type ForgotResponse = {
  message: string;
  simulated?: boolean;
  resetLink?: string;
};

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ForgotResponse | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<ForgotResponse>("/api/auth/forgot-password", {
        method: "POST",
        json: { email: email.trim() },
      });
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-shell__bar">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="auth-card__badge">Recovery</span>
          <h1 className="auth-card__title">Forgot password</h1>
          <p className="auth-card__subtitle">
            Enter your registered admin email. Only authorized admin accounts can receive a reset link.
          </p>
        </div>

        {done ? (
          <div className="auth-success">
            <p style={{ margin: "0 0 0.75rem", color: "var(--text)" }}>{done.message}</p>
            {done.resetLink && (
              <div className="auth-demo-link">
                <span className="auth-demo-link__label">Demo reset link (dev / simulated email)</span>
                <a href={done.resetLink} className="auth-demo-link__url">
                  {done.resetLink}
                </a>
              </div>
            )}
            <Link to="/login" className="auth-link-button">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <label className="auth-field">
              <span className="auth-field__label">Email</span>
              <input
                className="auth-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="auth-footer">
          <Link to="/login">← Back to login</Link>
        </p>
      </div>
    </div>
  );
}
