import { Link } from "react-router-dom";
import "@/pages/ManagementModulePage.css";

type Props = {
  to: string;
  label: string;
  className?: string;
};

/** Glass chevron + label — same pattern as Management module “Back to management”. */
export function MgmtBackLink({ to, label, className }: Props) {
  return (
    <Link to={to} className={className ? `mgmt-mod__back ${className}` : "mgmt-mod__back"}>
      <span className="mgmt-mod__back-glass" aria-hidden>
        <svg className="mgmt-mod__back-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="mgmt-mod__back-label">{label}</span>
    </Link>
  );
}
