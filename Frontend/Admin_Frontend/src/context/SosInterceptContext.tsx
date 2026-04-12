import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { getToken, postAdminAuditEvent } from "@/lib/api";

export type SosIncidentPayload = {
  id: string;
  busId: string;
  plateNumber: string;
  driverName: string;
  attendantName: string;
  attendantEmail?: string | null;
  latitude: number;
  longitude: number;
  assignedRoute?: string | null;
  createdAt: string;
};

type CommandAlertPayload = {
  kind?: string;
  id?: string;
  busId?: string;
  plateNumber?: string;
  driverName?: string;
  attendantName?: string;
  attendantEmail?: string | null;
  latitude?: number;
  longitude?: number;
  speedKph?: number;
  message?: string;
  assignedRoute?: string | null;
  createdAt?: string;
};

type LocationUpdatePayload = {
  busId?: string;
  latitude?: number;
  longitude?: number;
};

type Ctx = {
  activeIncident: SosIncidentPayload | null;
  liveLat: number | null;
  liveLng: number | null;
  muted: boolean;
  setMuted: (v: boolean) => void;
  resolveIncident: (notes: string) => Promise<void>;
  openResolveModal: () => void;
  closeResolveModal: () => void;
  resolveModalOpen: boolean;
  incidentResponseActive: boolean;
  setIncidentResponseActive: (v: boolean) => void;
  interceptSimulated: () => Promise<void>;
  queuePassengerDelayNotice: () => void;
  audioChannelHint: () => void;
};

const SosInterceptContext = createContext<Ctx | null>(null);

const API_BASE = import.meta.env.VITE_ADMIN_API_URL || "http://localhost:4001";

function playSonarPing() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 165;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.start(t);
    osc.stop(t + 0.56);
    ctx.resume?.().catch(() => {});
  } catch {
    /* ignore */
  }
}

function normalizeSos(p: CommandAlertPayload): SosIncidentPayload | null {
  if (p.kind !== "sos" || !p.id || !p.busId) return null;
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: String(p.id),
    busId: String(p.busId),
    plateNumber: p.plateNumber != null ? String(p.plateNumber) : "—",
    driverName: p.driverName != null && String(p.driverName).trim() ? String(p.driverName).trim() : "—",
    attendantName: p.attendantName != null && String(p.attendantName).trim() ? String(p.attendantName).trim() : "Attendant",
    attendantEmail: p.attendantEmail ?? null,
    latitude: lat,
    longitude: lng,
    assignedRoute: p.assignedRoute ?? null,
    createdAt: p.createdAt ?? new Date().toISOString(),
  };
}

