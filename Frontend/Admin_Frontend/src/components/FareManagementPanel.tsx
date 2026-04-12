import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteFareMatrixEntry,
  fetchFareLocationEndpoints,
  fetchFareMatrix,
  fetchFareSettings,
  patchFareMatrixEntry,
  postFareMatrix,
  putFareSettings,
} from "@/lib/api";
import { compactOptionLabel } from "@/lib/selectLabel";
import { shortFareLocationLabel } from "@/lib/fareLocationLabel";
import type { FareLocationOption, FareMatrixRowDto } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { swalConfirm } from "@/lib/swal";
import { FareGlassCard } from "@/components/FareGlassCard";
import { ViewDetailsModal, ViewDetailsDl, ViewDetailsRow } from "@/components/ViewDetailsModal";
import "./FareManagementPanel.css";
import "@/components/ViewDetailsModal.css";

function IconBadgePercent() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.31-8.86c-1.77-.45-2.34-.94-2.34-1.67 0-.84.79-1.43 2.1-1.43 1.38 0 1.9.66 1.94 1.64h1.71c-.05-1.34-.87-2.57-2.49-2.97V5H10.9v1.69c-1.51.32-2.72 1.3-2.72 2.81 0 1.79 1.49 2.69 3.66 3.21 1.95.46 2.34 1.15 2.34 1.87 0 .53-.39 1.39-2.1 1.39-1.6 0-2.23-.72-2.32-1.64H8.04c.1 1.7 1.36 2.66 2.86 2.97V19h2.34v-1.67c1.52-.29 2.72-1.16 2.73-2.77-.01-2.2-1.91-2.96-3.66-3.42z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconSave() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" fill="currentColor" />
    </svg>
  );
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeFarePerKmFromApi(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}

/** Fare matrix uses hub terminals only (`t:coverageId`); stops use `s:` and are priced via Fare per Km. */
function isTerminalFareEndpointToken(token: string): boolean {
  return String(token).trim().startsWith("t:");
}

