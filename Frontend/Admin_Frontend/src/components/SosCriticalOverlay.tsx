import { useState } from "react";
import { useSosIntercept } from "@/context/SosInterceptContext";
import "./SosCriticalOverlay.css";

/** Resolve-notes modal only (banner moved to tactical feed + Settings). */
export function SosResolveModal() {
  const { activeIncident, resolveIncident, closeResolveModal, resolveModalOpen } = useSosIntercept();
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!activeIncident || !resolveModalOpen) return null;

  async function submitResolve() {
    setErr(null);
    const t = notes.trim();
    if (t.length < 8) {
      setErr("Incident notes are required (at least 8 characters) for the operational record.");
      return;
    }
    setPending(true);
    try {
      await resolveIncident(t);
      setNotes("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sos-resolve-modal" role="dialog" aria-modal="true" aria-labelledby="sos-resolve-title">
      <div className="sos-resolve-modal__panel">
        <h2 id="sos-resolve-title" className="sos-resolve-modal__title">
          Close SOS — incident notes required
        </h2>
        <p className="sos-resolve-modal__sub">
          Bukidnon Bus Company record: document actions taken before clearing the command overlay.
        </p>
        <textarea
          className="sos-resolve-modal__textarea"
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Spoke with attendant via phone; PNP notified; bus cleared at 14:22; passengers transferred to backup unit…"
        />
        {err ? (
          <p className="sos-resolve-modal__err" role="alert">
            {err}
          </p>
        ) : null}
        <div className="sos-resolve-modal__row">
          <button type="button" className="sos-resolve-modal__cancel" onClick={closeResolveModal} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="sos-resolve-modal__submit" onClick={() => void submitResolve()} disabled={pending}>
            {pending ? "Saving…" : "Resolve & log to Reports"}
          </button>
        </div>
      </div>
    </div>
  );
}
