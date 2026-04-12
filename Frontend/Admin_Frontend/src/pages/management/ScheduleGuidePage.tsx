import { AirportOperationsBoard } from "@/components/AirportOperationsBoard";
import { ManagementDetailShell } from "@/pages/management/ManagementDetailShell";

export function ScheduleGuidePage() {
  return (
    <ManagementDetailShell backModule="schedules" title="Live fleet departures">
      <AirportOperationsBoard />
    </ManagementDetailShell>
  );
}
