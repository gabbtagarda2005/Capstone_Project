import { MgmtBackLink } from "@/components/MgmtBackLink";
import { NetworkPulseCard } from "@/components/NetworkPulseCard";
import { SystemEventsPanel } from "@/components/SystemEventsPanel";
import { ApiHealthTable } from "@/components/ApiHealthTable";
import { COMMAND_CENTER_HUB } from "@/pages/commandCenterPaths";
import "./CommandCenterFleetSensorsPage.css";

export function CommandCenterFleetSensorsPage() {
  return (
    <div className="fleet-sensors">
      <header className="fleet-sensors__hero">
        <MgmtBackLink to={COMMAND_CENTER_HUB} label="Command center" className="fleet-sensors__mgmt-back" />
        <h1>SYSTEM HEALTH</h1>
        <p>Live status for the admin API, database, and integrations.</p>
      </header>

      <div className="fleet-sensors__pulse">
        <NetworkPulseCard />
        <SystemEventsPanel />
        <ApiHealthTable />
      </div>
    </div>
  );
}
