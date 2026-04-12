import { Link } from "react-router-dom";
import type { OperatorSummary } from "@/lib/types";

type Props = {
  op: OperatorSummary;
  accountStatus?: "Active" | "Offline";
  onEdit: (op: OperatorSummary) => void;
  onDelete: (id: number) => void;
};

function fullName(o: OperatorSummary) {
  return [o.firstName, o.middleName, o.lastName].filter(Boolean).join(" ");
}

export function OperatorCard({ op, accountStatus = "Offline", onEdit, onDelete }: Props) {
  return (
    <article className="dg-op-card">
      <div className="dg-op-card__name">{fullName(op)}</div>
      <div className="dg-op-card__email">{op.email}</div>
      <div className="dg-op-card__id">
        <span className="dg-op-card__id-label">Personnel</span>{" "}
        <span className="dg-op-card__id-value">{op.employeeId ?? "—"}</span>
        <span className="dg-op-card__id-label" style={{ marginLeft: "0.65rem" }}>
          Sys
        </span>{" "}
        <span className="dg-op-card__id-value">{op.operatorId}</span>
      </div>
      <div className="dg-op-card__status-row">
        <span className="dg-op-card__id-label">Account Status</span>
        <span className={"dg-op-card__status " + (accountStatus === "Active" ? "dg-op-card__status--on" : "dg-op-card__status--off")}>
          {accountStatus}
        </span>
      </div>
      <div className="dg-op-card__actions">
        <Link to={`/dashboard/operators/${op.operatorId}`} className="dg-link-btn">
          View
        </Link>
        <button type="button" className="dg-op-btn" onClick={() => onEdit(op)}>
          Edit
        </button>
        <button type="button" className="dg-op-btn dg-op-btn--danger" onClick={() => onDelete(op.operatorId)}>
          Delete
        </button>
      </div>
    </article>
  );
}
