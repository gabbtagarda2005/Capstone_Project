import { Link } from "react-router-dom";
import { CommandCenterBackToHubLink } from "@/components/CommandCenterBackToHubLink";
import {
  COMMAND_CENTER_BROADCAST,
  COMMAND_CENTER_MAINTENANCE,
  COMMAND_CENTER_SYSTEM_FEEDBACK,
} from "@/pages/commandCenterPaths";

export type CommandCenterSubNavPage = "feedback" | "broadcast" | "maintenance";

export function CommandCenterSubNav({ page }: { page: CommandCenterSubNavPage }) {
  return (
    <nav className="command-center__sub-nav command-center__sub-nav--topbar" aria-label="Command center sections">
      <div className="command-center__sub-nav__hub">
        <CommandCenterBackToHubLink />
      </div>
      <span className="command-center__sub-nav-sep command-center__sub-nav-sep--topbar" aria-hidden>
        ·
      </span>
      <ul className="command-center__sub-nav__list command-center__sub-nav__list--topbar">
        <li>
          {page === "feedback" ? (
            <span className="command-center__crumb-current command-center__crumb-current--topbar" aria-current="page">
              Feedback
            </span>
          ) : (
            <Link to={COMMAND_CENTER_SYSTEM_FEEDBACK} className="command-center__sub-link command-center__sub-link--topbar">
              Feedback
            </Link>
          )}
        </li>
        <li>
          {page === "broadcast" ? (
            <span className="command-center__crumb-current command-center__crumb-current--topbar" aria-current="page">
              Broadcast
            </span>
          ) : (
            <Link to={COMMAND_CENTER_BROADCAST} className="command-center__sub-link command-center__sub-link--topbar">
              Broadcast
            </Link>
          )}
        </li>
        <li>
          {page === "maintenance" ? (
            <span className="command-center__crumb-current command-center__crumb-current--topbar" aria-current="page">
              Maintenance
            </span>
          ) : (
            <Link to={COMMAND_CENTER_MAINTENANCE} className="command-center__sub-link command-center__sub-link--topbar">
              Maintenance
            </Link>
          )}
        </li>
      </ul>
    </nav>
  );
}
