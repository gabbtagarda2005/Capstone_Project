import { useEffect, useState, type FormEvent } from "react";
import { compactOptionLabel } from "@/lib/selectLabel";
import type { AttendantVerifiedSummary, DriverSummary } from "@/lib/types";
import "./AddBusModal.css";

export const BUS_ROUTE_OPTIONS = [
  "Malaybalay ↔ Valencia",
  "Valencia ↔ Maramag",
  "Maramag ↔ Don Carlos",
  "Malaybalay ↔ Maramag",
  "Valencia ↔ Don Carlos",
] as const;

export type AddBusFormState = {
  busNumber: string;
  imei: string;
  operatorId: string;
  driverId: string;
  route: string;
  strictPickup: boolean;
};

function IconStaff() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4ZM8 12a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 13c-3.314 0-6 2.015-6 4.5V20h12v-2.5c0-2.485-2.686-4.5-6-4.5ZM8 14c-2.761 0-5 1.567-5 3.5V20h5v-2.5c0-1.258.57-2.396 1.51-3.286A6.43 6.43 0 0 0 8 14Z" fill="currentColor" />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path d="M6 18h2.5l6-12H12L6 18Zm9.5-2H18v2h-2.5v-2Zm1.25-8a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" fill="currentColor" />
    </svg>
  );
}

const emptyForm = (): AddBusFormState => ({
  busNumber: "",
  imei: "",
  operatorId: "",
  driverId: "",
  route: "",
  strictPickup: true,
});

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: AddBusFormState) => Promise<void>;
  operators: AttendantVerifiedSummary[];
  drivers: DriverSummary[];
  saving: boolean;
};

function normalizeBusNumberInput(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!t) return "";
  if (/^BUK-/i.test(t)) return t;
  if (/^\d+$/.test(t)) return `BUK-${t}`;
  return t;
}

export function AddBusModal({ isOpen, onClose, onSave, operators, drivers, saving }: Props) {
  const [form, setForm] = useState<AddBusFormState>(emptyForm);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm());
      setLocalError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const imeiDigits = form.imei.replace(/\D/g, "");
  const imeiOk = imeiDigits.length === 15;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const busNumber = normalizeBusNumberInput(form.busNumber);
    if (!busNumber) {
      setLocalError("Enter a bus number (e.g. BUK-101 or 101).");
      return;
    }
    if (!imeiOk) {
      setLocalError("IMEI must be exactly 15 digits.");
      return;
    }
    if (!form.operatorId) {
      setLocalError("Select a bus attendant.");
      return;
    }
    if (!form.driverId) {
      setLocalError("Select a driver.");
      return;
    }
    if (!form.route) {
      setLocalError("Select a route.");
      return;
    }
    try {
      await onSave({
        busNumber,
        imei: imeiDigits,
        operatorId: form.operatorId,
        driverId: form.driverId,
        route: form.route,
        strictPickup: form.strictPickup,
      });
    } catch {
      /* parent toast */
    }
  }

  return (
    <div className="add-bus-modal__backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="add-bus-modal"
        role="dialog"
        aria-labelledby="add-bus-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="add-bus-modal__glow" aria-hidden />
        <h2 id="add-bus-modal-title" className="add-bus-modal__title">
          Register new bus
        </h2>
        <p className="add-bus-modal__sub">Assign OTP-verified attendant and verified driver, then choose route.</p>

        <form className="add-bus-modal__form" onSubmit={handleSubmit}>
          <div className="add-bus-modal__grid2">
            <label className="add-bus-modal__field">
              <span className="add-bus-modal__label">Bus number</span>
              <input
                className="add-bus-modal__input"
                placeholder="e.g. BUK-101 or 101"
                value={form.busNumber}
                onChange={(e) => setForm((f) => ({ ...f, busNumber: e.target.value }))}
                autoComplete="off"
              />
            </label>
            <label className="add-bus-modal__field">
              <span className="add-bus-modal__label add-bus-modal__label--row">
                GPS IMEI (15 digits)
                <span className={`add-bus-modal__imei-hint ${imeiOk ? "add-bus-modal__imei-hint--ok" : ""}`}>
                  {imeiDigits.length}/15
                </span>
              </span>
              <input
                className="add-bus-modal__input add-bus-modal__input--mono"
                placeholder="15-digit device IMEI"
                inputMode="numeric"
                maxLength={32}
                value={form.imei}
                onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))}
                autoComplete="off"
              />
            </label>
          </div>

          <label className="add-bus-modal__field">
            <span className="add-bus-modal__label">Verified bus attendant</span>
            <div className="add-bus-modal__select-wrap">
              <span className="add-bus-modal__select-icon" aria-hidden><IconStaff /></span>
              <select
                className="add-bus-modal__select"
                value={form.operatorId}
                onChange={(e) => setForm((f) => ({ ...f, operatorId: e.target.value }))}
              >
                <option value="">
                  {operators.length === 0 ? "No verified attendants (complete OTP wizard)" : "Select verified attendant…"}
                </option>
                {operators.map((o) => {
                  const full = `${o.lastName}, ${o.firstName} · ${o.email} · ID ${o.operatorId}`;
                  return (
                    <option key={o.operatorId} value={o.operatorId} title={full}>
                      {compactOptionLabel(full, 20)}
                    </option>
                  );
                })}
              </select>
            </div>
          </label>

          <label className="add-bus-modal__field">
            <span className="add-bus-modal__label">Verified driver</span>
            <div className="add-bus-modal__select-wrap">
              <span className="add-bus-modal__select-icon" aria-hidden><IconStaff /></span>
              <select
                className="add-bus-modal__select"
                value={form.driverId}
                onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}
              >
                <option value="">
                  {drivers.length === 0 ? "No verified drivers (complete driver OTP wizard)" : "Select verified driver…"}
                </option>
                {drivers.map((d) => {
                  const full = `${`${d.lastName}, ${d.firstName}`.trim()}${d.licenseNumber ? ` · ${d.licenseNumber}` : ` · ${d.driverId}`}`;
                  return (
                    <option key={d.id} value={d.id} title={full}>
                      {compactOptionLabel(full, 20)}
                    </option>
                  );
                })}
              </select>
            </div>
          </label>

          <label className="add-bus-modal__field">
            <span className="add-bus-modal__label">Route</span>
            <div className="add-bus-modal__select-wrap">
              <span className="add-bus-modal__select-icon" aria-hidden><IconRoute /></span>
              <select
                className="add-bus-modal__select"
                value={form.route}
                onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))}
              >
                <option value="">Select route corridor</option>
                {BUS_ROUTE_OPTIONS.map((r) => (
                  <option key={r} value={r} title={r}>
                    {compactOptionLabel(r, 20)}
                  </option>
                ))}
              </select>
            </div>
          </label>

          {localError ? <p className="add-bus-modal__error">{localError}</p> : null}

          <div className="add-bus-modal__actions">
            <button type="button" className="add-bus-modal__btn add-bus-modal__btn--ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="add-bus-modal__btn add-bus-modal__btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
