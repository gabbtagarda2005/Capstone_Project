import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminAuditTechnicalModal } from "@/components/AdminAuditTechnicalModal";
import { fetchAdminAuditLog } from "@/lib/api";
import {
  auditTimelineEmoji,
  formatRelativeAuditTime,
  humanizeAdminAuditSentence,
} from "@/lib/humanizeAdminAudit";
import type { AdminAuditLogRowDto } from "@/lib/types";
import "./AdminAuditLogPanel.css";

function emojiToneClass(row: AdminAuditLogRowDto): string {
  const path = (row.path || "").toLowerCase();
  const detailsLow = row.details.toLowerCase();
  if (path.includes("test-gps") || path.includes("hardware-telemetry") || path.includes("live-location")) {
    return "admin-audit-panel__emoji-wrap--gps";
  }
  if (detailsLow.includes("test-gps") || detailsLow.includes("hardware-telemetry")) {
    return "admin-audit-panel__emoji-wrap--gps";
  }
  const a = row.action.toUpperCase();
  if (a === "DELETE") return "admin-audit-panel__emoji-wrap--delete";
  if (a === "EDIT") return "admin-audit-panel__emoji-wrap--edit";
  if (a === "BROADCAST") return "admin-audit-panel__emoji-wrap--broadcast";
  if (a === "ADD") return "admin-audit-panel__emoji-wrap--add";
  if (a === "LOGIN") return "admin-audit-panel__emoji-wrap--login";
  return "admin-audit-panel__emoji-wrap--view";
}

export function AdminAuditLogPanel() {
  const [logs, setLogs] = useState<AdminAuditLogRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [techRow, setTechRow] = useState<AdminAuditLogRowDto | null>(null);

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
        <div className="admin-audit-panel__list admin-audit-panel__list--timeline">
          {logs.map((log) => {
            const abs = new Date(log.timestamp).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              <div key={log.id} className="admin-audit-panel__row admin-audit-panel__row--timeline">
                <div className={`admin-audit-panel__emoji-wrap ${emojiToneClass(log)}`} aria-hidden>
                  <span className="admin-audit-panel__emoji">{auditTimelineEmoji(log)}</span>
                </div>
                <div className="admin-audit-panel__body">
                  <div className="admin-audit-panel__head">
                    <span className="admin-audit-panel__email">{log.email}</span>
                    <time className="admin-audit-panel__time" dateTime={log.timestamp} title={abs}>
                      {formatRelativeAuditTime(log.timestamp)}
                    </time>
                  </div>
                  <p className="admin-audit-panel__sentence">{humanizeAdminAuditSentence(log)}</p>
                  <p className="admin-audit-panel__module-line">
                    <span className="admin-audit-panel__module">{log.module}</span>
                  </p>
                </div>
                <div className="admin-audit-panel__actions">
                  <button
                    type="button"
                    className="admin-audit-panel__info"
                    aria-label="Show technical details"
                    onClick={() => setTechRow(log)}
                  >
                    ⓘ
                  </button>
                  <Link
                    to={`/dashboard/management/admins/audit/${encodeURIComponent(log.id)}`}
                    className="admin-audit-panel__detail-link"
                  >
                    Open
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <AdminAuditTechnicalModal open={techRow != null} onClose={() => setTechRow(null)} row={techRow} />
    </div>
  );
}
