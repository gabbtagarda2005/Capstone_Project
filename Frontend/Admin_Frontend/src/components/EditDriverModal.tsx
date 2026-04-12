import { useEffect, useState, type FormEvent } from "react";
import type { DriverSummary } from "@/lib/types";
import "./EditAttendantModal.css";

type Props = {
  driver: DriverSummary | null;
  onClose: () => void;
  onSave: (payload: {
    firstName: string;
    lastName: string;
    middleName: string;
    email: string;
    phone: string;
    licenseNumber: string;
    yearsExperience: number | null;
  }) => Promise<void>;
};

export function EditDriverModal({ driver, onClose, onSave }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [yearsExperience, setYearsExperience] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!driver) return;
    setFirstName(driver.firstName);
    setLastName(driver.lastName);
    setMiddleName(driver.middleName ?? "");
    setEmail(driver.email ?? "");
    setPhone(driver.phone ?? "");
    setLicenseNumber(driver.licenseNumber ?? "");
    setYearsExperience(driver.yearsExperience != null ? String(driver.yearsExperience) : "");
  }, [driver]);

  if (!driver) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const yRaw = yearsExperience.trim();
    const yNum = yRaw === "" ? null : Number(yRaw);
    setSaving(true);
    try {
      await onSave({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        licenseNumber: licenseNumber.trim(),
        yearsExperience: yNum != null && Number.isFinite(yNum) && yNum >= 0 ? Math.floor(yNum) : null,
      });
      onClose();
    } catch {
      /* Parent toast */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="edit-att-modal__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="edit-att-modal"
        role="dialog"
        aria-labelledby="edit-drv-modal-title"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <h2 id="edit-drv-modal-title" className="edit-att-modal__title">
          Edit driver
        </h2>
        <p className="edit-att-modal__email">ID {driver.driverId}</p>
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
            <span className="edit-att-modal__label">Email</span>
            <input className="edit-att-modal__input" value={email} onChange={(ev) => setEmail(ev.target.value)} type="email" />
          </label>
          <label className="edit-att-modal__field">
            <span className="edit-att-modal__label">Phone</span>
            <input className="edit-att-modal__input" value={phone} onChange={(ev) => setPhone(ev.target.value)} inputMode="tel" />
          </label>
          <label className="edit-att-modal__field">
            <span className="edit-att-modal__label">License number</span>
            <input className="edit-att-modal__input" value={licenseNumber} onChange={(ev) => setLicenseNumber(ev.target.value)} />
          </label>
          <label className="edit-att-modal__field">
            <span className="edit-att-modal__label">Years experience</span>
            <input
              className="edit-att-modal__input"
              value={yearsExperience}
              onChange={(ev) => setYearsExperience(ev.target.value)}
              inputMode="numeric"
              min={0}
            />
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
