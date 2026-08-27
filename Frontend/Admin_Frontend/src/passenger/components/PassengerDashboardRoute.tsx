import { PassengerMaintenanceShield } from "@/passenger/components/PassengerMaintenanceShield";
import { PassengerDashboardPage } from "@/passenger/pages/PassengerDashboardPage";

export function PassengerDashboardRoute() {
  return (
    <PassengerMaintenanceShield>
      <PassengerDashboardPage />
    </PassengerMaintenanceShield>
  );
}
