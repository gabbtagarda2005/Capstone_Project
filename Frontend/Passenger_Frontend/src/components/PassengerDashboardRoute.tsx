import { PassengerMaintenanceShield } from "@/components/PassengerMaintenanceShield";
import { PassengerDashboardPage } from "@/pages/PassengerDashboardPage";

export function PassengerDashboardRoute() {
  return (
    <PassengerMaintenanceShield>
      <PassengerDashboardPage />
    </PassengerMaintenanceShield>
  );
}
