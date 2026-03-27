export const GEOFENCE_BREACH_EVENT = "admin-geofence-breach";

export type GeofenceBreachDetail = {
  breachId: string;
  busId: string;
  latitude: number;
  longitude: number;
  assignedRoute: string;
  currentTerminal: string;
};
