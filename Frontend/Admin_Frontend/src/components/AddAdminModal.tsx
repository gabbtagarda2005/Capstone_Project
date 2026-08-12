import { useEffect, useState, type FormEvent } from "react";
import { createItAccount, sendItAccountOtp, verifyItAccountOtp } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { pushAdminAudit } from "@/lib/adminAudit";
import "./AddAdminModal.css";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type Step = "email" | "otp" | "password";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** IT accounts always get the fixed "it_support" role — a restricted view with no dashboard
 * access beyond System Health, so there's nothing for the admin to pick here. The email is
 * OTP-verified before a password is ever collected, so the account is real and working the
 * moment this closes — no separate server allowlist step. */
export function AddAdminModal({ isOpen, onClose, onSaved }: Props) {
  const { showError, showSuccess } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetAll() {
    setStep("email");
    setEmail("");
    setOtp("");
    setPassword("");
    setConfirmPassword("");
    setResetToken("");
    setDevOtp(null);
    setOtpHint(null);
    setBusy(false);
  }

  useEffect(() => {
    if (isOpen) resetAll();
  }, [isOpen]);

  if (!isOpen) return null;

  function handleClose() {
    resetAll();
    onClose();
  }

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) {
      showError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const r = await sendItAccountOtp(em);
      setEmail(em);
      setDevOtp(r.devOtp ?? null);
      setOtpHint(r.hint ?? null);
      if (r.simulatedEmail) {
        showSuccess(r.message);
      } else {
        showSuccess("Code sent. Check that inbox (and spam).");
      }
      setStep("otp");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not send verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      showError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const r = await verifyItAccountOtp(email, code);
      setResetToken(r.resetToken);
      setDevOtp(null);
      setOtpHint(null);
      showSuccess("Code verified. Set a password to finish.");
      setStep("password");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAccount(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      showError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await createItAccount(resetToken, password, confirmPassword);
      pushAdminAudit({
        admin: user?.email ?? "Admin",
        action: `System: Created IT account ${email} (System Health access only).`,
        level: "SUCCESS",
      });
      showSuccess(`IT account created for ${email}. They can sign in now.`);
      onSaved();
      handleClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not create IT account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-admin-modal__backdrop" role="presentation" onMouseDown={handleClose}>
      <div
        className="add-admin-modal"
        role="dialog"
        aria-labelledby="add-admin-modal-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="add-admin-modal__glow" aria-hidden />
        <div className="add-admin-modal__head">
          <div className="add-admin-modal__head-row">
            <button type="button" className="add-admin-modal__back-icon" aria-label="Close" onClick={handleClose}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
                <path
                  fill="currentColor"
                  d="M18.3 5.71 12 12.01l6.3 6.3-1.41 1.41L10.59 13.4l-6.3 6.3-1.41-1.41 6.3-6.3-6.3-6.3L4.29 4.28l6.3 6.3 6.3-6.3z"
                />
              </svg>
            </button>
            <div className="add-admin-modal__head-main">
              <h2 id="add-admin-modal-title" className="add-admin-modal__title">
                Add IT account
              </h2>
              <p className="add-admin-modal__eyebrow">
                {step === "email" ? "Step 1 of 3 — Email" : step === "otp" ? "Step 2 of 3 — Verify" : "Step 3 of 3 — Password"}
              </p>
            </div>
          </div>
        </div>

        {step === "email" ? (
          <form className="add-admin-modal__form" onSubmit={(ev) => void handleSendOtp(ev)}>
            <p className="add-admin-modal__lead">
              IT accounts are locked to <strong>System Health</strong> only — the admin API, database, and mail
              status — nothing else in the portal. We&apos;ll email a 6-digit code to confirm this address before
              it gets a working login.
            </p>
            <label className="add-admin-modal__field">
              <span className="add-admin-modal__label">Email</span>
              <input
                className="add-admin-modal__input"
                type="email"
                autoComplete="off"
                placeholder="it-support@bukidnonbuscompany.com"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                autoFocus
              />
            </label>
            <div className="add-admin-modal__actions">
              <button type="button" className="add-admin-modal__btn add-admin-modal__btn--ghost" onClick={handleClose}>
                Cancel
              </button>
              <button type="submit" className="add-admin-modal__btn add-admin-modal__btn--primary" disabled={busy}>
                {busy ? "Sending…" : "Send code"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "otp" ? (
          <form className="add-admin-modal__form" onSubmit={(ev) => void handleVerifyOtp(ev)}>
            <p className="add-admin-modal__lead">
              Enter the 6-digit code sent to <strong>{email}</strong>.
            </p>
            {otpHint ? <p className="add-admin-modal__hint">{otpHint}</p> : null}
            {devOtp ? (
              <p className="add-admin-modal__hint" role="status" aria-live="polite">
                Code for this session: <strong>{devOtp}</strong>
              </p>
            ) : null}
            <label className="add-admin-modal__field">
              <span className="add-admin-modal__label">6-digit code</span>
              <input
                className="add-admin-modal__input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(ev) => setOtp(ev.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </label>
            <div className="add-admin-modal__actions">
              <button
                type="button"
                className="add-admin-modal__btn add-admin-modal__btn--ghost"
                onClick={() => setStep("email")}
              >
                Back
              </button>
              <button type="submit" className="add-admin-modal__btn add-admin-modal__btn--primary" disabled={busy}>
                {busy ? "Verifying…" : "Verify code"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "password" ? (
          <form className="add-admin-modal__form" onSubmit={(ev) => void handleCreateAccount(ev)}>
            <p className="add-admin-modal__lead">
              Set a password for <strong>{email}</strong>. This finishes creating the account — it will be able to
              sign in immediately, restricted to System Health.
            </p>
            <label className="add-admin-modal__field">
              <span className="add-admin-modal__label">Password</span>
              <input
                className="add-admin-modal__input"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                autoFocus
              />
            </label>
            <label className="add-admin-modal__field">
              <span className="add-admin-modal__label">Confirm password</span>
              <input
                className="add-admin-modal__input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(ev) => setConfirmPassword(ev.target.value)}
              />
            </label>
            <div className="add-admin-modal__actions">
              <button
                type="button"
                className="add-admin-modal__btn add-admin-modal__btn--ghost"
                onClick={() => setStep("otp")}
              >
                Back
              </button>
              <button type="submit" className="add-admin-modal__btn add-admin-modal__btn--primary" disabled={busy}>
                {busy ? "Saving…" : "Save IT account"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
