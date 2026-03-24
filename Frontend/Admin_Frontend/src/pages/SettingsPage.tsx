import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useAdminBranding } from "@/context/AdminBrandingContext";
import { useTheme } from "@/context/ThemeContext";
import { api } from "@/lib/api";
import type { TicketRow } from "@/lib/types";
import "./SettingsPage.css";

const MAX_FILE_BYTES = 800 * 1024;
const LS_FARE_SCHED = "settings_fare_schedule_v1";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { branding, setBranding, resetBranding } = useAdminBranding();
  const [companyName, setCompanyName] = useState(branding.companyName);
  const [logoUrlField, setLogoUrlField] = useState(branding.logoUrl ?? "");
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [fileHint, setFileHint] = useState<string | null>(null);
  const [schedDate, setSchedDate] = useState("");
  const [schedFrom, setSchedFrom] = useState("15");
  const [schedTo, setSchedTo] = useState("18");
  const [toolMsg, setToolMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const idBase = useId();
  const idCompany = `${idBase}-company`;
  const idUrl = `${idBase}-url`;
  const idFile = `${idBase}-file`;

  useEffect(() => {
    setCompanyName(branding.companyName);
    setLogoUrlField(branding.logoUrl ?? "");
    setPendingDataUrl(null);
    setFileHint(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [branding.companyName, branding.logoUrl]);

  useEffect(() => {
    const saved = localStorage.getItem(LS_FARE_SCHED);
    if (!saved) return;
    try {
      const x = JSON.parse(saved) as { date: string; from: string; to: string };
      setSchedDate(x.date ?? "");
      setSchedFrom(x.from ?? "15");
      setSchedTo(x.to ?? "18");
    } catch {
      /* ignore */
    }
  }, []);

  const previewSrc = pendingDataUrl ?? (logoUrlField.trim() || branding.logoUrl || "");

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFileHint(null);
    setPendingDataUrl(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setFileHint("Please choose an image file.");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileHint("Image is too large (max 800 KB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") setPendingDataUrl(r);
    };
    reader.readAsDataURL(f);
  };

  const save = () => {
    const url = pendingDataUrl ?? (logoUrlField.trim() || null);
    setBranding({
      companyName,
      logoUrl: url,
    });
    setPendingDataUrl(null);
    setFileHint(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const clearLogo = () => {
    setLogoUrlField("");
    setPendingDataUrl(null);
    setFileHint(null);
    if (fileRef.current) fileRef.current.value = "";
    setBranding({ logoUrl: null });
  };

  const exportCsv = async () => {
    try {
      const res = await api<{ items: TicketRow[] }>("/api/tickets");
      const rows = res.items;
      const header = ["id", "passengerId", "startLocation", "destination", "fare", "busOperatorName", "issuedByOperatorId", "createdAt"];
      const body = rows.map((t) =>
        [t.id, t.passengerId, t.startLocation, t.destination, t.fare, t.busOperatorName, t.issuedByOperatorId, t.createdAt]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(",")
      );
      const csv = [header.join(","), ...body].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `tickets-export-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToolMsg("Ticket data exported to CSV.");
      window.setTimeout(() => setToolMsg(null), 2200);
    } catch (e) {
      setToolMsg(e instanceof Error ? e.message : "Export failed");
    }
  };

  const saveFareSchedule = () => {
    localStorage.setItem(LS_FARE_SCHED, JSON.stringify({ date: schedDate, from: schedFrom, to: schedTo }));
    setToolMsg(`Fare schedule saved: ₱${Number(schedFrom).toFixed(2)} → ₱${Number(schedTo).toFixed(2)} on ${schedDate || "(date not set)"}`);
    window.setTimeout(() => setToolMsg(null), 2600);
  };

  return (
    <div className="admin-settings">
      <header className="admin-settings__head">
        <h1 className="admin-settings__title">Settings</h1>
        <p className="admin-settings__lead">Appearance, branding, and preferences for this browser.</p>
      </header>

      <section className="admin-settings__card admin-settings__card--spaced" aria-labelledby={`${idBase}-appear-h`}>
        <h2 id={`${idBase}-appear-h`} className="admin-settings__h2">
          Appearance
        </h2>
        <p className="admin-settings__hint">Choose light or dark mode for the admin dashboard, sidebar, and settings.</p>
        <div className="admin-settings__theme" role="group" aria-label="Color theme">
          <button
            type="button"
            className={"admin-settings__theme-btn" + (theme === "dark" ? " admin-settings__theme-btn--active" : "")}
            onClick={() => setTheme("dark")}
            aria-pressed={theme === "dark"}
          >
            Dark mode
          </button>
          <button
            type="button"
            className={"admin-settings__theme-btn" + (theme === "light" ? " admin-settings__theme-btn--active" : "")}
            onClick={() => setTheme("light")}
            aria-pressed={theme === "light"}
          >
            Light mode
          </button>
        </div>
      </section>

      <section className="admin-settings__card admin-settings__card--spaced" aria-labelledby={`${idBase}-dev-h`}>
        <h2 id={`${idBase}-dev-h`} className="admin-settings__h2">
          Developer & cooperative tools
        </h2>

        <div className="admin-settings__field">
          <span className="admin-settings__label">Manual data export</span>
          <p className="admin-settings__hint">Download all ticket records to CSV so you can back up to Google Drive daily.</p>
          <button type="button" className="admin-settings__btn" onClick={exportCsv}>
            Export all ticket data to CSV
          </button>
        </div>

        <div className="admin-settings__field">
          <span className="admin-settings__label">Scheduled fare change</span>
          <div className="admin-settings__sched-grid">
            <label>
              <span className="admin-settings__hint">Date</span>
              <input className="admin-settings__input" type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} />
            </label>
            <label>
              <span className="admin-settings__hint">From (₱)</span>
              <input className="admin-settings__input" type="number" value={schedFrom} onChange={(e) => setSchedFrom(e.target.value)} />
            </label>
            <label>
              <span className="admin-settings__hint">To (₱)</span>
              <input className="admin-settings__input" type="number" value={schedTo} onChange={(e) => setSchedTo(e.target.value)} />
            </label>
          </div>
          <button type="button" className="admin-settings__btn admin-settings__btn--primary" onClick={saveFareSchedule}>
            Save fare schedule
          </button>
        </div>

        {toolMsg ? <p className="admin-settings__hint">{toolMsg}</p> : null}
      </section>

      <section className="admin-settings__card" aria-labelledby={`${idBase}-brand-h`}>
        <h2 id={`${idBase}-brand-h`} className="admin-settings__h2">
          Brand identity
        </h2>

        <div className="admin-settings__field">
          <label className="admin-settings__label" htmlFor={idCompany}>
            Company name
          </label>
          <input
            id={idCompany}
            className="admin-settings__input"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Bukidnon"
            autoComplete="organization"
          />
        </div>

        <div className="admin-settings__field">
          <label className="admin-settings__label" htmlFor={idUrl}>
            Logo image URL <span className="admin-settings__optional">(optional)</span>
          </label>
          <input
            id={idUrl}
            className="admin-settings__input"
            type="url"
            value={logoUrlField}
            onChange={(e) => setLogoUrlField(e.target.value)}
            placeholder="https://… or leave empty"
          />
          <p className="admin-settings__hint">Use a direct link to a PNG, SVG, or WebP. You can also upload a file below.</p>
        </div>

        <div className="admin-settings__field">
          <label className="admin-settings__label" htmlFor={idFile}>
            Upload logo <span className="admin-settings__optional">(optional)</span>
          </label>
          <input id={idFile} ref={fileRef} className="admin-settings__file" type="file" accept="image/*" onChange={onFile} />
          {fileHint ? <p className="admin-settings__warn">{fileHint}</p> : null}
        </div>

        <div className="admin-settings__preview-block">
          <span className="admin-settings__label">Preview</span>
          <div className="admin-settings__preview">
            {previewSrc ? (
              <img src={previewSrc} alt="" className="admin-settings__preview-img" onError={() => setFileHint("Image failed to load. Check the URL.")} />
            ) : (
              <div className="admin-settings__preview-fallback" aria-hidden>
                {(companyName.trim().charAt(0) || "B").toUpperCase()}
              </div>
            )}
            <div className="admin-settings__preview-text">{companyName.trim() || "Company name"}</div>
          </div>
        </div>

        <div className="admin-settings__actions">
          <button type="button" className="admin-settings__btn admin-settings__btn--primary" onClick={save}>
            Save branding
          </button>
          <button type="button" className="admin-settings__btn" onClick={clearLogo}>
            Remove logo
          </button>
          <button type="button" className="admin-settings__btn admin-settings__btn--ghost" onClick={() => resetBranding()}>
            Reset to defaults
          </button>
        </div>
      </section>
    </div>
  );
}
