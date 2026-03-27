import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { pushAdminAudit } from "@/lib/adminAudit";
import { profileImageFileToDataUrl } from "@/lib/compressProfileImage";
import "./AddDriverWizard.css";

type Step = 1 | 2 | 3;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const RESEND_SECONDS = 59;
const MAX_FILE_BYTES = 2_000_000;

function revokeIfBlob(url: string | null) {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function AddDriverWizard({ isOpen, onClose, onSaved }: Props) {
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
  const [licenseNumber, setLicenseNumber] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [profilePreview, setProfilePreview] = useState<string | null>(null);
  const [licensePreview, setLicensePreview] = useState<string | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [licenseScanUrl, setLicenseScanUrl] = useState<string | null>(null);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [uploadingLicense, setUploadingLicense] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const blobUrlsRef = useRef<{ profile: string | null; license: string | null }>({ profile: null, license: null });

  const reset = useCallback(() => {
    revokeIfBlob(blobUrlsRef.current.profile);
    revokeIfBlob(blobUrlsRef.current.license);
    blobUrlsRef.current = { profile: null, license: null };
    setStep(1);
    setEmail("");
    setSignupToken(null);
    setOtpDigits(["", "", "", "", "", ""]);
    setResendLeft(0);
    setFirstName("");
    setLastName("");
    setMiddleName("");
    setPhone("");
    setLicenseNumber("");
    setYearsExperience("");
    setProfilePreview(null);
    setLicensePreview(null);
    setProfileImageUrl(null);
    setLicenseScanUrl(null);
    setUploadingProfile(false);
    setUploadingLicense(false);
  }, []);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, reset]);

  useEffect(() => {
    if (resendLeft <= 0) return;
    const t = window.setInterval(() => setResendLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [resendLeft]);

  useEffect(() => {
    return () => {
      revokeIfBlob(blobUrlsRef.current.profile);
      revokeIfBlob(blobUrlsRef.current.license);
    };
  }, []);

  if (!isOpen) return null;

  function handleHeaderBack() {
    if (step === 1) onClose();
    else if (step === 2) setStep(1);
    else setStep(2);
  }

  async function handleProfileFile(file: File | null) {
    if (!file) {
      revokeIfBlob(profilePreview);
      setProfilePreview(null);
      setProfileImageUrl(null);
      return;
    }
    if (!file.type.startsWith("image/") || file.size > MAX_FILE_BYTES) {
      showError("Profile photo: use an image under 2MB.");
      return;
    }
    const local = URL.createObjectURL(file);
    revokeIfBlob(blobUrlsRef.current.profile);
    blobUrlsRef.current.profile = local;
    setProfilePreview(local);
    setUploadingProfile(true);
    try {
      const dataUrl = await profileImageFileToDataUrl(file);
      setProfileImageUrl(dataUrl);
      showSuccess("Driver photo attached.");
    } catch (err) {
      setProfileImageUrl(null);
      showError(err instanceof Error ? err.message : "Photo processing failed");
    } finally {
      setUploadingProfile(false);
    }
  }

  async function handleLicenseFile(file: File | null) {
    if (!file) {
      revokeIfBlob(blobUrlsRef.current.license);
      blobUrlsRef.current.license = null;
      setLicensePreview(null);
      setLicenseScanUrl(null);
      return;
    }
    if (!file.type.startsWith("image/") || file.size > MAX_FILE_BYTES) {
      showError("License scan: use an image under 2MB.");
      return;
    }
    const local = URL.createObjectURL(file);
    revokeIfBlob(blobUrlsRef.current.license);
    blobUrlsRef.current.license = local;
    setLicensePreview(local);
    setUploadingLicense(true);
    try {
      const dataUrl = await profileImageFileToDataUrl(file);
      setLicenseScanUrl(dataUrl);
      showSuccess("License scan attached.");
    } catch (err) {
      setLicenseScanUrl(null);
      showError(err instanceof Error ? err.message : "License processing failed");
    } finally {
      setUploadingLicense(false);
    }
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
        "/api/driver-signup/verify-email",
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
      const res = await api<{ message: string; devOtp?: string }>("/api/driver-signup/verify-email", {
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
      const res = await api<{ signupToken: string; email: string }>("/api/driver-signup/verify-otp", {
        method: "POST",
        json: { email, otp: code },
      });
      setSignupToken(res.signupToken);
      setStep(3);
      showSuccess("Verified — enter professional credentials.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!signupToken) {
      showError("Session expired — verify OTP again.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      showError("First and last name are required.");
      return;
    }
    if (!licenseNumber.trim()) {
      showError("License number is required.");
      return;
    }
    const yoe = Number(yearsExperience);
    if (!Number.isFinite(yoe) || yoe < 0) {
      showError("Years of experience must be a valid non-negative number.");
      return;
    }
    if (uploadingProfile || uploadingLicense) {
      showError("Wait for uploads to finish.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/driver-signup/save-driver", {
        method: "POST",
        authToken: signupToken,
        json: {
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          middleName: middleName.trim() || undefined,
          phone: phone.trim() || undefined,
          licenseNumber: licenseNumber.trim(),
          yearsExperience: yoe,
          profileImageUrl: profileImageUrl || undefined,
          licenseScanUrl: licenseScanUrl || undefined,
        },
      });
      const display = `${firstName.trim()} ${lastName.trim()}`.trim();
      pushAdminAudit({
        admin: user?.email ?? "Admin",
        action: `[SECURITY]: Driver ${display} verified via OTP and registered in fleet.`,
        level: "CRITICAL",
      });
      showSuccess("Driver registered.");
      onSaved();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="add-drv-wiz__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="add-drv-wiz"
        role="dialog"
        aria-labelledby="add-drv-wiz-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <div className="add-drv-wiz__glow" aria-hidden />
        <div className="add-drv-wiz__head">
          <div className="add-drv-wiz__head-row">
            <button
              type="button"
              className="add-drv-wiz__back-icon"
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
            <div className="add-drv-wiz__head-main">
              <h2 id="add-drv-wiz-title" className="add-drv-wiz__title">
                Register driver
              </h2>
              <div className="add-drv-wiz__steps">
                <span className={step >= 1 ? "add-drv-wiz__step add-drv-wiz__step--on" : "add-drv-wiz__step"}>1 Email</span>
                <span className="add-drv-wiz__step-sep" aria-hidden>
                  ·
                </span>
                <span className={step >= 2 ? "add-drv-wiz__step add-drv-wiz__step--on" : "add-drv-wiz__step"}>2 OTP</span>
                <span className="add-drv-wiz__step-sep" aria-hidden>
                  ·
                </span>
                <span className={step >= 3 ? "add-drv-wiz__step add-drv-wiz__step--on" : "add-drv-wiz__step"}>3 Credentials</span>
              </div>
            </div>
          </div>
        </div>

        {step === 1 ? (
          <form className="add-drv-wiz__form" onSubmit={handleCheckEmail}>
            <p className="add-drv-wiz__lead">
              Enter the driver&apos;s email. We&apos;ll check that it isn&apos;t already registered, then send a one-time code to their inbox.
            </p>
            <label className="add-drv-wiz__field">
              <span className="add-drv-wiz__label">Driver email</span>
              <input
                className="add-drv-wiz__input"
                type="email"
                autoComplete="off"
                placeholder="driver.ramos@gmail.com"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </label>
            <div className="add-drv-wiz__actions">
              <button type="button" className="add-drv-wiz__btn add-drv-wiz__btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="add-drv-wiz__btn add-drv-wiz__btn--primary" disabled={checking}>
                {checking ? "Sending…" : "Check & send OTP"}
              </button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <form className="add-drv-wiz__form" onSubmit={handleVerifyOtp}>
            <p className="add-drv-wiz__lead">
              Enter the <strong>6-digit code</strong> sent to <span className="add-drv-wiz__em">{email}</span>.
            </p>
            <div className="add-drv-wiz__otp-row" role="group" aria-label="One-time code">
              {otpDigits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  className="add-drv-wiz__otp-cell"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  autoComplete="one-time-code"
                  onChange={(ev) => setOtpAt(i, ev.target.value)}
                  onKeyDown={(ev) => onOtpKeyDown(i, ev.key)}
                />
              ))}
            </div>
            <p className="add-drv-wiz__resend">
              {resendLeft > 0 ? (
                <span className="add-drv-wiz__resend-timer">Resend OTP in {resendLeft}s</span>
              ) : (
                <button type="button" className="add-drv-wiz__link" onClick={() => void handleResendOtp()} disabled={checking}>
                  Resend OTP
                </button>
              )}
            </p>
            <div className="add-drv-wiz__actions">
              <button type="button" className="add-drv-wiz__btn add-drv-wiz__btn--ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="submit" className="add-drv-wiz__btn add-drv-wiz__btn--primary" disabled={verifying}>
                {verifying ? "Verifying…" : "Verify code"}
              </button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form className="add-drv-wiz__form add-drv-wiz__form--bento" onSubmit={handleSave}>
            <p className="add-drv-wiz__lead">Enter license details and optional profile or license photos.</p>
            <div className="add-drv-wiz__bento">
              <div className="add-drv-wiz__bento-card">
                <h3 className="add-drv-wiz__bento-title">Identity &amp; license</h3>
                <div className="add-drv-wiz__upload-row">
                  <div className="add-drv-wiz__upload-tile">
                    <label className="add-drv-wiz__upload-label">
                      <div
                        className="add-drv-wiz__thumb"
                        style={
                          profilePreview ? { backgroundImage: `url(${profilePreview})` } : { background: "rgba(255,255,255,0.05)" }
                        }
                      >
                        {!profilePreview ? <span className="add-drv-wiz__thumb-placeholder">Driver photo</span> : null}
                        {uploadingProfile ? <span className="add-drv-wiz__spinner" aria-hidden /> : null}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="add-drv-wiz__file-input"
                        disabled={uploadingProfile}
                        onChange={(ev) => void handleProfileFile(ev.target.files?.[0] ?? null)}
                      />
                    </label>
                    <p className="add-drv-wiz__upload-caption">Portrait</p>
                  </div>
                  <div className="add-drv-wiz__upload-tile">
                    <label className="add-drv-wiz__upload-label">
                      <div
                        className="add-drv-wiz__thumb add-drv-wiz__thumb--wide"
                        style={
                          licensePreview ? { backgroundImage: `url(${licensePreview})` } : { background: "rgba(255,255,255,0.05)" }
                        }
                      >
                        {!licensePreview ? <span className="add-drv-wiz__thumb-placeholder">License scan</span> : null}
                        {uploadingLicense ? <span className="add-drv-wiz__spinner" aria-hidden /> : null}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="add-drv-wiz__file-input"
                        disabled={uploadingLicense}
                        onChange={(ev) => void handleLicenseFile(ev.target.files?.[0] ?? null)}
                      />
                    </label>
                    <p className="add-drv-wiz__upload-caption">License document</p>
                  </div>
                </div>
              </div>
              <div className="add-drv-wiz__bento-card">
                <h3 className="add-drv-wiz__bento-title">Professional details</h3>
                <div className="add-drv-wiz__grid2">
                  <label className="add-drv-wiz__field">
                    <span className="add-drv-wiz__label">First name</span>
                    <input className="add-drv-wiz__input" value={firstName} onChange={(ev) => setFirstName(ev.target.value)} />
                  </label>
                  <label className="add-drv-wiz__field">
                    <span className="add-drv-wiz__label">Last name</span>
                    <input className="add-drv-wiz__input" value={lastName} onChange={(ev) => setLastName(ev.target.value)} />
                  </label>
                </div>
                <label className="add-drv-wiz__field">
                  <span className="add-drv-wiz__label">Middle name</span>
                  <input className="add-drv-wiz__input" value={middleName} onChange={(ev) => setMiddleName(ev.target.value)} />
                </label>
                <label className="add-drv-wiz__field">
                  <span className="add-drv-wiz__label">Contact number</span>
                  <input className="add-drv-wiz__input" inputMode="tel" value={phone} onChange={(ev) => setPhone(ev.target.value)} />
                </label>
                <label className="add-drv-wiz__field">
                  <span className="add-drv-wiz__label">License number</span>
                  <input
                    className="add-drv-wiz__input"
                    placeholder="e.g. K01-12-345678"
                    value={licenseNumber}
                    onChange={(ev) => setLicenseNumber(ev.target.value)}
                  />
                </label>
                <label className="add-drv-wiz__field">
                  <span className="add-drv-wiz__label">Years of experience</span>
                  <input
                    className="add-drv-wiz__input"
                    inputMode="numeric"
                    min={0}
                    value={yearsExperience}
                    onChange={(ev) => setYearsExperience(ev.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="add-drv-wiz__actions">
              <button type="button" className="add-drv-wiz__btn add-drv-wiz__btn--ghost" onClick={() => setStep(2)}>
                Back
              </button>
              <button type="submit" className="add-drv-wiz__btn add-drv-wiz__btn--primary" disabled={saving}>
                {saving ? "Saving…" : "Register driver"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
