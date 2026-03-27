import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/context/ToastContext";

export function ResetPasswordPage() {
  const { showError } = useToast();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<"checking" | "valid" | "invalid">(
    token ? "checking" : "invalid"
  );
  const invalidToastShown = useRef(false);

  useEffect(() => {
    if (!token) {
      setTokenState("invalid");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ valid: boolean }>(
          `/api/auth/validate-reset-token?token=${encodeURIComponent(token)}`
        );
        if (!cancelled) setTokenState(r.valid ? "valid" : "invalid");
      } catch {
        if (!cancelled) setTokenState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (tokenState !== "invalid" || invalidToastShown.current || !token) return;
    invalidToastShown.current = true;
    showError("This reset link is invalid or has expired. Request a new one from the forgot password page.");
  }, [tokenState, token, showError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      showError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/auth/reset-password", {
        method: "POST",
        json: { token, password, confirmPassword: confirm },
      });
      setOkMsg(res.message);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Reset failed");
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
          <span className="auth-card__badge">Security</span>
          <h1 className="auth-card__title">Reset password</h1>
          <p className="auth-card__subtitle">Choose a strong password you have not used elsewhere.</p>
        </div>

        {tokenState === "checking" && <p className="auth-muted">Verifying link…</p>}

        {tokenState === "invalid" && (
          <div>
            <Link to="/forgot-password" className="auth-link-button auth-link-button--secondary">
              Request new link
            </Link>
          </div>
        )}

        {tokenState === "valid" && !okMsg && (
          <form onSubmit={onSubmit}>
            <label className="auth-field">
              <span className="auth-field__label">New password</span>
              <input
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
              />
            </label>
            <label className="auth-field">
              <span className="auth-field__label">Confirm password</span>
              <input
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        {okMsg && (
          <div className="auth-success">
            <p style={{ margin: 0, color: "var(--text)" }}>{okMsg}</p>
            <Link to="/login" className="auth-link-button" style={{ marginTop: "1rem" }}>
              Go to login
            </Link>
          </div>
        )}

        <p className="auth-footer">
          <Link to="/login">← Back to login</Link>
        </p>
      </div>
    </div>
  );
}
