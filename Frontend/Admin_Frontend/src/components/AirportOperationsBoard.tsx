import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ADMIN_API_ORIGIN, fetchLiveDispatchBlocks, getToken } from "@/lib/api";
import type { LiveDispatchBlock } from "@/lib/types";
import "./AirportOperationsBoard.css";

type LiveBoardPayload = {
  items?: Array<Record<string, unknown>>;
  holidayBanner?: { holidayName: string; message: string; updatedAt: string } | null;
  serverTime?: string;
  manilaDate?: string;
};

function manilaYmdClient(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function tripDisplayId(orderIndex: number): string {
  return String(orderIndex + 1).padStart(3, "0");
}

function dateForRow(bl: LiveDispatchBlock, fallbackDate: string): string {
  const rowDate = bl.serviceDate?.trim();
  return rowDate && /^\d{4}-\d{2}-\d{2}$/.test(rowDate) ? rowDate : fallbackDate;
}

function gateForRow(bl: LiveDispatchBlock): string {
  const g = bl.gate?.trim();
  const c = bl.currentTerminalGate?.trim();
  const a = bl.arrivalTerminalName?.trim();
  return g || c || a || "—";
}

function etaForRow(bl: LiveDispatchBlock, nowMs: number): string {
  if (bl.trackingLost) {
    return bl.status === "arriving" ? "SIGNAL LOST" : "ESTIMATED";
  }
  if (bl.trackingDegraded && bl.status === "arriving") {
    return "ESTIMATED";
  }
  if (bl.status === "arriving" && bl.arrivalLockedEta?.trim()) {
    return bl.arrivalLockedEta.trim();
  }
  if (bl.status === "cancelled") return "—";
  if (bl.etaTargetIso) {
    const target = new Date(bl.etaTargetIso).getTime();
    if (Number.isFinite(target)) {
      const mins = Math.max(0, Math.round((target - nowMs) / 60000));
      return `${mins} mins`;
    }
  }
  if (Number.isFinite(bl.etaMinutes) && (bl.etaMinutes ?? 0) >= 0) return `${Math.max(0, Math.round(bl.etaMinutes ?? 0))} mins`;
  return "ESTIMATED";
}

function etaConfidenceForRow(
  bl: LiveDispatchBlock
): { label: "Signal lost" | "Signal weak" | "Live" | "Estimated"; tone: "off" | "weak" | "live" | "est" } {
  if (bl.trackingLost) return { label: "Signal lost", tone: "off" };
  if (bl.trackingDegraded) return { label: "Signal weak", tone: "weak" };
  if (bl.status === "arriving" && bl.arrivalLockedEta?.trim()) return { label: "Live", tone: "live" };
  if ((bl.etaTargetIso && String(bl.etaTargetIso).trim()) || Number.isFinite(bl.etaMinutes)) return { label: "Live", tone: "live" };
  return { label: "Estimated", tone: "est" };
}

function gateConfidenceForRow(
  bl: LiveDispatchBlock
): { label: "Signal lost" | "Live" | "Estimated"; tone: "off" | "live" | "est" } {
  if (bl.trackingLost) return { label: "Signal lost", tone: "off" };
  const hasGate = !!(bl.gate?.trim() || bl.currentTerminalGate?.trim() || bl.arrivalTerminalName?.trim());
  if (hasGate) return { label: "Live", tone: "live" };
  return { label: "Estimated", tone: "est" };
}

function statusLabel(status: LiveDispatchBlock["status"]): { text: string; emoji: string; mod: string } {
  if (status === "arriving") return { text: "ARRIVED", emoji: "🟢", mod: "airport-board__status--arrived" };
  if (status === "delayed") return { text: "DELAYED", emoji: "🟠", mod: "airport-board__status--delayed" };
  if (status === "cancelled") return { text: "CANCELLED", emoji: "⚫", mod: "airport-board__status--cancelled" };
  return { text: "ON-TIME", emoji: "🟢", mod: "airport-board__status--ontime" };
}

export function AirportOperationsBoard() {
  const [blocks, setBlocks] = useState<LiveDispatchBlock[]>([]);
  const [holiday, setHoliday] = useState<{ holidayName: string; message: string; updatedAt: string } | null>(null);
  const [manilaDate, setManilaDate] = useState<string>(() => manilaYmdClient());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [err, setErr] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [flashIds, setFlashIds] = useState<Record<string, true>>({});
  const prevSigRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetchLiveDispatchBlocks();
      setBlocks(res.items ?? []);
      setHoliday(res.holidayBanner ?? null);
      if (res.manilaDate?.trim()) setManilaDate(res.manilaDate.trim().slice(0, 10));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load schedule");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setManilaDate(manilaYmdClient()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const bl of blocks) {
      next[bl.id] = `${gateForRow(bl)}|${etaForRow(bl, nowMs)}|${bl.status}`;
    }
    const hit: Record<string, true> = {};
    for (const id of Object.keys(next)) {
      if (prevSigRef.current[id] && prevSigRef.current[id] !== next[id]) {
        hit[id] = true;
      }
    }
    prevSigRef.current = next;
    if (Object.keys(hit).length > 0) {
      setFlashIds(hit);
      const t = window.setTimeout(() => setFlashIds({}), 650);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [blocks, nowMs]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket: Socket = io(ADMIN_API_ORIGIN.replace(/\/$/, ""), {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 12,
      reconnectionDelay: 2000,
    });

    const onSnap = (raw: LiveBoardPayload) => {
      const items = raw.items;
      if (!Array.isArray(items)) return;
      const mapped: LiveDispatchBlock[] = items.map((row) => {
        const sched = String(row.scheduledDeparture ?? "").trim();
        const depTime = String(row.departureTime ?? "").trim();
        return {
          id: String(row.id ?? ""),
          busId: String(row.busId ?? ""),
          routeId: String(row.routeId ?? ""),
          routeLabel: String(row.route ?? row.routeLabel ?? ""),
          departurePoint: String(row.departurePoint ?? "—"),
          scheduledDeparture: sched || depTime,
          status: (row.status as LiveDispatchBlock["status"]) || "on-time",
          gate: row.gate != null ? String(row.gate) : undefined,
          currentTerminalGate: row.currentTerminalGate != null ? String(row.currentTerminalGate) : undefined,
          arrivalTerminalName: row.arrivalTerminalName != null ? String(row.arrivalTerminalName) : undefined,
          arrivalLockedEta: row.arrivalLockedEta != null ? String(row.arrivalLockedEta) : undefined,
          arrivalDetectedAt: row.arrivalDetectedAt != null ? String(row.arrivalDetectedAt) : undefined,
          etaMinutes:
            row.etaMinutes != null && Number.isFinite(Number(row.etaMinutes)) ? Math.max(0, Number(row.etaMinutes)) : undefined,
          etaTargetIso: row.etaTargetIso != null ? String(row.etaTargetIso) : undefined,
          nextTerminal: row.nextTerminal != null ? String(row.nextTerminal) : undefined,
          serviceDate: row.serviceDate != null && String(row.serviceDate).trim() ? String(row.serviceDate).trim() : undefined,
          trackingLost: row.trackingLost === true,
          trackingDegraded: row.trackingDegraded === true,
          telemetrySignal:
            row.telemetrySignal === "strong" || row.telemetrySignal === "weak" || row.telemetrySignal === "offline"
              ? row.telemetrySignal
              : undefined,
        };
      });
      setBlocks(mapped.filter((b) => b.id));
      if (raw.holidayBanner !== undefined) {
        setHoliday(
          raw.holidayBanner && typeof raw.holidayBanner === "object"
            ? (raw.holidayBanner as { holidayName: string; message: string; updatedAt: string })
            : null
        );
      }
      if (raw.manilaDate != null && String(raw.manilaDate).trim()) {
        setManilaDate(String(raw.manilaDate).trim().slice(0, 10));
      }
    };

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("liveBoardSnapshot", onSnap);
    socket.emit("subscribe:liveBoard");

    return () => {
      socket.off("liveBoardSnapshot", onSnap);
      socket.disconnect();
    };
  }, []);

  const displayDate = manilaDate || manilaYmdClient();

  const sortedRows = useMemo(() => {
    return [...blocks].sort((a, b) => {
      const da = dateForRow(a, displayDate);
      const db = dateForRow(b, displayDate);
      const dateCmp = da.localeCompare(db);
      if (dateCmp !== 0) return dateCmp;
      const depCmp = a.scheduledDeparture.localeCompare(b.scheduledDeparture);
      if (depCmp !== 0) return depCmp;
      return a.busId.localeCompare(b.busId);
    });
  }, [blocks, displayDate]);

  return (
    <div className="airport-board airport-board--led">
      <header className="airport-board__mast">
        <div>
          <h2 className="airport-board__title">Live fleet departures</h2>
        </div>
        <div className="airport-board__live">
          <span className={"airport-board__dot" + (connected ? " airport-board__dot--on" : "")} aria-hidden />
          <span className="airport-board__live-label">{connected ? "Live socket" : "Reconnecting…"}</span>
        </div>
      </header>

      {holiday ? (
        <div className="airport-board__banner" role="status">
          <strong>{holiday.holidayName}</strong>
          <span>{holiday.message}</span>
        </div>
      ) : null}

      {err ? (
        <p className="airport-board__err" role="alert">
          {err}
        </p>
      ) : null}

      <div className="airport-board__table-wrap">
        <table className="airport-board__table airport-board__table--led" aria-label="Operations departures board">
          <thead>
            <tr>
              <th scope="col">TRP #</th>
              <th scope="col">ROUTE</th>
              <th scope="col">DATE</th>
              <th scope="col">ETA</th>
              <th scope="col">GATE</th>
              <th scope="col">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length > 0 ? (
              sortedRows.map((bl, idx) => {
                const st = statusLabel(bl.status);
                const eta = etaForRow(bl, nowMs);
                const gate = gateForRow(bl);
                const etaConfidence = etaConfidenceForRow(bl);
                const gateConfidence = gateConfidenceForRow(bl);
                const flash = flashIds[bl.id];
                return (
                  <tr
                    key={bl.id}
                    className={
                      "airport-board__row airport-board__row--segment airport-board__row--led " +
                      st.mod +
                      (flash ? " airport-board__row--flash" : "")
                    }
                  >
                    <td className="airport-board__mono airport-board__cell--led">{tripDisplayId(idx)}</td>
                    <td className="airport-board__route airport-board__cell--led">
                      {bl.routeLabel.replace(/\s*[–—-]\s*/g, " ➔ ")}
                    </td>
                    <td className="airport-board__mono airport-board__cell--led">{dateForRow(bl, displayDate)}</td>
                    <td className="airport-board__mono airport-board__mono--lg airport-board__cell--led">
                      <div className="airport-board__value-stack">
                        <span>{eta}</span>
                        <span className={`airport-board__confidence airport-board__confidence--${etaConfidence.tone}`}>
                          {etaConfidence.label}
                        </span>
                      </div>
                    </td>
                    <td className="airport-board__mono airport-board__cell--led">
                      <div className="airport-board__value-stack">
                        <span>{gate}</span>
                        <span className={`airport-board__confidence airport-board__confidence--${gateConfidence.tone}`}>
                          {gateConfidence.label}
                        </span>
                      </div>
                    </td>
                    <td className="airport-board__cell--led">
                      <span className={"airport-board__status " + st.mod}>
                        {st.emoji} {st.text}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : null}
          </tbody>
        </table>
        {blocks.length === 0 && !err ? (
          <p className="airport-board__empty">No active trip blocks — publish a bus in Management → Schedules (dispatcher).</p>
        ) : null}
      </div>
    </div>
  );
}
