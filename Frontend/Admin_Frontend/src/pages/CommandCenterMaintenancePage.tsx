import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { CommandCenterSubPageShell } from "@/components/CommandCenterSubPageShell";
import { useAuth } from "@/context/AuthContext";
import { fetchAdminPortalSettings, postAdminAuditEvent, putAdminPortalSettings } from "@/lib/api";
import "./CommandCenterPage.css";

const DEFAULT_MAINT_MESSAGE =
  "Bukidnon Bus Company is performing scheduled maintenance. Please try again shortly. Thank you for your patience.";

export function CommandCenterMaintenancePage() {
  const id = useId();
  const { user } = useAuth();
  const isSuper = user?.rbacRole === "super_admin" || user?.adminTier === "super";

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const [modeOn, setModeOn] = useState(false);
  const [lockPassenger, setLockPassenger] = useState(true);
  const [lockAttendant, setLockAttendant] = useState(true);
  const [message, setMessage] = useState(DEFAULT_MAINT_MESSAGE);

  const reload = useCallback(async () => {
    setLoadErr(null);
    try {
      const { settings } = await fetchAdminPortalSettings();
      setModeOn(settings.maintenanceShieldEnabled === true);
      setLockPassenger(settings.maintenancePassengerLocked !== false);
      setLockAttendant(settings.maintenanceAttendantLocked !== false);
      setMessage(
        typeof settings.maintenanceMessage === "string" && settings.maintenanceMessage.trim()
          ? settings.maintenanceMessage.trim()
          : DEFAULT_MAINT_MESSAGE
      );
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    if (!isSuper) return;
    setSaveErr(null);
    setSaveOk(null);
    if (modeOn && !lockPassenger && !lockAttendant) {
      setSaveErr("When maintenance mode is on, choose at least one app (Passenger or Bus Attendant).");
      return;
    }
    setSaving(true);
    try {
      await putAdminPortalSettings({
        maintenance: {
          maintenanceShieldEnabled: modeOn,
          maintenancePassengerLocked: lockPassenger,
          maintenanceAttendantLocked: lockAttendant,
          maintenanceMessage: message.trim() || DEFAULT_MAINT_MESSAGE,
        },
      });
      setSaveOk("Maintenance settings saved.");
      window.setTimeout(() => setSaveOk(null), 3200);
      void postAdminAuditEvent({
        action: "EDIT",
        module: "Command Center · Maintenance",
        details: `Maintenance mode ${modeOn ? "ON" : "OFF"} · passenger ${lockPassenger ? "locked" : "open"} · attendant ${lockAttendant ? "locked" : "open"}`,
      }).catch(() => {});
      await reload();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [isSuper, modeOn, lockPassenger, lockAttendant, message, reload]);

  return (
    <div className="command-center command-center--tactical command-center--sub command-center--crumbs-left">
      <CommandCenterSubPageShell page="maintenance">
        <header className="command-center__sub-head">
          <h1 className="command-center__sub-title">Maintenance window</h1>
          <p className="command-center__sub-lead">
            Turn maintenance mode on, choose which apps are blocked, and set the message passengers and attendants see.
          </p>
        </header>

        {saveOk ? <div className="command-center__flash">{saveOk}</div> : null}
        {saveErr ? (
          <div className="command-center__flash command-center__flash--err" role="alert">
            {saveErr}
          </div>
        ) : null}
        {loadErr ? (
          <div className="command-center__flash command-center__flash--err" role="alert">
            {loadErr}
          </div>
        ) : null}

        <div className="command-center__sub-body command-center__sub-body--narrow">
        <section className="command-center__card command-center__card--glass" aria-labelledby={`${id}-maint`}>
          <h2 id={`${id}-maint`} className="command-center__h2">
            Maintenance mode
          </h2>
          {!isSuper ? (
            <p className="command-center__hint" style={{ textAlign: "center" }}>
              Only <strong>Super Admin</strong> can change maintenance. You can still review the page; open{" "}
              <Link to="/dashboard/settings">Settings</Link> for other portal options.
            </p>
          ) : null}

          {loading ? (
            <p className="command-center__hint" style={{ textAlign: "center" }}>
              Loading…
            </p>
          ) : (
            <>
              <div className="command-center__severity-row command-center__maint-mode-row">
                <span className="command-center__severity-label">Maintenance mode</span>
                <label className="command-center__maint-switch-label">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={modeOn}
                    disabled={!isSuper}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setModeOn(on);
                      if (on) {
                        setLockPassenger(true);
                        setLockAttendant(true);
                      }
                    }}
                  />
                  <span>{modeOn ? "On" : "Off"}</span>
                </label>
                <p className="command-center__hint command-center__hint--tight">
                  When on, selected apps show a full-screen maintenance notice and cannot be used until you turn this off or
                  unlock the app.
                </p>
              </div>

              {modeOn ? (
                <>
                  <p className="command-center__severity-label" style={{ marginTop: "0.5rem" }}>
                    Apps in maintenance
                  </p>
                  <div className="command-center__target-row">
                    <button
                      type="button"
                      className={
                        "command-center__btn command-center__btn--target" +
                        (lockPassenger ? " command-center__btn--target-active" : "")
                      }
                      disabled={!isSuper}
                      onClick={() => setLockPassenger((v) => !v)}
                      aria-pressed={lockPassenger}
                    >
                      Passenger app
                    </button>
                    <button
                      type="button"
                      className={
                        "command-center__btn command-center__btn--target" +
                        (lockAttendant ? " command-center__btn--target-active" : "")
                      }
                      disabled={!isSuper}
                      onClick={() => setLockAttendant((v) => !v)}
                      aria-pressed={lockAttendant}
                    >
                      Bus Attendant app
                    </button>
                  </div>
                </>
              ) : null}

              <label className="command-center__severity-label" htmlFor={`${id}-msg`} style={{ marginTop: "1rem" }}>
                Message shown on the app
              </label>
              <textarea
                id={`${id}-msg`}
                className="command-center__textarea command-center__textarea--terminal"
                rows={5}
                value={message}
                disabled={!isSuper}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={DEFAULT_MAINT_MESSAGE}
                maxLength={4000}
              />

              {isSuper ? (
                <div className="command-center__btn-row" style={{ marginTop: "0.85rem", justifyContent: "center" }}>
                  <button
                    type="button"
                    className="command-center__btn command-center__btn--primary"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? "Saving…" : "Save maintenance settings"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
        </div>
      </CommandCenterSubPageShell>
    </div>
  );
}
