import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AdminAuditTechnicalModal } from "@/components/AdminAuditTechnicalModal";
import { ViewDetailsDl, ViewDetailsRow } from "@/components/ViewDetailsModal";
import { fetchAdminAuditLog } from "@/lib/api";
import { formatRelativeAuditTime, humanizeAdminAuditSentence } from "@/lib/humanizeAdminAudit";
import type { AdminAuditLogRowDto } from "@/lib/types";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";

export function AdminAuditEntryPage() {
  const { logId } = useParams();
  const [row, setRow] = useState<AdminAuditLogRowDto | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [techOpen, setTechOpen] = useState(false);

  useEffect(() => {
    if (!logId) {
      setRow(null);
      setErr("Missing log id.");
      return;
    }
    let cancelled = false;
    setErr(null);
    (async () => {
      try {
        const { items } = await fetchAdminAuditLog(500);
        const found = items.find((x) => x.id === logId) ?? null;
        if (!cancelled) {
          setRow(found);
          if (!found) setErr("This entry is not in the recent audit window. Return to Admin management and refresh the list.");
        }
      } catch (e) {
        if (!cancelled) {
          setRow(null);
          setErr(e instanceof Error ? e.message : "Could not load audit log.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logId]);

  if (row === undefined) {
    return (
      <ManagementDetailShell backModule="admins" title="Audit entry" subtitle="Loading…">
        <p className="mgmt-mod__unknown">Loading…</p>
      </ManagementDetailShell>
    );
  }

  if (err || !row) {
    return (
      <ManagementDetailShell backModule="admins" title="Audit entry" subtitle="System activity">
        <p className="mgmt-mod__unknown">{err ?? "Not found."}</p>
      </ManagementDetailShell>
    );
  }

  const abs = new Date(row.timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <ManagementDetailShell backModule="admins" title="Audit entry" subtitle={row.module}>
      <ViewDetailsDl>
        <ViewDetailsRow label="Summary" value={humanizeAdminAuditSentence(row)} />
        <ViewDetailsRow label="Admin" value={row.email} />
        <ViewDetailsRow label="When" value={`${formatRelativeAuditTime(row.timestamp)} — ${abs}`} />
        <ViewDetailsRow label="Action" value={row.action} />
        <ViewDetailsRow label="Module" value={row.module} />
        {row.source ? <ViewDetailsRow label="Source" value={row.source} /> : null}
        <ViewDetailsRow
          label="Technical details"
          value={
            <button type="button" className="view-details-modal__done" onClick={() => setTechOpen(true)}>
              View raw request
            </button>
          }
        />
        <ViewDetailsRow label="Entry ID" value={<span className="view-details-row__value--mono">{row.id}</span>} />
      </ViewDetailsDl>
      <AdminAuditTechnicalModal open={techOpen} onClose={() => setTechOpen(false)} row={row} />
    </ManagementDetailShell>
  );
}
