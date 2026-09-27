import { useCallback, useEffect, useState } from "react";
import {
  deleteItAccount,
  fetchItAccountLogs,
  fetchItAccounts,
  updateItAccount,
  type ItAccountDto,
} from "@/lib/api";
import type { AdminAuditLogRowDto } from "@/lib/types";
import { swalConfirm } from "@/lib/swal";
import { useToast } from "@/context/ToastContext";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";
import "./ItAccountsPage.css";

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ItAccountCard({
  account,
  onView,
  onEdit,
  onDelete,
  busy,
}: {
  account: ItAccountDto;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <article className={"it-acct-card" + (account.active ? "" : " it-acct-card--inactive")}>
      <div className="it-acct-card__head">
        <span className="it-acct-card__avatar" aria-hidden>
          {account.firstName.charAt(0).toUpperCase() || "I"}
        </span>
        <div className="it-acct-card__id">
          <span className="it-acct-card__name">
            {account.firstName} {account.lastName}
          </span>
          <span className="it-acct-card__email">{account.email}</span>
        </div>
      </div>
      <span className={"it-acct-card__status" + (account.active ? " it-acct-card__status--active" : "")}>
        {account.active ? "Active" : "Deactivated"}
      </span>
      <p className="it-acct-card__meta">Created {formatDateTime(account.createdAt)}</p>
      <div className="it-acct-card__actions">
        <button type="button" className="it-acct-card__btn" onClick={onView} disabled={busy}>
          View
        </button>
        <button type="button" className="it-acct-card__btn" onClick={onEdit} disabled={busy}>
          Edit
        </button>
        <button type="button" className="it-acct-card__btn it-acct-card__btn--danger" onClick={onDelete} disabled={busy}>
          Delete
        </button>
      </div>
    </article>
  );
}

