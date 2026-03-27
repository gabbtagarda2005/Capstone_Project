import { useCallback, useEffect, useState } from "react";
import {
  deleteFareMatrixEntry,
  fetchFareLocationEndpoints,
  fetchFareMatrix,
  fetchFareSettings,
  postFareMatrix,
  putFareSettings,
} from "@/lib/api";
import { compactOptionLabel } from "@/lib/selectLabel";
import { shortFareLocationLabel } from "@/lib/fareLocationLabel";
import type { FareLocationOption, FareMatrixRowDto } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { FareGlassCard } from "@/components/FareGlassCard";
import { ViewDetailsModal, ViewDetailsDl, ViewDetailsRow } from "@/components/ViewDetailsModal";
import "./FareManagementPanel.css";

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

export function FareManagementPanel() {
  const { user } = useAuth();
  const canEditFares =
    user?.role === "Admin" &&
    (user?.adminTier === "super" || user?.rbacRole === "super_admin");
  const { showError, showSuccess, showInfo } = useToast();
  const [startOptions, setStartOptions] = useState<FareLocationOption[]>([]);
  const [endOptions, setEndOptions] = useState<FareLocationOption[]>([]);
  const [startEndpoint, setStartEndpoint] = useState("");
  const [endEndpoint, setEndEndpoint] = useState("");
  const [baseFareInput, setBaseFareInput] = useState("");
  const [studentPct, setStudentPct] = useState(20);
  const [pwdPct, setPwdPct] = useState(20);
  const [seniorPct, setSeniorPct] = useState(20);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [matrixItems, setMatrixItems] = useState<FareMatrixRowDto[]>([]);
  const [matrixBusyId, setMatrixBusyId] = useState<string | null>(null);
  const [viewFare, setViewFare] = useState<FareMatrixRowDto | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [endpoints, settings, matrix] = await Promise.all([
        fetchFareLocationEndpoints(),
        fetchFareSettings(),
        fetchFareMatrix(),
      ]);
      setStartOptions(endpoints.startOptions);
      setEndOptions(endpoints.endOptions);
      setStudentPct(settings.studentDiscountPct);
      setPwdPct(settings.pwdDiscountPct);
      setSeniorPct(settings.seniorDiscountPct);
      setMatrixItems(matrix.items);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load fares");
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectsDisabled = !canEditFares || startOptions.length === 0;

  async function handleDeploy() {
    if (!canEditFares) {
      showError("Only Super Admin may change fare policies and the fare matrix.");
      return;
    }
    const base = Number(baseFareInput);
    const startTok = startEndpoint.trim() || null;
    const endTok = endEndpoint.trim() || null;
    const wantsMatrix =
      Boolean(startTok && endTok) && Number.isFinite(base) && base >= 0 && baseFareInput.trim() !== "";
    if (wantsMatrix && startTok === endTok) {
      showError("Start and destination must be different.");
      return;
    }

    setDeploying(true);
    try {
      await putFareSettings({
        studentDiscountPct: studentPct,
        pwdDiscountPct: pwdPct,
        seniorDiscountPct: seniorPct,
      });

      if (wantsMatrix && startTok && endTok) {
        await postFareMatrix({
          startEndpoint: startTok,
          endEndpoint: endTok,
          baseFarePesos: roundMoney(base),
        });
        showSuccess("Global discounts and route base fare deployed.");
        setBaseFareInput("");
        setStartEndpoint("");
        setEndEndpoint("");
      } else {
        showSuccess("Global discount percentages saved.");
      }
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }

  async function handleDeleteMatrix(row: FareMatrixRowDto) {
    if (!canEditFares) return;
    const ok = window.confirm(`Remove fare route?\n${row.startLabel}\n→\n${row.endLabel}`);
    if (!ok) return;
    setMatrixBusyId(row._id);
    try {
      await deleteFareMatrixEntry(row._id);
      showSuccess("Fare route removed.");
      await refresh();
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

        <div className="fare-mgmt__bento">
          <div className="fare-mgmt__card fare-mgmt__card--muted">
            <h3 className="fare-mgmt__card-title fare-mgmt__card-title--dim">Set base rate</h3>
            {startOptions.length === 0 ? (
              <p className="fare-mgmt__hint fare-mgmt__hint--block">No locations available yet.</p>
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
                  <option value="">Type start location name</option>
                  {startOptions.map((o) => {
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
                  <option value="">Type destination name</option>
                  {endOptions.map((o) => {
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
          </div>

          <div className="fare-mgmt__card fare-mgmt__card--amber">
            <h3 className="fare-mgmt__card-title fare-mgmt__card-title--amber">Global discounts (%)</h3>
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
          </div>
        </div>

        <button
          type="button"
          className="fare-mgmt__deploy"
          disabled={deploying || !canEditFares}
          onClick={() => void handleDeploy()}
        >
          <IconSave />
          {deploying ? "Saving…" : "Deploy fare changes"}
        </button>
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
                busy={matrixBusyId === row._id}
                onView={() => setViewFare(row)}
                onEditHint={() =>
                  showInfo(
                    "To change the base fare, use the form above: pick the same start and destination, enter the new amount, then Deploy — the fare row will update."
                  )
                }
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
    </div>
  );
}