export function FareManagementPanel() {
  const { user } = useAuth();
  const canEditFares =
    user?.role === "Admin" &&
    (user?.adminTier === "super" || user?.rbacRole === "super_admin");
  const { showError, showSuccess } = useToast();
  const [startOptions, setStartOptions] = useState<FareLocationOption[]>([]);
  const [endOptions, setEndOptions] = useState<FareLocationOption[]>([]);
  const [startEndpoint, setStartEndpoint] = useState("");
  const [endEndpoint, setEndEndpoint] = useState("");
  const [baseFareInput, setBaseFareInput] = useState("");
  const [studentPct, setStudentPct] = useState(20);
  const [pwdPct, setPwdPct] = useState(20);
  const [seniorPct, setSeniorPct] = useState(20);
  /** Same pattern as discount % fields — numeric state avoids controlled number-input string glitches. */
  const [farePerKm, setFarePerKm] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deployingBase, setDeployingBase] = useState(false);
  const [savingDiscounts, setSavingDiscounts] = useState(false);
  const [matrixItems, setMatrixItems] = useState<FareMatrixRowDto[]>([]);
  const [matrixBusyId, setMatrixBusyId] = useState<string | null>(null);
  const [viewFare, setViewFare] = useState<FareMatrixRowDto | null>(null);
  const [editFare, setEditFare] = useState<FareMatrixRowDto | null>(null);
  const [editBaseInput, setEditBaseInput] = useState("");

  /** Bumps when saving discounts so a slow in-flight GET from `refresh` cannot overwrite Fare per Km after PUT. */
  const settingsLoadGenRef = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const gen = ++settingsLoadGenRef.current;
    if (!silent) setLoading(true);
    try {
      const [endpoints, settings, matrix] = await Promise.all([
        fetchFareLocationEndpoints(),
        fetchFareSettings(),
        fetchFareMatrix(),
      ]);
      if (gen !== settingsLoadGenRef.current) return;
      setStartOptions(endpoints.startOptions);
      setEndOptions(endpoints.endOptions);
      setStudentPct(settings.studentDiscountPct);
      setPwdPct(settings.pwdDiscountPct);
      setSeniorPct(settings.seniorDiscountPct);
      setFarePerKm(normalizeFarePerKmFromApi(settings.farePerKmPesos));
      setMatrixItems(matrix.items);
    } catch (e) {
      if (gen === settingsLoadGenRef.current) {
        showError(e instanceof Error ? e.message : "Failed to load fares");
      }
    } finally {
      if (!silent && gen === settingsLoadGenRef.current) {
        setLoading(false);
      }
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (editFare) {
      setEditBaseInput(Number(editFare.baseFarePesos).toFixed(2));
    }
  }, [editFare]);

  const terminalStartOptions = useMemo(
    () => startOptions.filter((o) => isTerminalFareEndpointToken(o.token)),
    [startOptions],
  );
  const terminalEndOptions = useMemo(
    () => endOptions.filter((o) => isTerminalFareEndpointToken(o.token)),
    [endOptions],
  );

  useEffect(() => {
    if (startEndpoint && !terminalStartOptions.some((o) => o.token === startEndpoint)) {
      setStartEndpoint("");
    }
  }, [startEndpoint, terminalStartOptions]);

  useEffect(() => {
    if (endEndpoint && !terminalEndOptions.some((o) => o.token === endEndpoint)) {
      setEndEndpoint("");
    }
  }, [endEndpoint, terminalEndOptions]);

  const selectsDisabled = !canEditFares || terminalStartOptions.length === 0;

  async function handleSaveDiscounts() {
    if (!canEditFares) {
      showError("Only Super Admin may change fare policies and the fare matrix.");
      return;
    }
    const perKm = roundMoney(farePerKm);
    if (!Number.isFinite(perKm) || perKm < 0) {
      showError("Enter a valid fare per km (₱0 or more).");
      return;
    }
    settingsLoadGenRef.current += 1;
    setSavingDiscounts(true);
    try {
      const updated = await putFareSettings({
        studentDiscountPct: studentPct,
        pwdDiscountPct: pwdPct,
        seniorDiscountPct: seniorPct,
        farePerKmPesos: perKm,
      });
      setStudentPct(updated.studentDiscountPct);
      setPwdPct(updated.pwdDiscountPct);
      setSeniorPct(updated.seniorDiscountPct);
      setFarePerKm(normalizeFarePerKmFromApi(updated.farePerKmPesos));
      showSuccess("Global fare settings saved.");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save discounts");
    } finally {
      setSavingDiscounts(false);
    }
  }

  async function handleDeployBaseFare() {
    if (!canEditFares) {
      showError("Only Super Admin may change fare policies and the fare matrix.");
      return;
    }
    const base = Number(baseFareInput);
    const startTok = startEndpoint.trim();
    const endTok = endEndpoint.trim();
    if (!startTok || !endTok) {
      showError("Select a start location and a destination.");
      return;
    }
    if (startTok === endTok) {
      showError("Start and destination must be different.");
      return;
    }
    if (!Number.isFinite(base) || base < 0 || baseFareInput.trim() === "") {
      showError("Enter a valid base fare (₱0 or more).");
      return;
    }

    setDeployingBase(true);
    try {
      await postFareMatrix({
        startEndpoint: startTok,
        endEndpoint: endTok,
        baseFarePesos: roundMoney(base),
      });
      showSuccess("Base fare route saved.");
      setBaseFareInput("");
      setStartEndpoint("");
      setEndEndpoint("");
      await refresh({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not save base fare");
    } finally {
      setDeployingBase(false);
    }
  }

  async function handleSaveEditFare() {
    if (!editFare || !canEditFares) return;
    const base = Number(editBaseInput);
    if (!Number.isFinite(base) || base < 0 || editBaseInput.trim() === "") {
      showError("Enter a valid base fare (₱0 or more).");
      return;
    }
    setMatrixBusyId(editFare._id);
    try {
      await patchFareMatrixEntry(editFare._id, { baseFarePesos: roundMoney(base) });
      showSuccess("Base fare updated.");
      setEditFare(null);
      await refresh({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not update fare");
    } finally {
      setMatrixBusyId(null);
    }
  }

  async function handleDeleteMatrix(row: FareMatrixRowDto) {
    if (!canEditFares) return;
    if (
      !(await swalConfirm({
        title: "Remove fare route?",
        text: `${row.startLabel}\n→\n${row.endLabel}`,
        icon: "warning",
        confirmButtonText: "Remove",
      }))
    )
      return;
    setMatrixBusyId(row._id);
    try {
      await deleteFareMatrixEntry(row._id);
      showSuccess("Fare route removed.");
      await refresh({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not delete fare route");
    } finally {
      setMatrixBusyId(null);
    }
  }

  if (loading) {
    return <p className="mgmt-mod__unknown">Loading fare configuration…</p>;
  }

  return (
    <div className="fare-mgmt">
      <div className="fare-mgmt__shell">
        <h2 className="fare-mgmt__title">
          <IconBadgePercent />
          Fare &amp; discount configuration
        </h2>

        <div className="fare-mgmt__bento" aria-label="Fare configuration columns">
          <div className="fare-mgmt__bento-col fare-mgmt__bento-col--left">
            <div className="fare-mgmt__card fare-mgmt__card--muted">
            <h3 className="fare-mgmt__card-title fare-mgmt__card-title--dim">Set base rate</h3>
            {terminalStartOptions.length === 0 ? (
              <p className="fare-mgmt__hint fare-mgmt__hint--block">
                No deployed terminals yet. Under <strong>Location management</strong>, register a hub (terminal + optional
                bus stops), then deploy it. Base fares are set between terminals only.
              </p>
            ) : null}
            <div className="fare-mgmt__field">
              <label className="fare-mgmt__field-label" htmlFor="fare-start">
                Start location
              </label>
              <div className="fare-mgmt__select-wrap">
                <span className="fare-mgmt__select-icon" aria-hidden><IconPin /></span>
                <select
                  id="fare-start"
                  className="fare-mgmt__select"
                  value={startEndpoint}
                  disabled={selectsDisabled}
                  onChange={(e) => setStartEndpoint(e.target.value)}
                >
                  <option value="">Select start terminal</option>
                  {terminalStartOptions.map((o) => {
                    const short = shortFareLocationLabel(o.label);
                    return (
                      <option key={`s-${o.token}`} value={o.token} title={o.label}>
                        {compactOptionLabel(short, 20)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <div className="fare-mgmt__field">
              <label className="fare-mgmt__field-label" htmlFor="fare-end">
                Destination
              </label>
              <div className="fare-mgmt__select-wrap">
                <span className="fare-mgmt__select-icon" aria-hidden><IconPin /></span>
                <select
                  id="fare-end"
                  className="fare-mgmt__select"
                  value={endEndpoint}
                  disabled={selectsDisabled}
                  onChange={(e) => setEndEndpoint(e.target.value)}
                >
                  <option value="">Select destination terminal</option>
                  {terminalEndOptions.map((o) => {
                    const short = shortFareLocationLabel(o.label);
                    return (
                      <option key={`e-${o.token}`} value={o.token} title={o.label}>
                        {compactOptionLabel(short, 20)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            <div className="fare-mgmt__field">
              <label className="fare-mgmt__field-label" htmlFor="fare-base">
                Base fare
              </label>
              <div className="fare-mgmt__peso-row">
                <span className="fare-mgmt__peso-symbol" aria-hidden>
                  ₱
                </span>
                <input
                  id="fare-base"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  className="fare-mgmt__input fare-mgmt__input--currency"
                  value={baseFareInput}
                  disabled={!canEditFares}
                  onChange={(e) => setBaseFareInput(e.target.value)}
                />
              </div>
            </div>
            <div className="fare-mgmt__card-actions">
              <button
                type="button"
                className="fare-mgmt__btn fare-mgmt__btn--base"
                disabled={deployingBase || savingDiscounts || !canEditFares || selectsDisabled}
                onClick={() => void handleDeployBaseFare()}
              >
                <IconSave />
                {deployingBase ? "Saving…" : "Save base fare route"}
              </button>
            </div>
            </div>
          </div>

          <div className="fare-mgmt__bento-col fare-mgmt__bento-col--right">
            <div className="fare-mgmt__card fare-mgmt__card--amber">
            <h3 className="fare-mgmt__card-title fare-mgmt__card-title--amber">Global discounts (%)</h3>
            <div className="fare-mgmt__discount-row">
              <span id="fare-per-km-label">Fare per Km</span>
              <div className="fare-mgmt__pct-wrap" style={{ flex: 1, justifyContent: "flex-end", minWidth: 0 }}>
                {canEditFares ? (
                  <div className="fare-mgmt__peso-row" style={{ maxWidth: "11rem" }}>
                    <span className="fare-mgmt__peso-symbol" aria-hidden>
                      ₱
                    </span>
                    <input
                      id="fare-per-km"
                      type="number"
                      min={0}
                      step={0.01}
                      aria-labelledby="fare-per-km-label"
                      className="fare-mgmt__input fare-mgmt__input--currency"
                      value={farePerKm}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setFarePerKm(0);
                          return;
                        }
                        const n = Number(raw);
                        if (Number.isFinite(n) && n >= 0) setFarePerKm(roundMoney(n));
                      }}
                    />
                    <span className="fare-mgmt__hint" style={{ margin: 0, flexShrink: 0 }}>
                      / km
                    </span>
                  </div>
                ) : (
                  <span className="fare-mgmt__hint" style={{ margin: 0, fontWeight: 700, color: "#e2e8f0" }}>
                    ₱{farePerKm.toFixed(2)} / km
                  </span>
                )}
              </div>
            </div>

            {(
              [
                ["Student", studentPct, setStudentPct] as const,
                ["PWD", pwdPct, setPwdPct] as const,
                ["Senior", seniorPct, setSeniorPct] as const,
              ] as const
            ).map(([label, val, setVal]) => (
              <div key={label} className="fare-mgmt__discount-row">
                <span>{label}</span>
                <div className="fare-mgmt__pct-wrap">
                  {canEditFares ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="fare-mgmt__pct"
                        value={val}
                        onChange={(e) => setVal(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                      />
                      <span className="fare-mgmt__hint" style={{ margin: 0 }}>
                        %
                      </span>
                    </>
                  ) : (
                    <span className="fare-mgmt__hint" style={{ margin: 0, fontWeight: 700, color: "#e2e8f0" }}>
                      {val}%
                    </span>
                  )}
                </div>
              </div>
            ))}
            {!canEditFares ? (
              <p className="fare-mgmt__hint">Only Super Admin can change global discount rules and the fare matrix.</p>
            ) : null}
            <div className="fare-mgmt__card-actions">
              <button
                type="button"
                className="fare-mgmt__btn fare-mgmt__btn--discounts"
                disabled={savingDiscounts || deployingBase || !canEditFares}
                onClick={() => void handleSaveDiscounts()}
              >
                <IconSave />
                {savingDiscounts ? "Saving…" : "Save discount changes"}
              </button>
            </div>
            </div>
          </div>
        </div>
      </div>

      {matrixItems.length > 0 ? (
        <div className="fare-mgmt__matrix-section">
          <h3 className="fare-mgmt__matrix-heading">Deployed fare routes</h3>
          <div className="fare-mgmt__matrix-grid">
            {matrixItems.map((row) => (
              <FareGlassCard
                key={row._id}
                row={row}
                canDelete={canEditFares}
                canEdit={canEditFares}
                busy={matrixBusyId === row._id}
                onView={() => setViewFare(row)}
                onEdit={() => setEditFare(row)}
                onDelete={() => void handleDeleteMatrix(row)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <ViewDetailsModal open={viewFare != null} title="Fare route details" onClose={() => setViewFare(null)}>
        {viewFare ? (
          <ViewDetailsDl>
            <ViewDetailsRow label="Start (full)" value={viewFare.startLabel} />
            <ViewDetailsRow label="Destination (full)" value={viewFare.endLabel} />
            <ViewDetailsRow label="Base fare" value={`₱${Number(viewFare.baseFarePesos).toFixed(2)}`} />
            {viewFare.updatedAt ? (
              <ViewDetailsRow label="Updated" value={new Date(viewFare.updatedAt).toLocaleString()} />
            ) : null}
          </ViewDetailsDl>
        ) : null}
      </ViewDetailsModal>

      {editFare ? (
        <div
          className="view-details-modal__backdrop"
          role="presentation"
          onClick={() => {
            if (!matrixBusyId) setEditFare(null);
          }}
        >
          <div
            className="view-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fare-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="view-details-modal__header">
              <h2 id="fare-edit-title" className="view-details-modal__title">
                Edit base fare
              </h2>
              <button
                type="button"
                className="view-details-modal__close"
                disabled={matrixBusyId != null}
                onClick={() => setEditFare(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="view-details-modal__body">
              <p className="fare-mgmt__edit-route-preview" style={{ margin: "0 0 0.75rem", fontSize: "0.84rem", color: "#cbd5e1" }}>
                <strong style={{ color: "#e2e8f0" }}>{editFare.startLabel}</strong>
                <span style={{ margin: "0 0.35rem", opacity: 0.6 }}>→</span>
                <strong style={{ color: "#e2e8f0" }}>{editFare.endLabel}</strong>
              </p>
              <label className="fare-mgmt__deploy-label" style={{ display: "block" }}>
                <span className="fare-mgmt__deploy-k">Base fare (₱)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="fare-mgmt__deploy-input"
                  value={editBaseInput}
                  onChange={(e) => setEditBaseInput(e.target.value)}
                  disabled={matrixBusyId != null}
                />
              </label>
            </div>
            <footer className="view-details-modal__footer fare-mgmt__edit-footer">
              <button
                type="button"
                className="fare-mgmt__btn fare-mgmt__btn--ghost"
                disabled={matrixBusyId != null}
                onClick={() => setEditFare(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fare-mgmt__btn fare-mgmt__btn--deploy"
                disabled={matrixBusyId != null}
                onClick={() => void handleSaveEditFare()}
              >
                {matrixBusyId != null ? "Saving…" : "Save"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
