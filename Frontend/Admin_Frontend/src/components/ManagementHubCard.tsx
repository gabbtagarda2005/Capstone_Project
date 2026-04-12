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
  onNavigate?: () => void;
};

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="mgmt-bento-card__check-svg" aria-hidden>
      <path
        fillRule="evenodd"
        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ManagementHubCard({
  to,
  title,
  description,
  metricA,
  metricB,
  metricC,
  icon,
  onNavigate,
}: ManagementHubCardProps) {
  const isBusFleetEmpty = title.toLowerCase().includes("bus management") && metricA === "0";
  const line1 = `${metricA} ${metricB}`.trim();
  const line2 = isBusFleetEmpty ? "Awaiting Data" : metricC;

  const listItems = [line1, line2, "Secure workspace · role-based access"];

  return (
    <Link to={to} className="mgmt-bento-card-link" onClick={onNavigate}>
      <div className="mgmt-bento-card">
        <div className="mgmt-bento-card__border" aria-hidden>
          <div className="mgmt-bento-card__border-sweep" />
        </div>

        <div className="mgmt-bento-card__card">
          <div className="mgmt-bento-card__icon" aria-hidden>
            {icon}
          </div>

          <div className="mgmt-bento-card__title-block">
            <span className="mgmt-bento-card__card-title">{title}</span>
            <p className="mgmt-bento-card__card-paragraph">{description}</p>
          </div>

          <hr className="mgmt-bento-card__line" />

          <ul className="mgmt-bento-card__list">
            {listItems.map((text, idx) => (
              <li className="mgmt-bento-card__list-item" key={`${title}-${idx}`}>
                <span className="mgmt-bento-card__check">
                  <CheckIcon />
                </span>
                <span className="mgmt-bento-card__list-text">{text}</span>
              </li>
            ))}
          </ul>

          <span className="mgmt-bento-card__cta">OPEN</span>
        </div>
      </div>
    </Link>
  );
}
