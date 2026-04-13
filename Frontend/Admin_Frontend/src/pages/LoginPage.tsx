import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import { useToast } from "@/context/ToastContext";
import { ALLOWED_ADMIN_GOOGLE_EMAILS } from "@/lib/adminAllowlist";
import { api, fetchPublicCompanyProfile, type PublicCompanyProfile } from "@/lib/api";
import { getFirebaseAuth, getGoogleAuthProvider, isFirebaseAuthConfigured } from "@/lib/firebase";
import { FirebaseError } from "firebase/app";
import { signInWithPopup, signOut } from "firebase/auth";
import "./LoginPage.css";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M3 10.5L12 3l9 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.5V20h13V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 7l7 5 7-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10V7.8a4 4 0 118 0V10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function LoginPage() {
  const { login, loginWithGoogle, token, loading } = useAuth();
  const { branding } = useAdminBranding();
  const { showError, showSuccess, showToast, showInfo } = useToast();
  const navigate = useNavigate();
  const [imgFailed, setImgFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpResetToken, setOtpResetToken] = useState("");
  const [otpPass, setOtpPass] = useState("");
  const [otpConfirm, setOtpConfirm] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpStep, setOtpStep] = useState<"email" | "verify" | "reset">("email");
  const [otpDevCode, setOtpDevCode] = useState<string | null>(null);
  const [otpServerHint, setOtpServerHint] = useState<string | null>(null);
  const [publicCo, setPublicCo] = useState<PublicCompanyProfile | null>(null);

  const companyName = (publicCo?.name || branding.companyName || "Admin portal").trim();
  const logoSrc = (publicCo?.logoUrl || branding.logoUrl || "").trim();
  const showLogoImg = Boolean(logoSrc && !imgFailed);

  useEffect(() => {
    void fetchPublicCompanyProfile()
      .then((p) => setPublicCo(p))
      .catch(() => setPublicCo(null));
  }, []);

  useEffect(() => {
    setImgFailed(false);
  }, [logoSrc]);

  useEffect(() => {
    if (loading || token) return;
    const key = "admin_notice_session_expired";
    if (sessionStorage.getItem(key) === "1") {
      sessionStorage.removeItem(key);
      showInfo("Session expired due to inactivity.");
    }
  }, [loading, token, showInfo]);

  if (loading) {
    return (
      <div className="glass-login__loading">
        <p>Loading…</p>
      </div>
    );
  }

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  function triggerShake() {
    setShake(true);
    window.setTimeout(() => setShake(false), 500);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      triggerShake();
      showError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleLogin() {
    const auth = getFirebaseAuth();
    if (!auth) {
      showToast("Google sign-in is not configured. Add VITE_FIREBASE_* keys to your .env file.", { variant: "info" });
      return;
    }
    setGoogleBusy(true);
    try {
      const cred = await signInWithPopup(auth, getGoogleAuthProvider());
      try {
        const idToken = await cred.user.getIdToken();
        await loginWithGoogle(idToken);
        navigate("/dashboard", { replace: true });
      } catch (apiErr) {
        await signOut(auth).catch(() => {});
        triggerShake();
        const msg = apiErr instanceof Error ? apiErr.message : "";
        if (/not authorized|whitelisted|Access Denied/i.test(msg)) {
          showError(`This Google account is not allowed. Only ${ALLOWED_ADMIN_GOOGLE_EMAILS.join(" and ")} can sign in.`);
        } else {
          showError(msg || "Could not complete admin login.");
        }
      }
    } catch (err) {
      if (err instanceof FirebaseError) {
        if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
          return;
        }
        if (err.code === "auth/configuration-not-found") {
          triggerShake();
          showToast(
            "Firebase Auth is not enabled for this project (or the API key is blocked). In Firebase Console: Authentication → Get started → Sign-in method → turn on Google. In Google Cloud Console: APIs → enable “Identity Toolkit API”. If the API key has restrictions, allow Identity Toolkit API (or use an unrestricted key for dev).",
            { variant: "info", durationMs: 12000 }
          );
          return;
        }
      }
      triggerShake();
      showError(err instanceof Error ? err.message : "Google login failed");
    } finally {
      setGoogleBusy(false);
    }
  }

  function openOtpRecovery() {
    setOtpEmail((prev) => (prev.trim() ? prev : email.trim()));
    setOtpOpen(true);
  }

  async function sendOtp() {
    const em = otpEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      showError("Please enter a valid email address.");
      return;
    }
    setOtpBusy(true);
    try {
      const r = await api<{
        message: string;
        simulatedEmail?: boolean;
        devOtp?: string;
        hint?: string;
      }>("/api/auth/forgot-password-otp", {
        method: "POST",
        json: { email: em },
      });
      setOtpDevCode(r.devOtp ?? null);
      setOtpServerHint(r.hint ?? null);
      if (r.simulatedEmail) {
        showToast(r.message, { variant: "info" });
      } else {
        showSuccess("OTP sent. Check your inbox (and spam).");
      }
      setOtpStep("verify");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to send OTP");
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyOtp() {
    setOtpBusy(true);
    try {
      const r = await api<{ resetToken: string; message: string }>("/api/auth/verify-otp", {
        method: "POST",
        json: { email: otpEmail.trim().toLowerCase(), otp: otpCode.trim() },
      });
      setOtpResetToken(r.resetToken);
      showSuccess("Code verified. Enter your new password below.");
      setOtpDevCode(null);
      setOtpServerHint(null);
      setOtpStep("reset");
    } catch (e) {
      showError(e instanceof Error ? e.message : "OTP verification failed");
    } finally {
      setOtpBusy(false);
    }
  }

  async function resetWithOtp() {
    if (otpPass.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }
    if (otpPass !== otpConfirm) {
      showError("Passwords do not match.");
      return;
    }
    setOtpBusy(true);
    try {
      const r = await api<{ message: string }>("/api/auth/reset-password", {
        method: "POST",
        json: { token: otpResetToken, password: otpPass, confirmPassword: otpConfirm },
      });
      showSuccess(r.message);
      setOtpOpen(false);
      setOtpStep("email");
      setOtpCode("");
      setOtpPass("");
      setOtpConfirm("");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Password reset failed");
    } finally {
      setOtpBusy(false);
    }
  }

  function closeOtp() {
    setOtpOpen(false);
    setOtpDevCode(null);
    setOtpServerHint(null);
    setOtpBusy(false);
    setOtpStep("email");
    setOtpCode("");
    setOtpPass("");
    setOtpConfirm("");
  }

  return (
    <div className="glass-login">
      <div className="glass-login__blobs" aria-hidden>
        <div className="glass-login__blob glass-login__blob--1" />
        <div className="glass-login__blob glass-login__blob--2" />
        <div className="glass-login__blob glass-login__blob--3" />
      </div>

      <div className={`glass-login__card ${shake ? "glass-login__card--shake" : ""}`}>
        <Link to="/" className="glass-login__home-inline" aria-label="Home">
          <HomeIcon />
        </Link>
        <div className="glass-login__logo-wrap">
          <div className="glass-login__logo" aria-hidden>
            {showLogoImg ? (
              <img src={logoSrc} alt="" className="glass-login__logo-img" onError={() => setImgFailed(true)} />
            ) : (
              <span className="glass-login__logo-fallback">{companyName.charAt(0).toUpperCase()}</span>
            )}
          </div>
        </div>
        <h1
          className={`glass-login__brand${companyName.length > 28 ? " glass-login__brand--long" : ""}`}
        >
          {companyName}
        </h1>
        <p className="glass-login__welcome">Welcome back, Admin</p>

        <form onSubmit={onSubmit} noValidate autoComplete="off">
          <label className="glass-login__field">
            <span className="glass-login__label">Email address</span>
            <div className="glass-login__input-wrap">
              <span className="glass-login__input-icon" aria-hidden>
                <MailIcon />
              </span>
              <input
                className="glass-login__input"
                type="email"
                autoComplete="off"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </label>

          <label className="glass-login__field">
            <span className="glass-login__label">Password</span>
            <div className="glass-login__input-wrap">
              <span className="glass-login__input-icon" aria-hidden>
                <LockIcon />
              </span>
              <input
                className="glass-login__input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </label>

          <button type="submit" className="glass-login__submit" disabled={busy || googleBusy}>
            {busy ? <span className="glass-login__spinner" aria-hidden /> : null}
            {busy ? "Logging in..." : "Login"}
          </button>

          <button
            type="button"
            className="glass-login__google"
            disabled={busy || googleBusy || !isFirebaseAuthConfigured()}
            title={
              !isFirebaseAuthConfigured()
                ? "Set VITE_FIREBASE_API_KEY, PROJECT_ID, and APP_ID in .env (auth domain defaults to PROJECT_ID.firebaseapp.com)"
                : undefined
            }
            onClick={() => void onGoogleLogin()}
          >
            {googleBusy ? <span className="glass-login__spinner" aria-hidden /> : null}
            <span className="glass-login__google-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            </span>
            {googleBusy ? "Signing in..." : "Login with Google"}
          </button>
          {!isFirebaseAuthConfigured() ? (
            <p className="glass-login__hint" role="note">
              Google login needs <code>VITE_FIREBASE_*</code> in <code>.env</code>. Email/password login still works.
            </p>
          ) : null}
        </form>

        <p className="glass-login__footer">
          <button type="button" className="glass-login__forgot-btn" onClick={openOtpRecovery}>
            Forget Password ?
          </button>
        </p>
      </div>

      {otpOpen ? (
        <div className="glass-login__otp-overlay" role="dialog" aria-modal="true">
          <div className="glass-login__otp-modal">
            <h2 className="glass-login__otp-title">Password Recovery</h2>
            {otpStep === "email" ? (
              <>
                <p className="glass-login__otp-sub">Enter your registered admin email to receive a 6-digit OTP.</p>
                <input
                  className="glass-login__input"
                  type="email"
                  value={otpEmail}
                  onChange={(e) => setOtpEmail(e.target.value)}
                  autoComplete="email"
                />
                <button type="button" className="glass-login__submit" disabled={otpBusy} onClick={() => void sendOtp()}>
                  {otpBusy ? <span className="glass-login__spinner" aria-hidden /> : null}
                  {otpBusy ? "Sending OTP..." : "Send OTP"}
                </button>
              </>
            ) : null}

            {otpStep === "verify" ? (
              <>
                <p className="glass-login__otp-sub">
                  Enter the 6-digit code from your email (or below if shown for local testing).
                </p>
                {otpServerHint ? <p className="glass-login__otp-hint">{otpServerHint}</p> : null}
                {otpDevCode ? (
                  <p className="glass-login__otp-dev" role="status" aria-live="polite">
                    Code for this session: <strong className="glass-login__otp-dev-digits">{otpDevCode}</strong>
                  </p>
                ) : null}
                <input
                  className="glass-login__input glass-login__input--otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                />
                <button type="button" className="glass-login__submit" disabled={otpBusy} onClick={() => void verifyOtp()}>
                  {otpBusy ? <span className="glass-login__spinner" aria-hidden /> : null}
                  {otpBusy ? "Verifying..." : "Verify OTP"}
                </button>
              </>
            ) : null}

            {otpStep === "reset" ? (
              <>
                <p className="glass-login__otp-sub">Set your new password.</p>
                <input
                  className="glass-login__input"
                  type="password"
                  placeholder="New password"
                  value={otpPass}
                  onChange={(e) => setOtpPass(e.target.value)}
                />
                <input
                  className="glass-login__input"
                  type="password"
                  placeholder="Confirm password"
                  value={otpConfirm}
                  onChange={(e) => setOtpConfirm(e.target.value)}
                />
                <button type="button" className="glass-login__submit" disabled={otpBusy} onClick={() => void resetWithOtp()}>
                  {otpBusy ? <span className="glass-login__spinner" aria-hidden /> : null}
                  {otpBusy ? "Updating..." : "Update Password"}
                </button>
              </>
            ) : null}

            <button type="button" className="glass-login__otp-close" onClick={closeOtp}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