function ViewLogsModal({ account, onClose }: { account: ItAccountDto; onClose: () => void }) {
  const [logs, setLogs] = useState<AdminAuditLogRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchItAccountLogs(account.email)
      .then((r) => {
        if (!cancelled) setLogs(r.items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load login history.");
      });
    return () => {
      cancelled = true;
    };
  }, [account.email]);

  return (
    <div className="it-acct-modal__backdrop" role="presentation" onMouseDown={onClose}>
      <div className="it-acct-modal" role="dialog" aria-modal="true" aria-label="Login history" onMouseDown={(e) => e.stopPropagation()}>
        <header className="it-acct-modal__head">
          <div>
            <h2 className="it-acct-modal__title">Login history</h2>
            <p className="it-acct-modal__sub">{account.email}</p>
          </div>
          <button type="button" className="it-acct-modal__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="it-acct-modal__body">
          {logs == null && !error ? <p className="it-acct-modal__empty">Loading…</p> : null}
          {error ? <p className="it-acct-modal__empty">{error}</p> : null}
          {logs && logs.length === 0 ? <p className="it-acct-modal__empty">No sign-ins recorded yet.</p> : null}
          {logs && logs.length > 0 ? (
            <ul className="it-acct-modal__log-list">
              {logs.map((row) => (
                <li key={row.id} className="it-acct-modal__log-row">
                  <span className="it-acct-modal__log-dot" aria-hidden />
                  <div>
                    <p className="it-acct-modal__log-text">{row.details}</p>
                    <p className="it-acct-modal__log-time">{formatDateTime(row.timestamp)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EditAccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: ItAccountDto;
  onClose: () => void;
  onSaved: (next: ItAccountDto) => void;
}) {
  const { showError, showSuccess } = useToast();
  const [firstName, setFirstName] = useState(account.firstName);
  const [lastName, setLastName] = useState(account.lastName);
  const [busy, setBusy] = useState(false);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await updateItAccount(account.email, { firstName, lastName });
      showSuccess("Profile updated.");
      onSaved(next);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAccess() {
    const nextActive = !account.active;
    if (
      !(await swalConfirm({
        title: `${nextActive ? "Reactivate" : "Deactivate"} access?`,
        text: nextActive
          ? "Restore this IT account's ability to sign in?"
          : "This account will no longer be able to sign in until you reactivate it.",
        icon: "warning",
        confirmButtonText: nextActive ? "Reactivate" : "Deactivate",
      }))
    )
      return;
    setBusy(true);
    try {
      const next = await updateItAccount(account.email, { active: nextActive });
      showSuccess(nextActive ? "Access reactivated." : "Access deactivated.");
      onSaved(next);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Could not update access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="it-acct-modal__backdrop" role="presentation" onMouseDown={onClose}>
      <div className="it-acct-modal" role="dialog" aria-modal="true" aria-label="Edit IT account" onMouseDown={(e) => e.stopPropagation()}>
        <header className="it-acct-modal__head">
          <div>
            <h2 className="it-acct-modal__title">Edit IT account</h2>
            <p className="it-acct-modal__sub">{account.email}</p>
          </div>
          <button type="button" className="it-acct-modal__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <form className="it-acct-modal__body" onSubmit={(e) => void handleSaveName(e)}>
          <label className="it-acct-modal__field">
            <span>First name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy} />
          </label>
          <label className="it-acct-modal__field">
            <span>Last name</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy} />
          </label>
          <button type="submit" className="it-acct-modal__save-btn" disabled={busy}>
            Save changes
          </button>
        </form>
        <div className="it-acct-modal__divider" />
        <div className="it-acct-modal__access">
          <p className="it-acct-modal__access-label">
            Access status: <strong>{account.active ? "Active" : "Deactivated"}</strong>
          </p>
          <button
            type="button"
            className={"it-acct-modal__access-btn" + (account.active ? "" : " it-acct-modal__access-btn--activate")}
            onClick={() => void handleToggleAccess()}
            disabled={busy}
          >
            {account.active ? "Deactivate access" : "Activate access"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ItAccountsPage() {
  const { showError, showSuccess } = useToast();
  const [items, setItems] = useState<ItAccountDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ItAccountDto | null>(null);
  const [editing, setEditing] = useState<ItAccountDto | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchItAccounts();
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load IT accounts.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(account: ItAccountDto) {
    if (
      !(await swalConfirm({
        title: "Delete IT account?",
        text: `Permanently delete ${account.email}? This cannot be undone.`,
        icon: "warning",
        confirmButtonText: "Delete",
      }))
    )
      return;
    setBusyEmail(account.email);
    try {
      await deleteItAccount(account.email);
      showSuccess("IT account deleted.");
      setItems((prev) => (prev ? prev.filter((a) => a.email !== account.email) : prev));
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusyEmail(null);
    }
  }

  function handleSaved(next: ItAccountDto) {
    setItems((prev) => (prev ? prev.map((a) => (a.email === next.email ? next : a)) : prev));
    setEditing(next);
  }

  return (
    <ManagementDetailShell backModule="admins" title="Manage IT Account" subtitle="View, edit, deactivate, or delete self-service IT accounts.">
      {items == null && !error ? <p className="it-acct-empty">Loading…</p> : null}
      {error ? <p className="it-acct-empty">{error}</p> : null}
      {items && items.length === 0 ? (
        <p className="it-acct-empty">No IT accounts yet — create one from Settings → Admins → Add IT Account.</p>
      ) : null}
      {items && items.length > 0 ? (
        <div className="it-acct-grid">
          {items.map((account) => (
            <ItAccountCard
              key={account.email}
              account={account}
              busy={busyEmail === account.email}
              onView={() => setViewing(account)}
              onEdit={() => setEditing(account)}
              onDelete={() => void handleDelete(account)}
            />
          ))}
        </div>
      ) : null}

      {viewing ? <ViewLogsModal account={viewing} onClose={() => setViewing(null)} /> : null}
      {editing ? <EditAccountModal account={editing} onClose={() => setEditing(null)} onSaved={handleSaved} /> : null}
    </ManagementDetailShell>
  );
}
