import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/context/ToastContext";
import { pushAdminAudit } from "@/lib/adminAudit";
import { useAuth } from "@/context/AuthContext";
import { fetchAdminPortalSettings, putAdminPortalSettings } from "@/lib/api";
import { searchNominatimBukidnon, type NominatimMappedHit } from "@/lib/nominatimBukidnon";
import type { AdminPortalSettingsDto, AttendantAppAccessDto, PassengerAppAccessDto } from "@/lib/types";
import { LS_SEC_GEOFENCE_PUSH, LS_SEC_SENSITIVE_REAUTH, readLsBool, writeLsBool } from "@/lib/settingsPrefs";
import { SosIncidentSettingsCard } from "@/components/SosIncidentSettingsCard";
import "./SettingsPage.css";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const;
type SettingsTab = "general" | "security" | "branding" | "roles";

const PORTAL_TIMEZONES: { value: string; label: string }[] = [
  { value: "Asia/Manila", label: "(GMT+08:00) Manila, Philippines" },
  { value: "Asia/Singapore", label: "(GMT+08:00) Singapore" },
  { value: "Asia/Hong_Kong", label: "(GMT+08:00) Hong Kong" },
  { value: "Asia/Shanghai", label: "(GMT+08:00) Shanghai" },
  { value: "Asia/Tokyo", label: "(GMT+09:00) Tokyo" },
  { value: "Asia/Seoul", label: "(GMT+09:00) Seoul" },
  { value: "Asia/Dubai", label: "(GMT+04:00) Dubai" },
  { value: "Asia/Kolkata", label: "(GMT+05:30) Mumbai / Kolkata" },
  { value: "Europe/London", label: "(GMT±00:00) London" },
  { value: "Europe/Paris", label: "(GMT+01:00) Paris" },
  { value: "America/New_York", label: "(GMT-05:00) New York" },
  { value: "America/Los_Angeles", label: "(GMT-08:00) Los Angeles" },
  { value: "Australia/Sydney", label: "(GMT+10:00) Sydney" },
  { value: "Pacific/Auckland", label: "(GMT+12:00) Auckland" },
  { value: "UTC", label: "(GMT+00:00) UTC" },
];

const DEFAULT_ATTENDANT_ACCESS: AttendantAppAccessDto = {
  dashboard: true,
  tickets: true,
  editPassenger: true,
  notification: true,
  settings: true,
};

const DEFAULT_PASSENGER_ACCESS: PassengerAppAccessDto = {
  dashboard: true,
  scheduled: true,
  checkBuses: true,
  newsUpdates: true,
  feedbacks: true,
  otherPages: true,
};

function mergeAttendantAccess(raw?: Partial<AttendantAppAccessDto> | null): AttendantAppAccessDto {
  return { ...DEFAULT_ATTENDANT_ACCESS, ...raw };
}

function mergePassengerAccess(raw?: Partial<PassengerAppAccessDto> | null): PassengerAppAccessDto {
  return { ...DEFAULT_PASSENGER_ACCESS, ...raw };
}

function isLikelyLogoSrc(s: string): boolean {
  const t = s.trim();
  return t.startsWith("data:image/") || /^https?:\/\//i.test(t);
}

type SettingsInfoKey =
  | "overview"
  | "appearance"
  | "regional"
  | "secLogin"
  | "secSession"
  | "secIncident"
  | "branding"
  | "roles";

type SwitchRowProps = {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
};

