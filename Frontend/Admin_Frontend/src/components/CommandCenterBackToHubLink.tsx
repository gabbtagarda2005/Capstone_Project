import { MgmtBackLink } from "@/components/MgmtBackLink";
import { COMMAND_CENTER_HUB } from "@/pages/commandCenterPaths";

/** Same glass + chevron pattern as Management module “Back to management”. */
export function CommandCenterBackToHubLink() {
  return <MgmtBackLink to={COMMAND_CENTER_HUB} label="Command center" />;
}
