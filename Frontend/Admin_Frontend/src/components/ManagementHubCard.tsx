import { Link } from "react-router-dom";
import "./ManagementHubCard.css";

export type ManagementHubCardProps = {
  to: string;
  title: string;
  description: string;
  metricA: string;
  metricB: string;
  metricC: string;
  icon: string;
  /** 0–5 selects gradient palette */
  variant?: number;
  onNavigate?: () => void;
};

export function ManagementHubCard({
  to,
  title,
  description,
  metricA,
  metricB,
  metricC,
  icon,
  variant = 0,
  onNavigate,
}: ManagementHubCardProps) {
  const v = variant % 6;
  return (
    <Link to={to} className="mgmt-uverse-link" onClick={onNavigate}>
      <div className="mgmt-uverse">
        <div className="mgmt-uverse__parent">
          <div className={`mgmt-uverse__card mgmt-uverse__card--${v + 1}`}>
            <div className="mgmt-uverse__icon-badge" aria-hidden>
              {icon}
            </div>
            <div className="mgmt-uverse__content">
              <span className="mgmt-uverse__title">{title}</span>
              <span className="mgmt-uverse__text">{description}</span>
            </div>
            <div className="mgmt-uverse__bottom">
              <div className="mgmt-uverse__metrics">
                <span className="mgmt-uverse__metric mgmt-uverse__metric--a">{metricA}</span>
                <span className="mgmt-uverse__metric">{metricB}</span>
                <span className="mgmt-uverse__metric">{metricC}</span>
              </div>
              <span className="mgmt-uverse__open-label">OPEN</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
