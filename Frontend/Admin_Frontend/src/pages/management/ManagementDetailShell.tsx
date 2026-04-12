import { Link } from "react-router-dom";
import "@/pages/ManagementModulePage.css";

type Props = {
  backModule: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function ManagementDetailShell({ backModule, title, subtitle, children }: Props) {
  return (
    <div className="admin-mgmt">
      <div className="mgmt-mod mgmt-mod--wide">
        <Link to={`/dashboard/management/${backModule}`} className="mgmt-mod__back">
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
          <span className="mgmt-mod__back-label">Back to {backModule}</span>
        </Link>
        <header className="mgmt-mod__head">
          <h1 className="mgmt-mod__title">{title}</h1>
          {subtitle ? <p className="mgmt-mod__sub">{subtitle}</p> : null}
        </header>
        <div className="mgmt-resource-detail">{children}</div>
      </div>
    </div>
  );
}
