const LS_GEOFENCE_ALERTS = "ops_geofence_alerts_v1";

export type GeofenceAlert = {
  id: string;
  busId: string;
  assignedRoute: string;
  currentTerminal: string;
  createdAt: string;
  severity: "warning" | "critical";
};

function readAlerts(): GeofenceAlert[] {
  try {
    const raw = localStorage.getItem(LS_GEOFENCE_ALERTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GeofenceAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAlerts(next: GeofenceAlert[]) {
  localStorage.setItem(LS_GEOFENCE_ALERTS, JSON.stringify(next.slice(0, 120)));
}

export function getGeofenceAlerts(): GeofenceAlert[] {
  return readAlerts();
}

export function pushGeofenceAlert(alert: Omit<GeofenceAlert, "id" | "createdAt">) {
  const nextItem: GeofenceAlert = {
    id: `${alert.busId}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...alert,
  };
  const cur = readAlerts();
  const dup = cur.find(
    (x) =>
      x.busId === nextItem.busId &&
      x.assignedRoute === nextItem.assignedRoute &&
      x.currentTerminal === nextItem.currentTerminal &&
      Date.now() - new Date(x.createdAt).getTime() < 60_000
  );
  if (dup) return;
  writeAlerts([nextItem, ...cur]);
}
