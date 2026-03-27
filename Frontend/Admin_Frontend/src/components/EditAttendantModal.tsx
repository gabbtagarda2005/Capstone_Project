import { useEffect, useState, type FormEvent } from "react";
import type { AttendantVerifiedSummary } from "@/lib/types";
import "./EditAttendantModal.css";

type Props = {
  attendant: AttendantVerifiedSummary | null;
  onClose: () => void;
  onSave: (payload: { firstName: string; lastName: string; middleName: string; phone: string }) => Promise<void>;
};

export function EditAttendantModal({ attendant, onClose, onSave }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!attendant) return;
    setFirstName(attendant.firstName);
    setLastName(attendant.lastName);
    setMiddleName(attendant.middleName ?? "");
    setPhone(attendant.phone ?? "");
  }, [attendant]);

  if (!attendant) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim(),
        phone: phone.trim(),
      });
      onClose();
    } catch {
      /* Parent shows toast */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="edit-att-modal__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="edit-att-modal"
        role="dialog"
        aria-labelledby="edit-att-modal-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <h2 id="edit-att-modal-title" className="edit-att-modal__title">
          Edit attendant
        </h2>
        <p className="edit-att-modal__email">{attendant.email}</p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="edit-att-modal__field">
            <span className="edit-att-modal__label">First name</span>
            <input className="edit-att-modal__input" value={firstName} onChange={(ev) => setFirstName(ev.target.value)} required />
          </label>
          <label className="edit-att-modal__field">
            <span className="edit-att-modal__label">Last name</span>
            <input className="edit-att-modal__input" value={lastName} onChange={(ev) => setLastName(ev.target.value)} required />
          </label>
          <label className="edit-att-modal__field">
            <span className="edit-att-modal__label">Middle name</span>
            <input className="edit-att-modal__input" value={middleName} onChange={(ev) => setMiddleName(ev.target.value)} />
          </label>
          <label className="edit-att-modal__field">
            <span className="edit-att-modal__label">Phone</span>
            <input className="edit-att-modal__input" value={phone} onChange={(ev) => setPhone(ev.target.value)} inputMode="tel" />
          </label>
          <div className="edit-att-modal__actions">
            <button type="button" className="edit-att-modal__btn edit-att-modal__btn--ghost" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="edit-att-modal__btn edit-att-modal__btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