function SwitchRow({ id, label, hint, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <div className="admin-settings__switch-block">
      <div className="admin-settings__switch-text">
        <label className="admin-settings__switch-label" htmlFor={id}>
          {label}
        </label>
        {hint ? <p className="admin-settings__hint admin-settings__hint--tight">{hint}</p> : null}
      </div>
      <label className="admin-settings__switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="admin-settings__switch-ui" aria-hidden />
      </label>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const { theme, setTheme } = useTheme();
  const { branding, setBranding, applyServerSettings } = useAdminBranding();
  const rbac = user?.rbacRole ?? null;
  const isAuditor = rbac === "auditor";
  const isSuper = rbac === "super_admin" || user?.adminTier === "super";

  const [tab, setTab] = useState<SettingsTab>("general");
  const [portal, setPortal] = useState<AdminPortalSettingsDto | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [appAccessTab, setAppAccessTab] = useState<"attendant" | "passenger">("attendant");

  const [companyName, setCompanyName] = useState(branding.companyName);
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyLocation, setCompanyLocation] = useState("");
  const [companyLocationHits, setCompanyLocationHits] = useState<NominatimMappedHit[]>([]);
  const [companyLocationSearching, setCompanyLocationSearching] = useState(false);
  const [companyLocationSearchErr, setCompanyLocationSearchErr] = useState<string | null>(null);
  const [sidebarLogoField, setSidebarLogoField] = useState(branding.sidebarLogoUrl ?? "");
  const [reportFooter, setReportFooter] = useState(branding.reportFooter);
  const [pendingSidebarDataUrl, setPendingSidebarDataUrl] = useState<string | null>(null);
  const [logoPreviewBroken, setLogoPreviewBroken] = useState(false);
  const [fileHint, setFileHint] = useState<string | null>(null);
  const [toolMsg, setToolMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [clientAppsSaving, setClientAppsSaving] = useState(false);

  const [geofencePush, setGeofencePush] = useState(() => readLsBool(LS_SEC_GEOFENCE_PUSH, true));
  const [sensitiveReauth, setSensitiveReauth] = useState(() => readLsBool(LS_SEC_SENSITIVE_REAUTH, false));
  const [infoModal, setInfoModal] = useState<{
    key: SettingsInfoKey;
    title: string;
    panelId: string;
    content: ReactNode;
  } | null>(null);

  const closeInfoModal = useCallback(() => setInfoModal(null), []);

  useEffect(() => {
    if (!infoModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInfoModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [infoModal, closeInfoModal]);

  function InfoTrigger({
    k,
    label,
    panelId,
    modalTitle,
    content,
  }: {
    k: SettingsInfoKey;
    label: string;
    panelId: string;
    modalTitle: string;
    content: ReactNode;
  }) {
    const open = infoModal?.key === k;
    return (
      <button
        type="button"
        className={"admin-settings__info-trigger" + (open ? " admin-settings__info-trigger--open" : "")}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setInfoModal((m) => (m?.key === k ? null : { key: k, title: modalTitle, panelId, content }));
        }}
        title={`${open ? "Close" : "Open"}: ${label}`}
      >
        <svg viewBox="0 0 24 24" className="admin-settings__info-svg" aria-hidden>
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path fill="currentColor" d="M11 10h2v8h-2v-8zm0-4h2v2h-2V6z" />
        </svg>
        <span className="admin-settings__sr-only">
          {open ? "Close" : "Open"} {label} description
        </span>
      </button>
    );
  }

  function InfoHeadingRow({
    h2Id,
    title,
    infoKey,
    panelId,
    spaced,
    children,
  }: {
    h2Id: string;
    title: string;
    infoKey: SettingsInfoKey;
    panelId: string;
    spaced?: boolean;
    children: ReactNode;
  }) {
    return (
      <div className={"admin-settings__h2-row" + (spaced ? " admin-settings__h2-row--spaced" : "")}>
        <h2 id={h2Id} className="admin-settings__h2">
          {title}
        </h2>
        <InfoTrigger k={infoKey} label={title} panelId={panelId} modalTitle={title} content={children} />
      </div>
    );
  }

  function shouldSilenceAdminSettingsNonJson(message: string): boolean {
    const m = message.toLowerCase();
    return (
      m.includes("/api/admin/settings") &&
      (m.includes("non-json response") || m.includes("received html") || m.includes("invalid json") || m.includes("404"))
    );
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const companyLocationAbortRef = useRef<AbortController | null>(null);
  const idBase = useId();
  const idCompany = `${idBase}-company`;
  const idFooter = `${idBase}-footer`;
  const idEmailCo = `${idBase}-co-email`;
  const idPhoneCo = `${idBase}-co-phone`;
  const idLocationCo = `${idBase}-co-location`;
  const idFile = `${idBase}-file`;

  const loadAll = useCallback(async () => {
    setLoadErr(null);
    try {
      const s = await fetchAdminPortalSettings();
      setPortal(s.settings);
      setCompanyName(s.settings.companyName);
      setCompanyEmail(s.settings.companyEmail ?? "");
      setCompanyPhone(s.settings.companyPhone ?? "");
      setCompanyLocation(s.settings.companyLocation ?? "");
      setSidebarLogoField(s.settings.sidebarLogoUrl ?? "");
      setReportFooter(s.settings.reportFooter);
      setGeofencePush(s.settings.geofenceBreachToasts !== false);
      setSensitiveReauth(s.settings.sensitiveActionConfirmation === true);
      applyServerSettings({
        companyName: s.settings.companyName,
        sidebarLogoUrl: s.settings.sidebarLogoUrl,
        faviconUrl: null,
        reportFooter: s.settings.reportFooter,
        sessionTimeoutMinutes: s.settings.sessionTimeoutMinutes ?? 30,
        geofenceBreachToasts: s.settings.geofenceBreachToasts !== false,
        sensitiveActionConfirmation: s.settings.sensitiveActionConfirmation === true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load settings";
      if (shouldSilenceAdminSettingsNonJson(msg)) {
        setLoadErr(null);
        return;
      }
      setLoadErr(msg);
    }
  }, [applyServerSettings]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setCompanyName(branding.companyName);
    setSidebarLogoField(branding.sidebarLogoUrl ?? "");
    setReportFooter(branding.reportFooter);
    setPendingSidebarDataUrl(null);
    setLogoPreviewBroken(false);
    setFileHint(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [branding.companyName, branding.sidebarLogoUrl, branding.reportFooter]);

  useEffect(() => {
    const q = companyLocation.trim();
    if (q.length < 3) {
      setCompanyLocationHits([]);
      setCompanyLocationSearching(false);
      setCompanyLocationSearchErr(null);
      return;
    }
    companyLocationAbortRef.current?.abort();
    const ctrl = new AbortController();
    companyLocationAbortRef.current = ctrl;
    setCompanyLocationSearching(true);
    setCompanyLocationSearchErr(null);
    const t = window.setTimeout(() => {
      void searchNominatimBukidnon(q, ctrl.signal)
        .then((rows) => {
          if (ctrl.signal.aborted) return;
          setCompanyLocationHits(rows.slice(0, 8));
          if (rows.length === 0) {
            setCompanyLocationSearchErr(
              "No suggestions found. Try a shorter query (e.g., 'Malaybalay terminal')."
            );
          }
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          setCompanyLocationHits([]);
          const msg = e instanceof Error ? e.message : "Location search failed.";
          setCompanyLocationSearchErr(msg);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setCompanyLocationSearching(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [companyLocation]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFileHint(null);
    setPendingSidebarDataUrl(null);
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type as (typeof ALLOWED_TYPES)[number])) {
      setFileHint("Security alert: only PNG, JPG, SVG, or WebP files are allowed.");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileHint("File too large. Please upload an image under 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") {
        setPendingSidebarDataUrl(r);
        setLogoPreviewBroken(false);
      }
    };
    reader.readAsDataURL(f);
  };

  const saveAlertPrefsOnly = async () => {
    if (isAuditor || !portal) return;
    setIsSaving(true);
    try {
      const r = await putAdminPortalSettings({
        general: {
          emailDailySummary: false,
          soundAlerts: false,
          timezone: portal.timezone,
          currency: "PHP",
          delayThresholdMinutes: portal.delayThresholdMinutes ?? 10,
          geofenceBreachToasts: geofencePush,
          sensitiveActionConfirmation: sensitiveReauth,
        },
      });
      setPortal(r.settings);
      writeLsBool(LS_SEC_GEOFENCE_PUSH, geofencePush);
      writeLsBool(LS_SEC_SENSITIVE_REAUTH, sensitiveReauth);
      applyServerSettings({
        companyName: r.settings.companyName,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: null,
        reportFooter: r.settings.reportFooter,
        sessionTimeoutMinutes: r.settings.sessionTimeoutMinutes ?? 30,
        geofenceBreachToasts: r.settings.geofenceBreachToasts !== false,
        sensitiveActionConfirmation: r.settings.sensitiveActionConfirmation === true,
      });
      setToolMsg("Alert preferences saved.");
      window.setTimeout(() => setToolMsg(null), 2400);
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const saveGeneral = async () => {
    if (isAuditor || !portal) return;
    setIsSaving(true);
    try {
      const r = await putAdminPortalSettings({
        general: {
          emailDailySummary: false,
          soundAlerts: false,
          timezone: portal.timezone,
          currency: "PHP",
          delayThresholdMinutes: portal.delayThresholdMinutes ?? 10,
          geofenceBreachToasts: geofencePush,
          sensitiveActionConfirmation: sensitiveReauth,
        },
      });
      setPortal(r.settings);
      writeLsBool(LS_SEC_GEOFENCE_PUSH, geofencePush);
      writeLsBool(LS_SEC_SENSITIVE_REAUTH, sensitiveReauth);
      applyServerSettings({
        companyName: r.settings.companyName,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: null,
        reportFooter: r.settings.reportFooter,
        sessionTimeoutMinutes: r.settings.sessionTimeoutMinutes ?? 30,
        geofenceBreachToasts: r.settings.geofenceBreachToasts !== false,
        sensitiveActionConfirmation: r.settings.sensitiveActionConfirmation === true,
      });
      pushAdminAudit({
        admin: user?.email ?? "admin@local",
        level: "WARNING",
        action: "updated general portal settings (appearance & regional policy)",
      });
      setToolMsg("General settings saved.");
      window.setTimeout(() => setToolMsg(null), 2400);
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const saveSecurity = async (target: "admin" | "attendant" | "both" = "both") => {
    if (isAuditor || !isSuper || !portal) return;
    setIsSaving(true);
    try {
      const r = await putAdminPortalSettings({
        security: {
          maxLoginAttempts: portal.maxLoginAttempts,
          lockoutMinutes: portal.lockoutMinutes,
          sessionTimeoutMinutes: portal.sessionTimeoutMinutes,
          securityPolicyApplyAdmin: portal.securityPolicyApplyAdmin !== false,
          securityPolicyApplyAttendant: portal.securityPolicyApplyAttendant !== false,
        },
      });
      setPortal(r.settings);
      applyServerSettings({
        companyName: r.settings.companyName,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: null,
        reportFooter: r.settings.reportFooter,
        sessionTimeoutMinutes: r.settings.sessionTimeoutMinutes ?? 30,
        geofenceBreachToasts: r.settings.geofenceBreachToasts !== false,
        sensitiveActionConfirmation: r.settings.sensitiveActionConfirmation === true,
      });
      pushAdminAudit({
        admin: user?.email ?? "admin@local",
        level: "WARNING",
        action: "updated security policy (lockout & session timeout)",
      });
      const msg =
        target === "admin"
          ? "Admin security policy saved."
          : target === "attendant"
            ? "Attendant security policy saved."
            : "Security policy saved.";
      setToolMsg(msg);
      showSuccess(msg);
      window.setTimeout(() => setToolMsg(null), 2400);
    } catch (e) {
      const err = e instanceof Error ? e.message : "Save failed";
      setToolMsg(err);
      showError(err);
    } finally {
      setIsSaving(false);
    }
  };

  const saveBranding = async () => {
    if (isAuditor) return;
    const rawLogo = (pendingSidebarDataUrl ?? sidebarLogoField.trim()) || null;
    if (rawLogo && !isLikelyLogoSrc(rawLogo)) {
      setToolMsg("Logo must be an https URL or a data:image… data URL.");
      window.setTimeout(() => setToolMsg(null), 4000);
      return;
    }
    setIsSaving(true);
    try {
      const r = await putAdminPortalSettings({
        branding: {
          companyName: companyName.trim() || "Bukidnon Bus Company",
          companyEmail: companyEmail.trim() || null,
          companyPhone: companyPhone.trim() || null,
          companyLocation: companyLocation.trim() || null,
          sidebarLogoUrl: rawLogo,
          faviconUrl: null,
          reportFooter: reportFooter.trim() || branding.reportFooter,
        },
      });
      setPortal(r.settings);
      setBranding({
        companyName: r.settings.companyName,
        logoUrl: r.settings.sidebarLogoUrl,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: null,
        reportFooter: r.settings.reportFooter,
      });
      applyServerSettings({
        companyName: r.settings.companyName,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: null,
        reportFooter: r.settings.reportFooter,
        sessionTimeoutMinutes: r.settings.sessionTimeoutMinutes ?? 30,
        geofenceBreachToasts: r.settings.geofenceBreachToasts !== false,
        sensitiveActionConfirmation: r.settings.sensitiveActionConfirmation === true,
      });
      pushAdminAudit({
        admin: user?.email ?? "admin@local",
        level: "WARNING",
        action: `updated brand identity (company="${companyName.trim()}")`,
      });
      setToolMsg("Branding saved.");
      window.setTimeout(() => setToolMsg(null), 2400);
      setPendingSidebarDataUrl(null);
      setFileHint(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const saveClientAppAccess = async () => {
    if (isAuditor || !portal) return;
    setClientAppsSaving(true);
    try {
      const r = await putAdminPortalSettings({
        clientApps: {
          attendantAppAccess: mergeAttendantAccess(portal.attendantAppAccess),
          passengerAppAccess: mergePassengerAccess(portal.passengerAppAccess),
        },
      });
      setPortal(r.settings);
      pushAdminAudit({
        admin: user?.email ?? "admin@local",
        level: "WARNING",
        action: "updated Bus Attendant & Passenger app access toggles",
      });
      setToolMsg("App access settings saved.");
      window.setTimeout(() => setToolMsg(null), 2400);
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setClientAppsSaving(false);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "security", label: "Security" },
    { id: "branding", label: "Branding" },
    { id: "roles", label: "App access" },
  ];

  const overviewPanelId = `${idBase}-info-overview`;

  return (
    <div className="admin-settings admin-settings--fullscreen">
      <header className="admin-settings__head admin-settings__head--centered">
        <h1 className="admin-settings__title">Settings</h1>
        <p className="admin-settings__lead">
          Operational defaults, security policy, branding, and which screens appear in the Bus Attendant and Passenger apps.
          Changes apply when you save each section.
        </p>
        <div className="admin-settings__head-info">
          <InfoTrigger
            k="overview"
            label="Settings overview"
            panelId={overviewPanelId}
            modalTitle="Settings overview"
            content={
              <ul className="admin-settings__info-list">
                <li>
                  <strong>General</strong> — <strong>Appearance</strong>: theme applies to the admin shell, sidebar, and this
                  page. <strong>Regional</strong>: choose the portal timezone for shift logs and scheduled jobs (stored as an
                  IANA zone such as Asia/Manila).
                </li>
                <li>
                  <strong>Security</strong> — Login protection (attempts and lockout), session timeout, where those rules
                  apply, plus geofence breach toasts and sensitive-action confirmation.
                </li>
                <li>
                  <strong>Branding</strong> — Company name, contact email and phone, sidebar logo (upload or URL), and report
                  footer for PDF exports.
                </li>
                <li>
                  <strong>App access</strong> — Toggle which areas of the Bus Attendant app and Passenger app are available
                  (clients can read these flags in a future release).
                </li>
              </ul>
            }
          />
        </div>
      </header>

      {loadErr ? <p className="admin-settings__flash admin-settings__flash--warn">{loadErr}</p> : null}
      {isAuditor ? (
        <p className="admin-settings__flash admin-settings__flash--warn">
          Your account is view-only. Saving changes is disabled.
        </p>
      ) : null}

      <div className="admin-settings__shell">
        <nav className="admin-settings__tabs" aria-label="Settings sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={"admin-settings__tab" + (tab === t.id ? " admin-settings__tab--active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="admin-settings__panel">
          {toolMsg ? <p className="admin-settings__flash">{toolMsg}</p> : null}

          {tab === "general" ? (
            <section className="admin-settings__section" aria-labelledby={`${idBase}-gen-h`}>
              <InfoHeadingRow
                h2Id={`${idBase}-gen-h`}
                title="Appearance"
                infoKey="appearance"
                panelId={`${idBase}-inf-appearance`}
              >
                <p>
                  <strong>Theme</strong> applies to the admin shell, sidebar, and this page.
                </p>
                <p>
                  <strong>Dark interface</strong> — Turn off for light mode — optimized for bright displays.
                </p>
              </InfoHeadingRow>
              <SwitchRow
                id={`${idBase}-dark`}
                label="Dark interface"
                checked={theme === "dark"}
                onChange={(on) => setTheme(on ? "dark" : "light")}
              />

              <InfoHeadingRow
                h2Id={`${idBase}-gen-reg-h`}
                title="Regional"
                infoKey="regional"
                panelId={`${idBase}-inf-regional`}
                spaced
              >
                <p>
                  <strong>Timezone</strong> — Used for accurate driver shift logs and server-side schedules. Pick the IANA
                  region that matches your operations (e.g. Asia/Manila).
                </p>
              </InfoHeadingRow>
              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={`${idBase}-tz`}>
                  Timezone
                </label>
                <select
                  id={`${idBase}-tz`}
                  className="admin-settings__input"
                  disabled={isAuditor || !portal}
                  value={portal?.timezone ?? "Asia/Manila"}
                  onChange={(e) => setPortal((p) => (p ? { ...p, timezone: e.target.value } : p))}
                >
                  {PORTAL_TIMEZONES.map((z) => (
                    <option key={z.value} value={z.value}>
                      {z.label}
                    </option>
                  ))}
                  {portal?.timezone && !PORTAL_TIMEZONES.some((z) => z.value === portal.timezone) ? (
                    <option value={portal.timezone}>{portal.timezone} (current)</option>
                  ) : null}
                </select>
              </div>

              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={`${idBase}-delay-threshold`}>
                  Delay threshold (minutes)
                </label>
                <input
                  id={`${idBase}-delay-threshold`}
                  className="admin-settings__input"
                  type="number"
                  min={1}
                  max={180}
                  disabled={isAuditor || !portal}
                  value={portal?.delayThresholdMinutes ?? 10}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const next = Number.isFinite(raw) ? Math.min(180, Math.max(1, Math.round(raw))) : 10;
                    setPortal((p) => (p ? { ...p, delayThresholdMinutes: next } : p));
                  }}
                />
                <p className="admin-settings__hint admin-settings__hint--tight">
                  Used by smart ETA to auto-mark buses as delayed.
                </p>
              </div>

              <div className="admin-settings__actions">
                <button
                  type="button"
                  className="admin-settings__btn admin-settings__btn--primary"
                  onClick={() => void saveGeneral()}
                  disabled={isSaving || isAuditor || !portal}
                >
                  {isSaving ? "Saving…" : "Save general settings"}
                </button>
              </div>
            </section>
          ) : null}

          {tab === "security" ? (
            <section className="admin-settings__section" aria-labelledby={`${idBase}-sec-h`}>
              <div className="admin-settings__security-grid">
                <div className="admin-settings__security-col">
                  <InfoHeadingRow
                    h2Id={`${idBase}-sec-h`}
                    title="Login protection"
                    infoKey="secLogin"
                    panelId={`${idBase}-inf-seclogin`}
                  >
                    <p>
                      Enforced on password sign-in. Values are stored in MongoDB and apply to all whitelisted admins.
                      Adjust max login attempts and lockout duration to balance security with operator convenience.
                    </p>
                  </InfoHeadingRow>
                  <div className="admin-settings__field-row admin-settings__field-row--security-duo">
                    <div className="admin-settings__field">
                      <label className="admin-settings__label" htmlFor={`${idBase}-max-att`}>
                        Max login attempts
                      </label>
                      <input
                        id={`${idBase}-max-att`}
                        className="admin-settings__input admin-settings__input--narrow"
                        type="number"
                        min={3}
                        max={10}
                        disabled={isAuditor || !isSuper || !portal}
                        value={portal?.maxLoginAttempts ?? 5}
                        onChange={(e) =>
                          setPortal((p) =>
                            p ? { ...p, maxLoginAttempts: Math.min(10, Math.max(3, Number(e.target.value) || 3)) } : p
                          )
                        }
                      />
                    </div>
                    <div className="admin-settings__field">
                      <label className="admin-settings__label" htmlFor={`${idBase}-lock-m`}>
                        Lockout duration (minutes)
                      </label>
                      <input
                        id={`${idBase}-lock-m`}
                        className="admin-settings__input admin-settings__input--narrow"
                        type="number"
                        min={5}
                        max={1440}
                        disabled={isAuditor || !isSuper || !portal}
                        value={portal?.lockoutMinutes ?? 15}
                        onChange={(e) =>
                          setPortal((p) =>
                            p ? { ...p, lockoutMinutes: Math.min(1440, Math.max(5, Number(e.target.value) || 5)) } : p
                          )
                        }
                      />
                    </div>
                  </div>

                  <InfoHeadingRow
                    h2Id={`${idBase}-sec-sess-h`}
                    title="Session management"
                    infoKey="secSession"
                    panelId={`${idBase}-inf-secsess`}
                    spaced
                  >
                    <p>
                      The portal runs an inactivity watcher; when the timer expires you are signed out and returned to
                      the login screen.
                    </p>
                  </InfoHeadingRow>
                  <div className="admin-settings__field">
                    <label className="admin-settings__label" htmlFor={`${idBase}-sess`}>
                      Session timeout (minutes of inactivity)
                    </label>
                    <input
                      id={`${idBase}-sess`}
                      className="admin-settings__input admin-settings__input--narrow"
                      type="number"
                      min={5}
                      max={480}
                      disabled={isAuditor || !isSuper || !portal}
                      value={portal?.sessionTimeoutMinutes ?? 30}
                      onChange={(e) =>
                        setPortal((p) =>
                          p
                            ? { ...p, sessionTimeoutMinutes: Math.min(480, Math.max(5, Number(e.target.value) || 5)) }
                            : p
                        )
                      }
                    />
                  </div>

                  <SwitchRow
                    id={`${idBase}-sec-apply-attendant`}
                    label="Apply policy to Attendant login"
                    checked={portal?.securityPolicyApplyAttendant !== false}
                    disabled={isAuditor || !isSuper || !portal}
                    onChange={(v) => setPortal((p) => (p ? { ...p, securityPolicyApplyAttendant: v } : p))}
                  />
                  <div className="admin-settings__actions">
                    <button
                      type="button"
                      className="admin-settings__btn admin-settings__btn--primary"
                      onClick={() => void saveSecurity("attendant")}
                      disabled={isSaving || isAuditor || !isSuper || !portal}
                    >
                      {isSaving ? "Saving…" : "Save attendants security policy"}
                    </button>
                  </div>
                </div>

                <div className="admin-settings__security-col">
                  <InfoHeadingRow
                    h2Id={`${idBase}-sec-h-right`}
                    title="Login protection"
                    infoKey="secLogin"
                    panelId={`${idBase}-inf-seclogin-right`}
                  >
                    <p>
                      Enforced on password sign-in. Values are stored in MongoDB and apply to all whitelisted admins.
                      Adjust max login attempts and lockout duration to balance security with operator convenience.
                    </p>
                  </InfoHeadingRow>
                  <div className="admin-settings__field-row admin-settings__field-row--security-duo">
                    <div className="admin-settings__field">
                      <label className="admin-settings__label" htmlFor={`${idBase}-max-att-right`}>
                        Max login attempts
                      </label>
                      <input
                        id={`${idBase}-max-att-right`}
                        className="admin-settings__input admin-settings__input--narrow"
                        type="number"
                        min={3}
                        max={10}
                        disabled={isAuditor || !isSuper || !portal}
                        value={portal?.maxLoginAttempts ?? 5}
                        onChange={(e) =>
                          setPortal((p) =>
                            p ? { ...p, maxLoginAttempts: Math.min(10, Math.max(3, Number(e.target.value) || 3)) } : p
                          )
                        }
                      />
                    </div>
                    <div className="admin-settings__field">
                      <label className="admin-settings__label" htmlFor={`${idBase}-lock-m-right`}>
                        Lockout duration (minutes)
                      </label>
                      <input
                        id={`${idBase}-lock-m-right`}
                        className="admin-settings__input admin-settings__input--narrow"
                        type="number"
                        min={5}
                        max={1440}
                        disabled={isAuditor || !isSuper || !portal}
                        value={portal?.lockoutMinutes ?? 15}
                        onChange={(e) =>
                          setPortal((p) =>
                            p ? { ...p, lockoutMinutes: Math.min(1440, Math.max(5, Number(e.target.value) || 5)) } : p
                          )
                        }
                      />
                    </div>
                  </div>

                  <InfoHeadingRow
                    h2Id={`${idBase}-sec-sess-h-right`}
                    title="Session management"
                    infoKey="secSession"
                    panelId={`${idBase}-inf-secsess-right`}
                    spaced
                  >
                    <p>
                      The portal runs an inactivity watcher; when the timer expires you are signed out and returned to
                      the login screen.
                    </p>
                  </InfoHeadingRow>
                  <div className="admin-settings__field">
                    <label className="admin-settings__label" htmlFor={`${idBase}-sess-right`}>
                      Session timeout (minutes of inactivity)
                    </label>
                    <input
                      id={`${idBase}-sess-right`}
                      className="admin-settings__input admin-settings__input--narrow"
                      type="number"
                      min={5}
                      max={480}
                      disabled={isAuditor || !isSuper || !portal}
                      value={portal?.sessionTimeoutMinutes ?? 30}
                      onChange={(e) =>
                        setPortal((p) =>
                          p
                            ? { ...p, sessionTimeoutMinutes: Math.min(480, Math.max(5, Number(e.target.value) || 5)) }
                            : p
                        )
                      }
                    />
                  </div>

                  <SwitchRow
                    id={`${idBase}-sec-apply-admin`}
                    label="Apply policy to Admin login"
                    checked={portal?.securityPolicyApplyAdmin !== false}
                    disabled={isAuditor || !isSuper || !portal}
                    onChange={(v) => setPortal((p) => (p ? { ...p, securityPolicyApplyAdmin: v } : p))}
                  />
                  <div className="admin-settings__actions">
                    <button
                      type="button"
                      className="admin-settings__btn admin-settings__btn--primary"
                      onClick={() => void saveSecurity("admin")}
                      disabled={isSaving || isAuditor || !isSuper || !portal}
                    >
                      {isSaving ? "Saving…" : "Save admin security policy"}
                    </button>
                  </div>
                </div>
              </div>
              {!isSuper ? (
                <span className="admin-settings__hint">Only Super Admin can edit lockout and session timeout.</span>
              ) : null}

              <InfoHeadingRow
                h2Id={`${idBase}-sec-inc-h`}
                title="Incident alerts"
                infoKey="secIncident"
                panelId={`${idBase}-inf-secinc`}
                spaced
              >
                <p>
                  <strong>Geofence breach toasts</strong> — Full-screen style alert when a vehicle leaves its corridor
                  (Locations view).
                </p>
                <p>
                  <strong>Sensitive action confirmation</strong> — Extra confirmation for fare changes and similar
                  actions (UI-level).
                </p>
                <p>
                  <strong>SOS incidents</strong> — Live attendant SOS appears in the tactical notification feed (bell) and
                  below; use Mute ping / Resolve incident to control audio and close the record.
                </p>
              </InfoHeadingRow>
              <SosIncidentSettingsCard />
              <SwitchRow
                id={`${idBase}-geo-push`}
                label="Geofence breach toasts"
                checked={geofencePush}
                disabled={isAuditor}
                onChange={(v) => {
                  setGeofencePush(v);
                  writeLsBool(LS_SEC_GEOFENCE_PUSH, v);
                }}
              />
              <SwitchRow
                id={`${idBase}-reauth`}
                label="Sensitive action confirmation"
                checked={sensitiveReauth}
                disabled={isAuditor}
                onChange={(v) => {
                  setSensitiveReauth(v);
                  writeLsBool(LS_SEC_SENSITIVE_REAUTH, v);
                }}
              />
              <div className="admin-settings__actions">
                <button
                  type="button"
                  className="admin-settings__btn"
                  onClick={() => void saveAlertPrefsOnly()}
                  disabled={isSaving || isAuditor || !portal}
                >
                  {isSaving ? "Saving…" : "Save alert preferences"}
                </button>
              </div>
            </section>
          ) : null}

          {tab === "branding" ? (
            <section className="admin-settings__section" aria-labelledby={`${idBase}-brand-h`}>
              <InfoHeadingRow
                h2Id={`${idBase}-brand-h`}
                title="Brand identity"
                infoKey="branding"
                panelId={`${idBase}-inf-brand`}
              >
                <p>
                  <strong>Company name</strong> — Shown in the sidebar, login, and previews across the admin portal.
                </p>
                <p>
                  <strong>Contact</strong> — Company email and phone are stored for display and future passenger-facing
                  screens.
                </p>
                <p>
                  <strong>Company&apos;s logo</strong> — Shown next to the company name in the sidebar. Upload a file or
                  paste a full <code>https://…</code> image URL or a <code>data:image/…</code> data URL (validated on save).
                </p>
                <p>
                  <strong>Report footer</strong> — Printed on PDF exports from reports.
                </p>
              </InfoHeadingRow>

              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={idCompany}>
                  Company name
                </label>
                <input
                  id={idCompany}
                  className="admin-settings__input"
                  type="text"
                  value={companyName}
                  disabled={isAuditor}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Bukidnon Bus Company"
                  autoComplete="organization"
                />
              </div>

              <div className="admin-settings__field-row">
                <div className="admin-settings__field">
                  <label className="admin-settings__label" htmlFor={idEmailCo}>
                    Company email
                  </label>
                  <input
                    id={idEmailCo}
                    className="admin-settings__input"
                    type="email"
                    value={companyEmail}
                    disabled={isAuditor}
                    onChange={(e) => setCompanyEmail(e.target.value)}
                    placeholder="operations@company.com"
                    autoComplete="email"
                  />
                </div>
                <div className="admin-settings__field">
                  <label className="admin-settings__label" htmlFor={idPhoneCo}>
                    Company phone
                  </label>
                  <input
                    id={idPhoneCo}
                    className="admin-settings__input"
                    type="tel"
                    value={companyPhone}
                    disabled={isAuditor}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    placeholder="+63 …"
                    autoComplete="tel"
                  />
                </div>
              </div>

              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={idLocationCo}>
                  Company location
                </label>
                <input
                  id={idLocationCo}
                  className="admin-settings__input"
                  type="text"
                  value={companyLocation}
                  disabled={isAuditor}
                  onChange={(e) => setCompanyLocation(e.target.value)}
                  placeholder="Main Terminal, Malaybalay City"
                  autoComplete="off"
                />
                <p className="admin-settings__hint admin-settings__hint--tight">
                  Type at least 3 characters for location suggestions. {companyLocationSearching ? "Searching..." : ""}
                </p>
                {companyLocationSearchErr ? <p className="admin-settings__warn">{companyLocationSearchErr}</p> : null}
                {companyLocationHits.length > 0 ? (
                  <div className="admin-settings__search-suggestions" role="listbox" aria-label="Location suggestions">
                    {companyLocationHits.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        className="admin-settings__search-suggestion"
                        onClick={() => {
                          setCompanyLocation(hit.detail);
                          setCompanyLocationHits([]);
                        }}
                      >
                        <strong>{hit.label}</strong>
                        <span>{hit.detail}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="admin-settings__field">
                <span className="admin-settings__label" id={`${idFile}-label`}>
                  Company&apos;s logo
                </span>
                <label
                  htmlFor={idFile}
                  className={"admin-settings__brand-upload" + (isAuditor ? " admin-settings__brand-upload--disabled" : "")}
                  aria-disabled={isAuditor}
                >
                  <div className="admin-settings__brand-upload-inner">
                    <div className="admin-settings__brand-upload-ring" aria-hidden>
                      <input
                        id={idFile}
                        ref={fileRef}
                        className="admin-settings__brand-upload-input"
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        disabled={isAuditor}
                        onChange={onFile}
                        aria-labelledby={`${idFile}-label`}
                      />
                      <svg
                        className="admin-settings__brand-upload-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="16 16 12 12 8 16" />
                        <line x1="12" y1="12" x2="12" y2="21" />
                        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                      </svg>
                    </div>
                    <div className="admin-settings__brand-upload-text">
                      <span>Click to upload image</span>
                    </div>
                  </div>
                </label>
                {fileHint ? <p className="admin-settings__warn">{fileHint}</p> : null}
              </div>

              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={`${idBase}-side-url`}>
                  Logo URL
                </label>
                <input
                  id={`${idBase}-side-url`}
                  className="admin-settings__input"
                  type="url"
                  value={sidebarLogoField}
                  disabled={isAuditor}
                  onChange={(e) => {
                    setSidebarLogoField(e.target.value);
                    setLogoPreviewBroken(false);
                  }}
                  placeholder="https://cdn.example.com/logo.png"
                />
                {(pendingSidebarDataUrl || (sidebarLogoField.trim() && isLikelyLogoSrc(sidebarLogoField))) &&
                !logoPreviewBroken ? (
                  <div className="admin-settings__logo-preview-wrap">
                    <img
                      className="admin-settings__logo-preview-img"
                      src={pendingSidebarDataUrl || sidebarLogoField.trim()}
                      alt="Logo preview"
                      onError={() => setLogoPreviewBroken(true)}
                    />
                  </div>
                ) : null}
                {logoPreviewBroken && (pendingSidebarDataUrl || sidebarLogoField.trim()) ? (
                  <p className="admin-settings__warn">Preview failed — check that the URL returns an image and allows embedding.</p>
                ) : null}
              </div>

              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={idFooter}>
                  Report footer (PDF exports)
                </label>
                <input
                  id={idFooter}
                  className="admin-settings__input"
                  type="text"
                  value={reportFooter}
                  disabled={isAuditor}
                  onChange={(e) => setReportFooter(e.target.value)}
                  placeholder="© 2026 Bukidnon Bus Company - Fleet Management Division"
                />
              </div>

              <div className="admin-settings__actions">
                <button
                  type="button"
                  className="admin-settings__btn admin-settings__btn--primary"
                  onClick={() => void saveBranding()}
                  disabled={isSaving || isAuditor}
                >
                  {isSaving ? "Saving…" : "Save branding"}
                </button>
              </div>
            </section>
          ) : null}

          {tab === "roles" ? (
            <section className="admin-settings__section" aria-labelledby={`${idBase}-rbac-h`}>
              <InfoHeadingRow
                h2Id={`${idBase}-rbac-h`}
                title="Role-based access control (RBAC)"
                infoKey="roles"
                panelId={`${idBase}-inf-roles`}
              >
                <p>
                  Control which areas appear in the <strong>Bus Attendant</strong> mobile app and the{" "}
                  <strong>Passenger</strong> web app. Values are stored on the server; mobile and passenger clients can read
                  them in a future update to hide or show tabs.
                </p>
              </InfoHeadingRow>

              <div className="admin-settings__app-access-card">
                <div className="admin-settings__segmented" role="tablist" aria-label="App to configure">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={appAccessTab === "attendant"}
                    className={
                      "admin-settings__segment" + (appAccessTab === "attendant" ? " admin-settings__segment--active" : "")
                    }
                    onClick={() => setAppAccessTab("attendant")}
                  >
                    Bus Attendant
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={appAccessTab === "passenger"}
                    className={
                      "admin-settings__segment" + (appAccessTab === "passenger" ? " admin-settings__segment--active" : "")
                    }
                    onClick={() => setAppAccessTab("passenger")}
                  >
                    Passenger
                  </button>
                </div>

                {appAccessTab === "attendant" ? (
                  <div className="admin-settings__app-access-list" role="tabpanel">
                    <SwitchRow
                      id={`${idBase}-aa-dash`}
                      label="Dashboard"
                      checked={mergeAttendantAccess(portal?.attendantAppAccess).dashboard}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                attendantAppAccess: {
                                  ...mergeAttendantAccess(p.attendantAppAccess),
                                  dashboard: v,
                                },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-aa-tix`}
                      label="Tickets"
                      checked={mergeAttendantAccess(portal?.attendantAppAccess).tickets}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                attendantAppAccess: { ...mergeAttendantAccess(p.attendantAppAccess), tickets: v },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-aa-pass`}
                      label="Edit passenger"
                      checked={mergeAttendantAccess(portal?.attendantAppAccess).editPassenger}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                attendantAppAccess: {
                                  ...mergeAttendantAccess(p.attendantAppAccess),
                                  editPassenger: v,
                                },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-aa-notif`}
                      label="Notifications"
                      checked={mergeAttendantAccess(portal?.attendantAppAccess).notification}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                attendantAppAccess: {
                                  ...mergeAttendantAccess(p.attendantAppAccess),
                                  notification: v,
                                },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-aa-set`}
                      label="Settings"
                      checked={mergeAttendantAccess(portal?.attendantAppAccess).settings}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                attendantAppAccess: { ...mergeAttendantAccess(p.attendantAppAccess), settings: v },
                              }
                            : p
                        )
                      }
                    />
                  </div>
                ) : (
                  <div className="admin-settings__app-access-list" role="tabpanel">
                    <SwitchRow
                      id={`${idBase}-pa-dash`}
                      label="Dashboard"
                      checked={mergePassengerAccess(portal?.passengerAppAccess).dashboard}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                passengerAppAccess: {
                                  ...mergePassengerAccess(p.passengerAppAccess),
                                  dashboard: v,
                                },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-pa-sch`}
                      label="Scheduled"
                      checked={mergePassengerAccess(portal?.passengerAppAccess).scheduled}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                passengerAppAccess: { ...mergePassengerAccess(p.passengerAppAccess), scheduled: v },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-pa-bus`}
                      label="Check buses"
                      checked={mergePassengerAccess(portal?.passengerAppAccess).checkBuses}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                passengerAppAccess: { ...mergePassengerAccess(p.passengerAppAccess), checkBuses: v },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-pa-news`}
                      label="News and updates"
                      checked={mergePassengerAccess(portal?.passengerAppAccess).newsUpdates}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                passengerAppAccess: { ...mergePassengerAccess(p.passengerAppAccess), newsUpdates: v },
                              }
                            : p
                        )
                      }
                    />
                    <SwitchRow
                      id={`${idBase}-pa-fb`}
                      label="Feedbacks"
                      checked={mergePassengerAccess(portal?.passengerAppAccess).feedbacks}
                      disabled={isAuditor || !portal}
                      onChange={(v) =>
                        setPortal((p) =>
                          p
                            ? {
                                ...p,
                                passengerAppAccess: { ...mergePassengerAccess(p.passengerAppAccess), feedbacks: v },
                              }
                            : p
                        )
                      }
                    />
                  </div>
                )}

                <div className="admin-settings__actions">
                  <button
                    type="button"
                    className="admin-settings__btn admin-settings__btn--primary"
                    onClick={() => void saveClientAppAccess()}
                    disabled={clientAppsSaving || isAuditor || !portal}
                  >
                    {clientAppsSaving ? "Saving…" : "Save app access"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {infoModal
        ? createPortal(
            <div
              className="admin-settings__dialog-backdrop"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) closeInfoModal();
              }}
            >
              <div
                id={infoModal.panelId}
                className="admin-settings__dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${idBase}-settings-info-title`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <h2 id={`${idBase}-settings-info-title`} className="admin-settings__dialog-title">
                  {infoModal.title}
                </h2>
                <div className="admin-settings__dialog-body">{infoModal.content}</div>
                <button type="button" className="admin-settings__dialog-close" onClick={closeInfoModal}>
                  Close
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
