import type { AdminAuditLogRowDto } from "@/lib/types";
import "./AdminAuditTechnicalModal.css";

type Props = {
  open: boolean;
  onClose: () => void;
  row: AdminAuditLogRowDto | null;
};

export function AdminAuditTechnicalModal({ open, onClose, row }: Props) {
  if (!open || !row) return null;

  return (
    <div className="admin-audit-tech" role="dialog" aria-modal="true" aria-labelledby="admin-audit-tech-title">
      <button type="button" className="admin-audit-tech__backdrop" aria-label="Close" onClick={onClose} />
      <div className="admin-audit-tech__card">
        <div className="admin-audit-tech__head">
          <h2 id="admin-audit-tech-title" className="admin-audit-tech__title">
            Technical details
          </h2>
          <button type="button" className="admin-audit-tech__close" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="admin-audit-tech__hint">
          Raw request line and payload (coordinates, IDs) for support or auditing. Staff-friendly summary stays on the main list.
        </p>
        <pre className="admin-audit-tech__pre" tabIndex={0}>
          {row.details}
        </pre>
        <dl className="admin-audit-tech__meta">
          {row.httpMethod ? (
            <>
              <dt>Method</dt>
              <dd>{row.httpMethod}</dd>
            </>
          ) : null}
          {row.path ? (
            <>
              <dt>Path</dt>
              <dd className="admin-audit-tech__mono">{row.path}</dd>
            </>
          ) : null}
          {row.statusCode != null ? (
            <>
              <dt>HTTP</dt>
              <dd>{row.statusCode}</dd>
            </>
          ) : null}
          <dt>Module</dt>
          <dd>{row.module}</dd>
        </dl>
      </div>
    </div>
  );
}
