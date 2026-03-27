import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { compactOptionLabel } from "@/lib/selectLabel";
import type { CorridorBuilderTerminal } from "@/lib/types";
import "./AddRouteForm.css";

function IconRoute({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 15h2v3h2v-3h2l3.5-8H4l3.5 8zm2.35-1.65h2.3L8.5 9.5h-1L6.35 13.35zM16 7.5V4h2v3.5l3 2v4h-2v-2.5L16 7.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconListPlus({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 6h16v2H4V6zm0 5h10v2H4v-2zm0 5h16v2H4v-2zm14-9h2v3h3v2h-3v3h-2v-3h-3v-2h3V7z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconLocationTiny() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" fill="currentColor" />
    </svg>
  );
}

export type AddRouteFormProps = {
  terminals: CorridorBuilderTerminal[];
  saving: boolean;
  onSave: (payload: {
    displayName?: string;
    originCoverageId: string;
    destinationCoverageId: string;
    viaCoverageIds?: string[];
    authorizedStops: { coverageId: string; sequence: number }[];
  }) => Promise<void>;
};

function hubDisplayLabel(t: CorridorBuilderTerminal): string {
  const loc = t.locationName?.trim();
  const term = t.terminal?.name?.trim();
  return loc || term || "Location";
}

/** First comma-separated segment for compact labels. */
function hubShortLabel(t: CorridorBuilderTerminal): string {
  const full = hubDisplayLabel(t);
  const head = full.split(",")[0]?.trim() ?? "";
  return head || full;
}

export function AddRouteForm({ terminals, saving, onSave }: AddRouteFormProps) {
  const [originId, setOriginId] = useState("");
  const [destId, setDestId] = useState("");
  /** Intermediate hub ids in the order the admin selected them (between start and end). */
  const [viaOrder, setViaOrder] = useState<string[]>([]);
  const [routeName, setRouteName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const betweenTerminals = useMemo(() => {
    if (!originId || !destId || originId === destId) return [];
    return terminals.filter((t) => t._id !== originId && t._id !== destId);
  }, [terminals, originId, destId]);

  useEffect(() => {
    const allowed = new Set(betweenTerminals.map((t) => t._id));
    setViaOrder((prev) => prev.filter((id) => allowed.has(id)));
  }, [betweenTerminals]);

  const toggleVia = useCallback((coverageId: string) => {
    setLocalError(null);
    setViaOrder((prev) => (prev.includes(coverageId) ? prev.filter((id) => id !== coverageId) : [...prev, coverageId]));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!originId) {
      setLocalError("Select a start location from your saved coverage.");
      return;
    }
    if (!destId) {
      setLocalError("Select a destination.");
      return;
    }
    if (originId === destId) {
      setLocalError("Start and destination must be different locations.");
      return;
    }
    const originT = terminals.find((t) => t._id === originId);
    const destT = terminals.find((t) => t._id === destId);
    const autoName = originT && destT ? `${hubShortLabel(originT)} → ${hubShortLabel(destT)}` : "Route";
    const displayName = routeName.trim() ? routeName.trim() : autoName;

    const allowed = new Set(betweenTerminals.map((t) => t._id));
    const viaCoverageIds = viaOrder.filter((id) => allowed.has(id));

    try {
      await onSave({
        displayName,
        originCoverageId: originId,
        destinationCoverageId: destId,
        viaCoverageIds,
        authorizedStops: [],
      });
      setOriginId("");
      setDestId("");
      setViaOrder([]);
      setRouteName("");
    } catch {
      /* toast from parent */
    }
  }

  return (
    <form className="add-route-form" onSubmit={handleSubmit}>
      <h2 className="add-route-form__title">
        <IconRoute /> Create Route
      </h2>

      <div className="add-route-form__field" style={{ marginBottom: "1.05rem" }}>
        <label className="add-route-form__label" htmlFor="add-route-name">
          Route name
        </label>
        <input
          id="add-route-name"
          className="add-route-form__select"
          value={routeName}
          onChange={(e) => setRouteName(e.target.value)}
          placeholder="e.g. Malaybalay ↔ Valencia"
          type="text"
          autoComplete="off"
        />
      </div>

      <div className="add-route-form__route-ends">
        <div className="add-route-form__field">
          <label className="add-route-form__label" htmlFor="add-route-origin">
            Select start location
          </label>
          <div className="add-route-form__select-wrap">
            <span className="add-route-form__select-icon" aria-hidden><IconLocationTiny /></span>
            <select
              id="add-route-origin"
              className="add-route-form__select"
              value={originId}
              onChange={(e) => {
                const v = e.target.value;
                setLocalError(null);
                setOriginId(v);
                if (v && v === destId) setDestId("");
              }}
            >
              <option value="">Select start…</option>
              {terminals.map((t) => {
                const full = hubDisplayLabel(t);
                const shortL = compactOptionLabel(hubShortLabel(t), 20);
                return (
                  <option key={t._id} value={t._id} title={full}>
                    {shortL}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
        <div className="add-route-form__field">
          <label className="add-route-form__label" htmlFor="add-route-dest">
            Select destination
          </label>
          <div className="add-route-form__select-wrap">
            <span className="add-route-form__select-icon" aria-hidden><IconLocationTiny /></span>
            <select
              id="add-route-dest"
              className="add-route-form__select"
              value={destId}
              onChange={(e) => {
                const v = e.target.value;
                setLocalError(null);
                setDestId(v);
                if (v && v === originId) setOriginId("");
              }}
            >
              <option value="">Select destination…</option>
              {terminals.map((t) => {
                const full = hubDisplayLabel(t);
                const shortL = compactOptionLabel(hubShortLabel(t), 20);
                return (
                  <option key={t._id} value={t._id} title={full}>
                    {shortL}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {terminals.length === 0 ? (
        <p className="add-route-form__hint add-route-form__hint--muted">No saved locations yet.</p>
      ) : null}

      {terminals.length > 0 && originId && destId && originId !== destId ? (
        <div className="add-route-form__stops-wrap add-route-form__hubs-wrap">
          <div className="add-route-form__stops-head">
            <h4 className="add-route-form__stops-title">
              <IconListPlus /> Locations
            </h4>
          </div>
          <p className="add-route-form__hint add-route-form__via-hint">
            Choose saved locations between start and destination (optional).
          </p>
          {betweenTerminals.length === 0 ? (
            <p className="add-route-form__hint add-route-form__hint--muted">No other saved locations between these endpoints.</p>
          ) : (
            <div className="add-route-form__hub-list">
              {betweenTerminals.map((t) => {
                const checked = viaOrder.includes(t._id);
                const full = hubDisplayLabel(t);
                const shortL = hubShortLabel(t);
                return (
                  <label
                    key={t._id}
                    className="add-route-form__stop-row add-route-form__hub-row"
                    title={full !== shortL ? full : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleVia(t._id)}
                      aria-label={full}
                    />
                    <span className="add-route-form__hub-row-main">
                      <span className="add-route-form__stop-name add-route-form__hub-short-name">{shortL}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {localError ? <p className="add-route-form__error">{localError}</p> : null}

      <button
        type="submit"
        className="add-route-form__submit"
        disabled={saving || terminals.length < 2 || !originId || !destId}
      >
        {saving ? "Saving…" : "Save Route"}
      </button>
    </form>
  );
}