export function SosInterceptProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [activeIncident, setActiveIncident] = useState<SosIncidentPayload | null>(null);
  const [liveLat, setLiveLat] = useState<number | null>(null);
  const [liveLng, setLiveLng] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [incidentResponseActive, setIncidentResponseActive] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const activeIncidentRef = useRef<SosIncidentPayload | null>(null);
  activeIncidentRef.current = activeIncident;

  const clearPingTimer = useCallback(() => {
    if (pingTimerRef.current != null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeIncident) {
      clearPingTimer();
      setLiveLat(null);
      setLiveLng(null);
      return;
    }
    setLiveLat(activeIncident.latitude);
    setLiveLng(activeIncident.longitude);
    setIncidentResponseActive(true);
    window.dispatchEvent(
      new CustomEvent("admin-sos-map-focus", {
        detail: {
          busId: activeIncident.busId,
          latitude: activeIncident.latitude,
          longitude: activeIncident.longitude,
        },
      })
    );
    clearPingTimer();
    if (!mutedRef.current) playSonarPing();
    pingTimerRef.current = window.setInterval(() => {
      if (!mutedRef.current) playSonarPing();
    }, 2800);
    return () => clearPingTimer();
  }, [activeIncident, clearPingTimer]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const socket = io(API_BASE.replace(/\/$/, ""), {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 12,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    const onCommand = (raw: CommandAlertPayload) => {
      window.dispatchEvent(new CustomEvent("admin-tactical-command", { detail: raw }));
      if (raw.kind === "speed_violation" && raw.busId) {
        window.dispatchEvent(new CustomEvent("admin-speed-violation", { detail: raw }));
      }
      const sos = normalizeSos(raw);
      if (sos) setActiveIncident(sos);
    };

    const onLoc = (raw: LocationUpdatePayload) => {
      const cur = activeIncidentRef.current;
      if (!cur || !raw?.busId || String(raw.busId) !== cur.busId) return;
      const la = Number(raw.latitude);
      const ln = Number(raw.longitude);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
      setLiveLat(la);
      setLiveLng(ln);
      window.dispatchEvent(
        new CustomEvent("admin-sos-map-focus", {
          detail: { busId: String(raw.busId), latitude: la, longitude: ln },
        })
      );
    };

    socket.on("commandAlert", onCommand);
    socket.on("locationUpdate", onLoc);

    return () => {
      socket.off("commandAlert", onCommand);
      socket.off("locationUpdate", onLoc);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const resolveIncident = useCallback(async (notes: string) => {
    if (!activeIncident) return;
    const token = getToken();
    if (!token) throw new Error("Not authenticated");
    const res = await fetch(
      `${API_BASE.replace(/\/$/, "")}/api/security/logs/${encodeURIComponent(activeIncident.id)}/sos-resolve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ resolutionNotes: notes.trim() }),
      }
    );
    const text = await res.text();
    let data: { error?: string } = {};
    if (text) {
      try {
        data = JSON.parse(text) as { error?: string };
      } catch {
        throw new Error("Invalid server response");
      }
    }
    if (!res.ok) throw new Error(data.error || "Could not resolve SOS");
    setActiveIncident(null);
    setResolveModalOpen(false);
    setIncidentResponseActive(false);
    clearPingTimer();
  }, [activeIncident, clearPingTimer]);

  const interceptSimulated = useCallback(async () => {
    const bus = activeIncident?.busId ?? "—";
    await postAdminAuditEvent({
      action: "BROADCAST",
      module: "Command Center — SOS intercept",
      details: `[SIM] Intercept route / backup & security notified for SOS bus ${bus}. Coordinate via voice procedures.`,
    }).catch(() => {});
  }, [activeIncident?.busId]);

  const queuePassengerDelayNotice = useCallback(() => {
    const bus = activeIncident?.busId ?? "unit";
    const msg = `Technical delay: Bus ${bus} — we are coordinating with operations. Thank you for your patience.`;
    try {
      localStorage.setItem("command_center_broadcast_draft", msg);
      localStorage.setItem("command_center_broadcast_severity_v1", "critical");
      localStorage.setItem("command_center_broadcast_target_v1", "passenger");
    } catch {
      /* ignore */
    }
    navigate("/dashboard/command/broadcast");
  }, [activeIncident?.busId, navigate]);

  const audioChannelHint = useCallback(() => {
    window.alert(
      "Direct one-way audio from the cabin requires a media gateway (e.g. WebRTC / telephony). Not enabled in this build — use voice call procedures for now."
    );
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      activeIncident,
      liveLat,
      liveLng,
      muted,
      setMuted,
      resolveIncident,
      openResolveModal: () => setResolveModalOpen(true),
      closeResolveModal: () => setResolveModalOpen(false),
      resolveModalOpen,
      incidentResponseActive,
      setIncidentResponseActive,
      interceptSimulated,
      queuePassengerDelayNotice,
      audioChannelHint,
    }),
    [
      activeIncident,
      liveLat,
      liveLng,
      muted,
      resolveIncident,
      resolveModalOpen,
      incidentResponseActive,
      interceptSimulated,
      queuePassengerDelayNotice,
      audioChannelHint,
    ]
  );

  return <SosInterceptContext.Provider value={value}>{children}</SosInterceptContext.Provider>;
}

export function useSosIntercept(): Ctx {
  const c = useContext(SosInterceptContext);
  if (!c) throw new Error("useSosIntercept must be used under SosInterceptProvider");
  return c;
}

export function useSosInterceptOptional(): Ctx | null {
  return useContext(SosInterceptContext);
}
