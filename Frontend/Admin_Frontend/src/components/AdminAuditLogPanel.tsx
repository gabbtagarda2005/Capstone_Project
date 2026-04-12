import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAdminAuditLog } from "@/lib/api";
import type { AdminAuditLogRowDto } from "@/lib/types";
import "./AdminAuditLogPanel.css";

function iconClass(action: string): string {
  const a = action.toUpperCase();
  if (a === "DELETE") return "admin-audit-panel__icon--delete";
  if (a === "EDIT") return "admin-audit-panel__icon--edit";
  if (a === "BROADCAST") return "admin-audit-panel__icon--broadcast";
  if (a === "ADD") return "admin-audit-panel__icon--add";
  return "admin-audit-panel__icon--view";
}

function badgeClass(action: string): string {
  const a = action.toUpperCase();
  if (a === "DELETE") return "admin-audit-panel__badge--delete";
  if (a === "EDIT") return "admin-audit-panel__badge--edit";
  if (a === "BROADCAST") return "admin-audit-panel__badge--broadcast";
  if (a === "ADD") return "admin-audit-panel__badge--add";
  return "admin-audit-panel__badge--view";
}

function ActionIcon({ action }: { action: string }) {
  const a = action.toUpperCase();
  if (a === "DELETE") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
      </svg>
    );
  }
  if (a === "EDIT") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
      </svg>
    );
  }
  if (a === "BROADCAST") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
  );
}

export function AdminAuditLogPanel() {
  const [logs, setLogs] = useState<AdminAuditLogRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchAdminAuditLog(100);
      setLogs(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load audit log");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="admin-audit-panel__empty">Loading audit log…</p>;
  }
  if (error) {
    return (
      <p className="admin-audit-panel__err">
        {error}{" "}
        <button type="button" className="route-mgmt-panel__delete" onClick={() => void load()}>
          Retry
        </button>
      </p>
    );
  }

  return (
    <div className="admin-audit-panel">
      <h3 className="admin-audit-panel__title">Live system activity</h3>
      {logs.length === 0 ? (
        <p className="admin-audit-panel__empty">No audit entries yet. API actions by whitelisted admins appear here.</p>
      ) : (
        <div className="admin-audit-panel__list">
          {logs.map((log) => (
            <Link
              key={log.id}
              to={`/dashboard/management/admins/audit/${encodeURIComponent(log.id)}`}
              className="admin-audit-panel__row admin-audit-panel__row--link"
            >
              <div className={`admin-audit-panel__icon ${iconClass(log.action)}`}>
                <ActionIcon action={log.action} />
              </div>
              <div className="admin-audit-panel__body">
                <div className="admin-audit-panel__head">
                  <span className="admin-audit-panel__email">{log.email}</span>
                  <span className="admin-audit-panel__time">
                    {new Date(log.timestamp).toLocaleString(undefined, {
                      month: "2-digit",
                      day: "2-digit",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <p className="admin-audit-panel__detail">
                  <span className={`admin-audit-panel__badge ${badgeClass(log.action)}`}>{log.action}</span>
                  {log.details} in <span className="admin-audit-panel__module">{log.module}</span>
                  {log.statusCode != null ? (
                    <span className="admin-audit-panel__time"> · HTTP {log.statusCode}</span>
                  ) : null}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
