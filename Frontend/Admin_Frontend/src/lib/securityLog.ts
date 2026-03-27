import { api } from "@/lib/api";

export type SecurityLogPayload = {
  type?: string;
  busId: string;
  message: string;
  severity?: string;
  latitude?: number;
  longitude?: number;
  assignedRoute?: string;
  currentTerminal?: string;
  source?: string;
};

/** Persists geofence and other security events to MongoDB `security_logs` (requires admin JWT). */
export function postSecurityLog(payload: SecurityLogPayload): void {
  void api<{ ok: boolean; id: string }>("/api/security/logs", { method: "POST", json: payload }).catch(() => {
    /* offline or 401 — UI still shows local alerts */
  });
}
