import { useEffect } from "react";
import "./ViewDetailsModal.css";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function ViewDetailsModal({ open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="view-details-modal__backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="view-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-details-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="view-details-modal__header">
          <h2 id="view-details-modal-title" className="view-details-modal__title">
            {title}
          </h2>
          <button type="button" className="view-details-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="view-details-modal__body">{children}</div>
        <footer className="view-details-modal__footer">
          <button type="button" className="view-details-modal__done" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ViewDetailsDl({ children }: { children: React.ReactNode }) {
  return <dl className="view-details-dl">{children}</dl>;
}

export function ViewDetailsRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="view-details-row__label">{label}</dt>
      <dd className="view-details-row__value">{value}</dd>
    </>
  );
}
