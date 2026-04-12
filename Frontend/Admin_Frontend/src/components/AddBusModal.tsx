import { useEffect, useState, type FormEvent } from "react";
import { compactOptionLabel } from "@/lib/selectLabel";
import type { AttendantVerifiedSummary, BusRow, CorridorRouteRow, DriverSummary } from "@/lib/types";
import "./AddBusModal.css";

function routeOptionLabel(r: CorridorRouteRow): string {
  const n = (r.displayName || "").trim();
  if (n) return n;
  return `${r.originLabel} ↔ ${r.destLabel}`;
}

export type AddBusFormState = {
  busNumber: string;
  imei: string;
  plateNumber: string;
  seatCapacity: number;
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
  plateNumber: "",
  seatCapacity: 50,
  operatorId: "",
  driverId: "",
  route: "",
  strictPickup: false,
});

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: AddBusFormState) => Promise<void>;
  /** When set, modal edits attendant / driver / route only (PATCH). */
  busToEdit?: BusRow | null;
  onUpdateAssignments?: (
    busId: string,
    data: Pick<AddBusFormState, "operatorId" | "driverId" | "route" | "plateNumber" | "seatCapacity">
  ) => Promise<void>;
  operators: AttendantVerifiedSummary[];
  drivers: DriverSummary[];
  /** Corridors from Route management (GET /api/corridor-routes/). */
  corridorRoutes: CorridorRouteRow[];
  saving: boolean;
};

function normalizeBusNumberInput(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!t) return "";
  if (/^BUK-/i.test(t)) return t;
  if (/^\d+$/.test(t)) return `BUK-${t}`;
  return t;
}

export function AddBusModal({
  isOpen,
  onClose,
  onSave,
  busToEdit,
  onUpdateAssignments,
  operators,
  drivers,
  corridorRoutes,
  saving,
}: Props) {
  const [form, setForm] = useState<AddBusFormState>(emptyForm);
  const [localError, setLocalError] = useState<string | null>(null);
  const editing = Boolean(busToEdit);

  useEffect(() => {
    if (!isOpen) return;
    setLocalError(null);
    if (busToEdit) {
      const plate = busToEdit.plateNumber?.trim() || "";
      setForm({
        busNumber: busToEdit.busNumber,
        imei: busToEdit.imei?.replace(/\D/g, "") ?? "",
        plateNumber: plate === "—" ? "" : plate,
        seatCapacity:
          typeof busToEdit.seatCapacity === "number" && busToEdit.seatCapacity > 0 ? busToEdit.seatCapacity : 50,
        operatorId: busToEdit.operatorId ?? "",
        driverId: busToEdit.driverId ?? "",
        route: busToEdit.route ?? "",
        strictPickup: busToEdit.strictPickup === true,
      });
    } else {
      setForm(emptyForm());
    }
  }, [isOpen, busToEdit]);

  if (!isOpen) return null;

  const imeiDigits = form.imei.replace(/\D/g, "");
  const imeiOk = imeiDigits.length === 15;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (editing && busToEdit && onUpdateAssignments) {
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
      const seats = Math.round(Number(form.seatCapacity));
      if (!Number.isFinite(seats) || seats < 1 || seats > 300) {
        setLocalError("Seat capacity must be between 1 and 300.");
        return;
      }
      try {
        await onUpdateAssignments(busToEdit.id, {
          operatorId: form.operatorId,
          driverId: form.driverId,
          route: form.route,
          plateNumber: form.plateNumber.trim(),
          seatCapacity: seats,
        });
      } catch {
        /* parent toast */
      }
      return;
    }

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
    const seats = Math.round(Number(form.seatCapacity));
    if (!Number.isFinite(seats) || seats < 1 || seats > 300) {
      setLocalError("Seat capacity must be between 1 and 300.");
      return;
    }
    try {
      await onSave({
        busNumber,
        imei: imeiDigits,
        plateNumber: form.plateNumber.trim(),
        seatCapacity: seats,
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
          {editing ? "Update bus assignments" : "Register new bus"}
        </h2>
        <p className="add-bus-modal__sub">
          {editing
            ? "Change verified attendant, driver, or route. Bus number and IMEI stay the same."
            : "Set plate and seat capacity, assign OTP-verified attendant and driver, then choose route."}
        </p>

        <form className="add-bus-modal__form" onSubmit={handleSubmit}>
          {editing && busToEdit ? (
            <div className="add-bus-modal__readonly-strip">
              <div>
                <span className="add-bus-modal__readonly-k">Bus</span>
                <span className="add-bus-modal__readonly-v">{busToEdit.busNumber}</span>
              </div>
              <div>
                <span className="add-bus-modal__readonly-k">IMEI</span>
                <span className="add-bus-modal__readonly-v add-bus-modal__input--mono">{busToEdit.imei || "—"}</span>
              </div>
            </div>
          ) : (
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
          )}

          <div className="add-bus-modal__grid2">
            <label className="add-bus-modal__field">
              <span className="add-bus-modal__label">Plate number</span>
              <input
                className="add-bus-modal__input add-bus-modal__input--mono"
                placeholder="e.g. ABC 1234 (optional)"
                value={form.plateNumber}
                onChange={(e) => setForm((f) => ({ ...f, plateNumber: e.target.value }))}
                autoComplete="off"
              />
            </label>
            <label className="add-bus-modal__field">
              <span className="add-bus-modal__label">Max seat capacity</span>
              <input
                className="add-bus-modal__input add-bus-modal__input--mono"
                type="number"
                min={1}
                max={300}
                step={1}
                inputMode="numeric"
                value={form.seatCapacity === 0 ? "" : form.seatCapacity}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setForm((f) => ({ ...f, seatCapacity: 0 }));
                    return;
                  }
                  const n = parseInt(v, 10);
                  setForm((f) => ({ ...f, seatCapacity: Number.isFinite(n) ? n : f.seatCapacity }));
                }}
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
                  const full = `${o.lastName}, ${o.firstName} · ${o.email}${o.employeeId ? ` · Emp ${o.employeeId}` : ""} · Sys ${o.operatorId}`;
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
                className="add-bus-modal__select add-bus-modal__select--no-end-chevron"
                value={form.driverId}
                onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}
              >
                <option value="">
                  {drivers.length === 0 ? "No verified drivers (complete driver OTP wizard)" : "Select verified driver…"}
                </option>
                {drivers.map((d) => {
                  const full = `${`${d.lastName}, ${d.firstName}`.trim()} · ID ${d.driverId}${d.licenseNumber ? ` · ${d.licenseNumber}` : ""}`;
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
                <option value="">
                  {corridorRoutes.length === 0
                    ? "No routes yet — create one in Route management"
                    : "Select route from Route management…"}
                </option>
                {[...corridorRoutes]
                  .sort((a, b) => routeOptionLabel(a).localeCompare(routeOptionLabel(b)))
                  .map((r) => {
                    const label = routeOptionLabel(r);
                    const title = `${label} · ${r.originLabel} → ${r.destLabel}`;
                    return (
                      <option key={r._id} value={label} title={title}>
                        {compactOptionLabel(label, 22)}
                      </option>
                    );
                  })}
              </select>
            </div>
          </label>

          {localError ? <p className="add-bus-modal__error">{localError}</p> : null}

          <div className="add-bus-modal__actions">
            <button type="button" className="add-bus-modal__btn add-bus-modal__btn--ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="add-bus-modal__btn add-bus-modal__btn--primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Save vehicle"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
