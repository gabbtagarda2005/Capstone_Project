import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { pushAdminAudit } from "@/lib/adminAudit";
import { MAX_PROFILE_IMAGE_DATA_URL_CHARS, profileImageFileToDataUrl } from "@/lib/compressProfileImage";
import "./AddAttendantWizard.css";

/** Before compression; larger phone photos are OK — we resize before upload. */
const MAX_IMAGE_PICK_BYTES = 12 * 1024 * 1024;

type Step = 1 | 2 | 3;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const RESEND_SECONDS = 59;

export function AddAttendantWizard({ isOpen, onClose, onSaved }: Props) {
  const { showError, showSuccess } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [signupToken, setSignupToken] = useState<string | null>(null);
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [resendLeft, setResendLeft] = useState(0);
  const [checking, setChecking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  /** JPEG data URL for preview + save — same pattern as Settings branding logo (no Firebase). */
  const [profileImageDataUrl, setProfileImageDataUrl] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const profileFileRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setStep(1);
    setEmail("");
    setSignupToken(null);
    setOtpDigits(["", "", "", "", "", ""]);
    setResendLeft(0);
    setFirstName("");
    setLastName("");
    setMiddleName("");
    setPhone("");
    setPassword("");
    setProfileImageDataUrl(null);
    setPreparingPhoto(false);
    if (profileFileRef.current) profileFileRef.current.value = "";
  }, []);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, reset]);

  useEffect(() => {
    if (resendLeft <= 0) return;
    const t = window.setInterval(() => setResendLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [resendLeft]);

  if (!isOpen) return null;

  function handleHeaderBack() {
    if (step === 1) onClose();
    else if (step === 2) setStep(1);
    else setStep(2);
  }

  async function handleCheckEmail(e: FormEvent) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      showError("Enter a valid email address.");
      return;
    }
    setChecking(true);
    try {
      const res = await api<{ message: string; devOtp?: string; hint?: string; simulatedEmail?: boolean }>(
        "/api/attendants/verify-email",
        { method: "POST", json: { email: em } }
      );
      showSuccess(res.message);
      if (res.devOtp) showSuccess(`Dev OTP: ${res.devOtp}`);
      setEmail(em);
      setStep(2);
      setResendLeft(RESEND_SECONDS);
      setOtpDigits(["", "", "", "", "", ""]);
      setTimeout(() => otpRefs.current[0]?.focus(), 80);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  async function handleResendOtp() {
    if (resendLeft > 0) return;
    setChecking(true);
    try {
      const res = await api<{ message: string; devOtp?: string }>("/api/attendants/verify-email", {
        method: "POST",
        json: { email },
      });
      showSuccess(res.message);
      if (res.devOtp) showSuccess(`Dev OTP: ${res.devOtp}`);
      setResendLeft(RESEND_SECONDS);
      setOtpDigits(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Resend failed");
    } finally {
      setChecking(false);
    }
  }

  function setOtpAt(i: number, val: string) {
    const d = val.replace(/\D/g, "").slice(-1);
    const next = [...otpDigits];
    next[i] = d;
    setOtpDigits(next);
    if (d && i < 5) otpRefs.current[i + 1]?.focus();
  }

  function onOtpKeyDown(i: number, key: string) {
    if (key === "Backspace" && !otpDigits[i] && i > 0) otpRefs.current[i - 1]?.focus();
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    const code = otpDigits.join("");
    if (code.length !== 6) {
      showError("Enter the full 6-digit code.");
      return;
    }
    setVerifying(true);
    try {
      const res = await api<{ signupToken: string; email: string }>("/api/attendants/verify-otp", {
        method: "POST",
        json: { email, otp: code },
      });
      setSignupToken(res.signupToken);
      setStep(3);
      showSuccess("Identity verified — complete the profile below.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function onProfileFileChange(file: File | null) {
    if (!file) {
      setProfileImageDataUrl(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      showError("Choose an image file (JPG, PNG, etc.).");
      return;
    }
    if (file.size > MAX_IMAGE_PICK_BYTES) {
      showError("Image is too large. Use one under 12MB.");
      return;
    }

    setPreparingPhoto(true);
    try {
      const dataUrl = await profileImageFileToDataUrl(file);
      if (dataUrl.length > MAX_PROFILE_IMAGE_DATA_URL_CHARS) {
        showError("Photo is still too large after resizing. Try a simpler image.");
        return;
      }
      setProfileImageDataUrl(dataUrl);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not process image.");
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!signupToken) {
      showError("Session expired — verify OTP again.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      showError("First and last name are required.");
      return;
    }
    if (password.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }
    if (preparingPhoto) {
      showError("Please wait for the photo to finish processing.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/attendants/save-attendant", {
        method: "POST",
        authToken: signupToken,
        json: {
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          middleName: middleName.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
          profileImageUrl: profileImageDataUrl || undefined,
        },
      });
      const display = `${firstName.trim()} ${lastName.trim()}`.trim();
      pushAdminAudit({
        admin: user?.email ?? "Admin",
        action: `System: New attendant ${display} verified via Gmail OTP.`,
        level: "SUCCESS",
      });
      showSuccess("Attendant saved and verified.");
      onSaved();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="add-att-wiz__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="add-att-wiz"
        role="dialog"
        aria-labelledby="add-att-wiz-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="add-att-wiz__glow" aria-hidden />
        <div className="add-att-wiz__head">
          <div className="add-att-wiz__head-row">
            <button
              type="button"
              className="add-att-wiz__back-icon"
              aria-label={step === 1 ? "Close" : "Back"}
              onClick={handleHeaderBack}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                <path
                  fill="currentColor"
                  d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
                />
              </svg>
            </button>
            <div className="add-att-wiz__head-main">
              <h2 id="add-att-wiz-title" className="add-att-wiz__title">
                Add bus attendant
              </h2>
              <div className="add-att-wiz__steps">
                <span className={step >= 1 ? "add-att-wiz__step add-att-wiz__step--on" : "add-att-wiz__step"}>1 Email</span>
                <span className="add-att-wiz__step-sep" aria-hidden>
                  ·
                </span>
                <span className={step >= 2 ? "add-att-wiz__step add-att-wiz__step--on" : "add-att-wiz__step"}>2 OTP</span>
                <span className="add-att-wiz__step-sep" aria-hidden>
                  ·
                </span>
                <span className={step >= 3 ? "add-att-wiz__step add-att-wiz__step--on" : "add-att-wiz__step"}>3 Profile</span>
              </div>
            </div>
          </div>
        </div>

        {step === 1 ? (
          <form className="add-att-wiz__form" onSubmit={handleCheckEmail}>
            <p className="add-att-wiz__lead">
              Enter the attendant&apos;s institutional email. We&apos;ll check that it isn&apos;t already registered, then send a one-time code to
              their inbox.
            </p>
            <label className="add-att-wiz__field">
              <span className="add-att-wiz__label">Email</span>
              <input
                className="add-att-wiz__input"
                type="email"
                autoComplete="off"
                placeholder="attendant@student.buksu.edu.ph"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </label>
            <div className="add-att-wiz__actions">
              <button type="button" className="add-att-wiz__btn add-att-wiz__btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="add-att-wiz__btn add-att-wiz__btn--primary" disabled={checking}>
                {checking ? "Checking…" : "Check & send OTP"}
              </button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <form className="add-att-wiz__form" onSubmit={handleVerifyOtp}>
            <p className="add-att-wiz__lead">
              Enter the <strong>6-digit code</strong> sent to <span className="add-att-wiz__em">{email}</span>.
            </p>
            <div className="add-att-wiz__otp-row" role="group" aria-label="One-time code">
              {otpDigits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  className="add-att-wiz__otp-cell"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  autoComplete="one-time-code"
                  onChange={(ev) => setOtpAt(i, ev.target.value)}
                  onKeyDown={(ev) => onOtpKeyDown(i, ev.key)}
                />
              ))}
            </div>
            <p className="add-att-wiz__resend">
              {resendLeft > 0 ? (
                <span className="add-att-wiz__resend-timer">Resend OTP in {resendLeft}s</span>
              ) : (
                <button type="button" className="add-att-wiz__link" onClick={() => void handleResendOtp()} disabled={checking}>
                  Resend OTP
                </button>
              )}
            </p>
            <div className="add-att-wiz__actions">
              <button type="button" className="add-att-wiz__btn add-att-wiz__btn--ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="submit" className="add-att-wiz__btn add-att-wiz__btn--primary" disabled={verifying}>
                {verifying ? "Verifying…" : "Verify code"}
              </button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form className="add-att-wiz__form add-att-wiz__form--bento" onSubmit={handleSaveProfile}>
            <p className="add-att-wiz__lead">Profile is unlocked. Set credentials for the attendant app.</p>
            <div className="add-att-wiz__bento">
              <div className="add-att-wiz__bento-card add-att-wiz__bento-card--identity">
                <h3 className="add-att-wiz__bento-title">Identity</h3>
                <div className="add-att-wiz__avatar-wrap">
                  <button
                    type="button"
                    className="add-att-wiz__avatar-hit"
                    disabled={preparingPhoto}
                    onClick={() => profileFileRef.current?.click()}
                    aria-label={profileImageDataUrl ? "Change profile photo" : "Upload profile photo"}
                  >
                    <div
                      className="add-att-wiz__avatar-preview"
                      style={
                        profileImageDataUrl
                          ? { backgroundImage: `url(${profileImageDataUrl})` }
                          : { background: "rgba(255,255,255,0.06)" }
                      }
                    >
                      {preparingPhoto ? <span className="add-att-wiz__avatar-spinner" aria-hidden /> : null}
                    </div>
                  </button>
                  <input
                    ref={profileFileRef}
                    type="file"
                    accept="image/*"
                    className="add-att-wiz__file-input"
                    onChange={(ev) => void onProfileFileChange(ev.target.files?.[0] ?? null)}
                    disabled={preparingPhoto}
                  />
                  <button
                    type="button"
                    className="add-att-wiz__upload-btn"
                    disabled={preparingPhoto}
                    onClick={() => profileFileRef.current?.click()}
                  >
                    {preparingPhoto ? "Preparing…" : profileImageDataUrl ? "Change photo" : "Upload photo"}
                  </button>
                </div>
              </div>
              <div className="add-att-wiz__bento-card add-att-wiz__bento-card--creds">
                <h3 className="add-att-wiz__bento-title">Credentials</h3>
                <div className="add-att-wiz__grid2">
                  <label className="add-att-wiz__field">
                    <span className="add-att-wiz__label">Last name</span>
                    <input className="add-att-wiz__input" value={lastName} onChange={(ev) => setLastName(ev.target.value)} />
                  </label>
                  <label className="add-att-wiz__field">
                    <span className="add-att-wiz__label">First name</span>
                    <input className="add-att-wiz__input" value={firstName} onChange={(ev) => setFirstName(ev.target.value)} />
                  </label>
                </div>
                <label className="add-att-wiz__field">
                  <span className="add-att-wiz__label">Middle name</span>
                  <input className="add-att-wiz__input" value={middleName} onChange={(ev) => setMiddleName(ev.target.value)} />
                </label>
                <label className="add-att-wiz__field">
                  <span className="add-att-wiz__label">Contact number</span>
                  <input className="add-att-wiz__input" inputMode="tel" value={phone} onChange={(ev) => setPhone(ev.target.value)} />
                </label>
                <label className="add-att-wiz__field">
                  <span className="add-att-wiz__label">Password (attendant app)</span>
                  <input
                    className="add-att-wiz__input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                  />
                </label>
                <label className="add-att-wiz__field">
                  <span className="add-att-wiz__label">Account role</span>
                  <select className="add-att-wiz__select" disabled value="BusAttendant">
                    <option value="BusAttendant">Bus attendant</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="add-att-wiz__actions">
              <button type="button" className="add-att-wiz__btn add-att-wiz__btn--ghost" onClick={() => setStep(2)}>
                Back
              </button>
              <button type="submit" className="add-att-wiz__btn add-att-wiz__btn--primary" disabled={saving}>
                {saving ? "Saving…" : "Save attendant"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
