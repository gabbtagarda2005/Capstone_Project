import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import { useTheme } from "@/context/ThemeContext";
import { pushAdminAudit } from "@/lib/adminAudit";
import { useAuth } from "@/context/AuthContext";
import {
  fetchAdminPortalSettings,
  fetchAdminRbac,
  putAdminPortalSettings,
  putAdminRbac,
} from "@/lib/api";
import type { AdminPortalSettingsDto, AdminRbacRole } from "@/lib/types";
import {
  LS_DEV_SHOW_TECHNICAL,
  LS_SEC_GEOFENCE_PUSH,
  LS_SEC_SENSITIVE_REAUTH,
  readLsBool,
  writeLsBool,
} from "@/lib/settingsPrefs";
import "./SettingsPage.css";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const;
type SettingsTab = "general" | "security" | "branding" | "roles";

type SettingsInfoKey =
  | "overview"
  | "appearance"
  | "notifications"
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

const ROLE_LABELS: Record<AdminRbacRole, string> = {
  super_admin: "Super Admin",
  fleet_manager: "Fleet Manager",
  auditor: "Auditor",
};

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { branding, setBranding, applyServerSettings } = useAdminBranding();
  const rbac = user?.rbacRole ?? null;
  const isAuditor = rbac === "auditor";
  const isSuper = rbac === "super_admin" || user?.adminTier === "super";

  const [tab, setTab] = useState<SettingsTab>("general");
  const [portal, setPortal] = useState<AdminPortalSettingsDto | null>(null);
  const [rbacRows, setRbacRows] = useState<{ email: string; role: AdminRbacRole }[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState(branding.companyName);
  const [sidebarLogoField, setSidebarLogoField] = useState(branding.sidebarLogoUrl ?? "");
  const [faviconField, setFaviconField] = useState(branding.faviconUrl ?? "");
  const [reportFooter, setReportFooter] = useState(branding.reportFooter);
  const [pendingSidebarDataUrl, setPendingSidebarDataUrl] = useState<string | null>(null);
  const [fileHint, setFileHint] = useState<string | null>(null);
  const [toolMsg, setToolMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [rbacBusy, setRbacBusy] = useState(false);

  const [geofencePush, setGeofencePush] = useState(() => readLsBool(LS_SEC_GEOFENCE_PUSH, true));
  const [sensitiveReauth, setSensitiveReauth] = useState(() => readLsBool(LS_SEC_SENSITIVE_REAUTH, false));
  const [developerMode, setDeveloperMode] = useState(() => readLsBool(LS_DEV_SHOW_TECHNICAL, false));
  const [infoOpen, setInfoOpen] = useState<Partial<Record<SettingsInfoKey, boolean>>>({});

  function flipInfo(key: SettingsInfoKey) {
    setInfoOpen((m) => ({ ...m, [key]: !m[key] }));
  }

  function InfoTrigger({ k, label, panelId }: { k: SettingsInfoKey; label: string; panelId: string }) {
    const open = Boolean(infoOpen[k]);
    return (
      <button
        type="button"
        className={"admin-settings__info-trigger" + (open ? " admin-settings__info-trigger--open" : "")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => flipInfo(k)}
        title={`${open ? "Hide" : "Show"}: ${label}`}
      >
        <svg viewBox="0 0 24 24" className="admin-settings__info-svg" aria-hidden>
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path fill="currentColor" d="M11 10h2v8h-2v-8zm0-4h2v2h-2V6z" />
        </svg>
        <span className="admin-settings__sr-only">
          {open ? "Hide" : "Show"} {label} description
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
    const open = Boolean(infoOpen[infoKey]);
    return (
      <>
        <div className={"admin-settings__h2-row" + (spaced ? " admin-settings__h2-row--spaced" : "")}>
          <h2 id={h2Id} className="admin-settings__h2">
            {title}
          </h2>
          <InfoTrigger k={infoKey} label={title} panelId={panelId} />
        </div>
        {open ? (
          <div id={panelId} className="admin-settings__info-panel" role="region" aria-label={`${title} details`}>
            {children}
          </div>
        ) : null}
      </>
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
  const idBase = useId();
  const idCompany = `${idBase}-company`;
  const idFav = `${idBase}-fav`;
  const idFooter = `${idBase}-footer`;
  const idFile = `${idBase}-file`;

  const loadAll = useCallback(async () => {
    setLoadErr(null);
    try {
      const [s, r] = await Promise.all([fetchAdminPortalSettings(), fetchAdminRbac()]);
      setPortal(s.settings);
      setRbacRows(r.items);
      setCompanyName(s.settings.companyName);
      setSidebarLogoField(s.settings.sidebarLogoUrl ?? "");
      setFaviconField(s.settings.faviconUrl ?? "");
      setReportFooter(s.settings.reportFooter);
      setGeofencePush(s.settings.geofenceBreachToasts !== false);
      setSensitiveReauth(s.settings.sensitiveActionConfirmation === true);
      applyServerSettings({
        companyName: s.settings.companyName,
        sidebarLogoUrl: s.settings.sidebarLogoUrl,
        faviconUrl: s.settings.faviconUrl,
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
    setFaviconField(branding.faviconUrl ?? "");
    setReportFooter(branding.reportFooter);
    setPendingSidebarDataUrl(null);
    setFileHint(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [branding.companyName, branding.sidebarLogoUrl, branding.faviconUrl, branding.reportFooter]);

  const previewSidebar = pendingSidebarDataUrl ?? (sidebarLogoField.trim() || branding.sidebarLogoUrl || "");

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
      if (typeof r === "string") setPendingSidebarDataUrl(r);
    };
    reader.readAsDataURL(f);
  };

  const saveAlertPrefsOnly = async () => {
    if (isAuditor || !portal) return;
    setIsSaving(true);
    try {
      const r = await putAdminPortalSettings({
        general: {
          emailDailySummary: portal.emailDailySummary,
          soundAlerts: portal.soundAlerts,
          timezone: "Asia/Manila",
          currency: "PHP",
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
        faviconUrl: r.settings.faviconUrl,
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
          emailDailySummary: portal.emailDailySummary,
          soundAlerts: portal.soundAlerts,
          timezone: "Asia/Manila",
          currency: "PHP",
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
        faviconUrl: r.settings.faviconUrl,
        reportFooter: r.settings.reportFooter,
        sessionTimeoutMinutes: r.settings.sessionTimeoutMinutes ?? 30,
        geofenceBreachToasts: r.settings.geofenceBreachToasts !== false,
        sensitiveActionConfirmation: r.settings.sensitiveActionConfirmation === true,
      });
      pushAdminAudit({
        admin: user?.email ?? "admin@local",
        level: "WARNING",
        action: "updated general portal settings (notifications & regional policy)",
      });
      setToolMsg("General settings saved.");
      window.setTimeout(() => setToolMsg(null), 2400);
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const saveSecurity = async () => {
    if (isAuditor || !isSuper || !portal) return;
    setIsSaving(true);
    try {
      const r = await putAdminPortalSettings({
        security: {
          maxLoginAttempts: portal.maxLoginAttempts,
          lockoutMinutes: portal.lockoutMinutes,
          sessionTimeoutMinutes: portal.sessionTimeoutMinutes,
        },
      });
      setPortal(r.settings);
      applyServerSettings({
        companyName: r.settings.companyName,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: r.settings.faviconUrl,
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
      setToolMsg("Security policy saved.");
      window.setTimeout(() => setToolMsg(null), 2400);
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const saveBranding = async () => {
    if (isAuditor) return;
    setIsSaving(true);
    const url = pendingSidebarDataUrl ?? (sidebarLogoField.trim() || null);
    try {
      const r = await putAdminPortalSettings({
        branding: {
          companyName: companyName.trim() || "Bukidnon Bus Company",
          sidebarLogoUrl: url,
          faviconUrl: faviconField.trim() || null,
          reportFooter: reportFooter.trim() || branding.reportFooter,
        },
      });
      setPortal(r.settings);
      setBranding({
        companyName: r.settings.companyName,
        logoUrl: r.settings.sidebarLogoUrl,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: r.settings.faviconUrl,
        reportFooter: r.settings.reportFooter,
      });
      applyServerSettings({
        companyName: r.settings.companyName,
        sidebarLogoUrl: r.settings.sidebarLogoUrl,
        faviconUrl: r.settings.faviconUrl,
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

  const clearSidebarLogo = () => {
    setSidebarLogoField("");
    setPendingSidebarDataUrl(null);
    setFileHint(null);
    if (fileRef.current) fileRef.current.value = "";
    setBranding({ sidebarLogoUrl: null, logoUrl: null });
  };

  const onRbacChange = async (email: string, role: AdminRbacRole) => {
    if (!isSuper || isAuditor) return;
    setRbacBusy(true);
    try {
      const next = rbacRows.map((row) => (row.email === email ? { ...row, role } : row));
      const r = await putAdminRbac(next);
      setRbacRows(r.items);
      pushAdminAudit({
        admin: user?.email ?? "admin@local",
        level: "WARNING",
        action: `RBAC: set ${email} → ${role}`,
      });
      setToolMsg("Access roles updated.");
      window.setTimeout(() => setToolMsg(null), 2400);
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "RBAC update failed");
    } finally {
      setRbacBusy(false);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "security", label: "Security" },
    { id: "branding", label: "Branding" },
    { id: "roles", label: "Role Base" },
  ];

  const overviewPanelId = `${idBase}-info-overview`;

  return (
    <div className="admin-settings">
      <header className="admin-settings__head">
        <div className="admin-settings__head-top">
          <div className="admin-settings__head-text">
            <h1 className="admin-settings__title">Settings</h1>
            <p className="admin-settings__lead">
              Operational defaults, security policy, branding, and access control — use the <strong>Role Base</strong> tab
              for RBAC; other sections sync with the admin API when you save.
            </p>
          </div>
          <InfoTrigger k="overview" label="Settings overview" panelId={overviewPanelId} />
        </div>
        {infoOpen.overview ? (
          <div
            id={overviewPanelId}
            className="admin-settings__info-panel admin-settings__info-panel--below-head"
            role="region"
            aria-label="Settings overview"
          >
            <ul className="admin-settings__info-list">
              <li>
                <strong>General</strong> — <strong>Appearance</strong>: theme applies to the admin shell, sidebar, and this
                page. <strong>Dark interface</strong>: turn off for light mode — optimized for bright displays.{" "}
                <strong>System notifications</strong>: email alerts (daily revenue summary) when SMTP is configured, sends a
                daily revenue digest to the administrator inbox; sound effects (&quot;chime&quot;) for new maintenance
                alerts or geofence-style incidents (where supported). <strong>Regional</strong>: timezone (GMT+08:00) Manila
                — fixed for accurate driver shift logs; currency format Philippine Peso (₱).
              </li>
              <li>
                <strong>Security</strong> — Login protection (attempts and lockout), session timeout, geofence breach
                toasts, sensitive-action confirmation, and developer mode for technical route hints.
              </li>
              <li>
                <strong>Branding</strong> — Company name, company&apos;s logo, favicon URL, and report footer text for PDF exports.
              </li>
              <li>
                <strong>Role Base</strong> — Assigns RBAC roles (Super Admin, Fleet Manager, Auditor) to each whitelisted
                admin email; only Super Admin can change roles.
              </li>
            </ul>
          </div>
        ) : null}
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
                h2Id={`${idBase}-gen-notify-h`}
                title="System notifications"
                infoKey="notifications"
                panelId={`${idBase}-inf-notify`}
                spaced
              >
                <p>
                  <strong>Email alerts (daily revenue summary)</strong> — When SMTP is configured, sends a daily revenue
                  digest to the administrator inbox.
                </p>
                <p>
                  <strong>Sound effects (&quot;chime&quot;)</strong> — Play a short tone for new maintenance alerts or
                  geofence-style incidents (where supported).
                </p>
              </InfoHeadingRow>
              <SwitchRow
                id={`${idBase}-email-sum`}
                label="Email alerts (daily revenue summary)"
                checked={portal?.emailDailySummary ?? false}
                disabled={isAuditor}
                onChange={(v) => setPortal((p) => (p ? { ...p, emailDailySummary: v } : p))}
              />
              <SwitchRow
                id={`${idBase}-sound`}
                label="Sound effects (“chime”)"
                checked={portal?.soundAlerts ?? true}
                disabled={isAuditor}
                onChange={(v) => setPortal((p) => (p ? { ...p, soundAlerts: v } : p))}
              />

              <InfoHeadingRow
                h2Id={`${idBase}-gen-reg-h`}
                title="Regional"
                infoKey="regional"
                panelId={`${idBase}-inf-regional`}
                spaced
              >
                <p>
                  <strong>Timezone</strong> — (GMT+08:00) Manila — fixed for accurate driver shift logs.
                </p>
                <p>
                  <strong>Currency format</strong> — Philippine Peso (₱).
                </p>
              </InfoHeadingRow>
              <div className="admin-settings__field">
                <span className="admin-settings__label">Timezone</span>
                <p className="admin-settings__readonly">(GMT+08:00) Manila — fixed for accurate driver shift logs.</p>
              </div>
              <div className="admin-settings__field">
                <span className="admin-settings__label">Currency format</span>
                <p className="admin-settings__readonly">Philippine Peso (₱)</p>
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
              <InfoHeadingRow
                h2Id={`${idBase}-sec-h`}
                title="Login protection"
                infoKey="secLogin"
                panelId={`${idBase}-inf-seclogin`}
              >
                <p>
                  Enforced on password sign-in. Values are stored in MongoDB and apply to all whitelisted admins. Adjust
                  max login attempts and lockout duration to balance security with operator convenience.
                </p>
              </InfoHeadingRow>
              <div className="admin-settings__field-row">
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
                  The portal runs an inactivity watcher; when the timer expires you are signed out and returned to the
                  login screen.
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

              <InfoHeadingRow
                h2Id={`${idBase}-sec-inc-h`}
                title="Incident alerts (this browser)"
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
                  <strong>Developer mode</strong> — Shows technical API route references in management modules (UI-only).
                </p>
              </InfoHeadingRow>
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
              <SwitchRow
                id={`${idBase}-dev-mode`}
                label="Developer mode"
                checked={developerMode}
                disabled={isAuditor}
                onChange={(v) => {
                  setDeveloperMode(v);
                  writeLsBool(LS_DEV_SHOW_TECHNICAL, v);
                }}
              />
              <div className="admin-settings__actions admin-settings__actions--stack">
                <button
                  type="button"
                  className="admin-settings__btn"
                  onClick={() => void saveAlertPrefsOnly()}
                  disabled={isSaving || isAuditor || !portal}
                >
                  {isSaving ? "Saving…" : "Save alert preferences"}
                </button>
                <button
                  type="button"
                  className="admin-settings__btn admin-settings__btn--primary"
                  onClick={() => void saveSecurity()}
                  disabled={isSaving || isAuditor || !isSuper || !portal}
                >
                  {isSaving ? "Saving…" : "Save security policy"}
                </button>
                {!isSuper ? (
                  <span className="admin-settings__hint">Only Super Admin can edit lockout and session timeout.</span>
                ) : null}
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
                  <strong>Company&apos;s logo</strong> — Shown next to the company name in the sidebar. Upload a file or
                  paste a URL / data URL.
                </p>
                <p>
                  <strong>Favicon</strong> — Icon for the browser tab.
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

              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={idFile}>
                  Company&apos;s Logo
                </label>
                <input
                  id={idFile}
                  ref={fileRef}
                  className="admin-settings__file"
                  type="file"
                  accept="image/*"
                  disabled={isAuditor}
                  onChange={onFile}
                />
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
                  onChange={(e) => setSidebarLogoField(e.target.value)}
                  placeholder="https://… or data URL"
                />
              </div>

              <div className="admin-settings__field">
                <label className="admin-settings__label" htmlFor={idFav}>
                  Favicon URL
                </label>
                <input
                  id={idFav}
                  className="admin-settings__input"
                  type="url"
                  value={faviconField}
                  disabled={isAuditor}
                  onChange={(e) => setFaviconField(e.target.value)}
                  placeholder="https://…/favicon.png"
                />
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

              <div className="admin-settings__preview-block">
                <span className="admin-settings__label">Preview</span>
                <div className="admin-settings__preview">
                  {previewSidebar ? (
                    <img
                      src={previewSidebar}
                      alt=""
                      className="admin-settings__preview-img admin-settings__preview-img--round"
                      onError={() => setFileHint("Image failed to load. Check the URL.")}
                    />
                  ) : (
                    <div className="admin-settings__preview-fallback" aria-hidden>
                      {(companyName.trim().charAt(0) || "B").toUpperCase()}
                    </div>
                  )}
                  <div className="admin-settings__preview-text">{companyName.trim() || "Company name"}</div>
                </div>
              </div>

              <div className="admin-settings__actions">
                <button
                  type="button"
                  className="admin-settings__btn admin-settings__btn--primary"
                  onClick={() => void saveBranding()}
                  disabled={isSaving || isAuditor}
                >
                  {isSaving ? "Verifying security…" : "Save branding"}
                </button>
                <button type="button" className="admin-settings__btn" onClick={clearSidebarLogo} disabled={isAuditor}>
                  Remove company&apos;s logo
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
                  The <strong>Role Base</strong> tab lists every whitelisted admin email. <strong>Super Admin</strong> can
                  assign <strong>Fleet Manager</strong> (day-to-day operations; cannot edit fares) or{" "}
                  <strong>Auditor</strong> (read-only across the portal).
                </p>
                <p>
                  <strong>Only Super Admin can change roles.</strong> Changes apply on save and are audited.
                </p>
              </InfoHeadingRow>

              <div className="admin-settings__rbac admin-settings__rbac--tab">
                <div className="admin-settings__rbac-list">
                  {rbacRows.length === 0 ? (
                    <p className="admin-settings__hint">Loading whitelisted accounts…</p>
                  ) : null}
                  {rbacRows.map((row) => (
                    <div key={row.email} className="admin-settings__rbac-row">
                      <div>
                        <p className="admin-settings__rbac-email">{row.email}</p>
                        <p className="admin-settings__rbac-role-label">
                          Current role: {ROLE_LABELS[row.role] ?? row.role}
                        </p>
                      </div>
                      <select
                        className="admin-settings__rbac-select"
                        value={row.role}
                        disabled={!isSuper || isAuditor || rbacBusy}
                        onChange={(e) => void onRbacChange(row.email, e.target.value as AdminRbacRole)}
                        aria-label={`Role for ${row.email}`}
                      >
                        {(Object.keys(ROLE_LABELS) as AdminRbacRole[]).map((k) => (
                          <option key={k} value={k}>
                            {ROLE_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
