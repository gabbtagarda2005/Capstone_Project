const LS_AUDIT_LOG = "command_center_admin_audit_v1";

export type AuditLevel = "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";

export type AdminAuditItem = {
  id: string;
  admin: string;
  action: string;
  createdAt: string;
  level: AuditLevel;
};

function readAudit(): AdminAuditItem[] {
  try {
    const raw = localStorage.getItem(LS_AUDIT_LOG);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AdminAuditItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAudit(items: AdminAuditItem[]) {
  localStorage.setItem(LS_AUDIT_LOG, JSON.stringify(items));
}

export function pushAdminAudit(item: Omit<AdminAuditItem, "id" | "createdAt">) {
  const next: AdminAuditItem = {
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    createdAt: new Date().toISOString(),
    ...item,
  };
  const merged = [next, ...readAudit()].slice(0, 120);
  writeAudit(merged);
}

