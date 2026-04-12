import { useEffect, useState } from "react";
import "./PassengerMaintenanceShield.css";

const ADMIN_BASE = (import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4001").replace(/\/+$/, "");

type MaintState = { message: string };

export function PassengerMaintenanceShield({ children }: { children: React.ReactNode }) {
  const [block, setBlock] = useState<MaintState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`${ADMIN_BASE}/api/public/maintenance-status`, { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setBlock(null);
          return;
        }
        const j = (await r.json()) as {
          enabled?: boolean;
          passengerLocked?: boolean;
          message?: string;
        };
        if (cancelled) return;
        const lockedExplicit = typeof j.passengerLocked === "boolean";
        const passengerLocked = lockedExplicit ? j.passengerLocked === true : j.enabled === true;
        if (passengerLocked) {
          setBlock({
            message:
              typeof j.message === "string" && j.message.trim()
                ? j.message
                : "Bukidnon Bus Company is performing scheduled maintenance. Please try again shortly.",
          });
        } else {
          setBlock(null);
        }
      } catch {
        if (!cancelled) setBlock(null);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <>
      {children}
      {block ? (
        <div className="pax-maint-overlay" role="alertdialog" aria-modal="true" aria-labelledby="pax-maint-title">
          <div className="pax-maint-overlay__panel">
            <div className="pax-maint-overlay__badge" id="pax-maint-title">
              <span className="pax-maint-overlay__dot" aria-hidden />
              System maintenance
            </div>
            <p className="pax-maint-overlay__body">{block.message}</p>
            <p className="pax-maint-overlay__foot">This notice clears when service is restored.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
