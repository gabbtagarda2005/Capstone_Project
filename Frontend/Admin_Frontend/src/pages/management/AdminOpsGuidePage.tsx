import { Link } from "react-router-dom";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";

export function AdminOpsGuidePage() {
  return (
    <ManagementDetailShell
      backModule="admins"
      title="Admin management"
      subtitle="Portal access · audit trail · policies"
    >
      <div className="mgmt-resource-detail__prose">
        <p>
          Whitelisted administrators appear in the live audit log when they perform API actions. Use{" "}
          <Link to="/dashboard/settings" className="mgmt-resource-detail__inline-link">
            Settings
          </Link>{" "}
          for account preferences and role context.
        </p>
        <p className="mgmt-resource-detail__muted">Open any row in the audit list for a dedicated activity detail page.</p>
      </div>
    </ManagementDetailShell>
  );
}
