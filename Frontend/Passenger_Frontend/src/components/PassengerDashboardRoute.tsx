import { Navigate } from "react-router-dom";
import { PassengerMaintenanceShield } from "@/components/PassengerMaintenanceShield";
import { PassengerDashboardPage } from "@/pages/PassengerDashboardPage";
import { isPassengerLocationGateCleared } from "@/lib/passengerLocationGate";

export function PassengerDashboardRoute() {
  if (!isPassengerLocationGateCleared()) {
    return <Navigate to="/enable-location" replace />;
  }
  return (
    <PassengerMaintenanceShield>
      <PassengerDashboardPage />
    </PassengerMaintenanceShield>
  );
}
